# Packing lists

A packing list is a title plus a flat, ordered list of item strings, owned by
one signed-in user and either private or public. Public lists are readable by
everyone, including signed-out visitors, and any signed-in user can favourite
one; the public listing is ranked by how many favourites a list has.

This document covers the data, HTTP and read-UI layers. Editing, favouriting
and filtering arrive in later changes and are described here as they land.

## Tables

| Table | Role |
| --- | --- |
| `packing_list` | Title, owner, `is_public`, timestamps |
| `packing_list_item` | One row per item, ordered by `position` within a list |
| `packing_list_favourite` | `(user_id, list_id)` primary key — one favourite per user per list |

Items are rows rather than a JSON column so they can be ordered, counted and
searched in SQL — the last of those matters if keyword search ever moves from
the browser to a D1 FTS5 index.

`position` is explicit because SQLite makes no promise about row order.
Everything cascades on delete: removing a user removes their lists and their
favourites, and removing a list removes its items and the favourites pointing
at it.

There are three read paths, and each has an index behind it:

| Path | Served by |
| --- | --- |
| A user's own lists | `packing_list_userId_idx` |
| Public lists, ranked by favourites | `packing_list_public_createdAt_idx` for the `is_public` filter, `packing_list_favourite_listId_idx` for the counting |
| A user's favourited lists | the `(user_id, list_id)` primary key, whose index is usable on the `user_id` prefix |

Verified with `EXPLAIN QUERY PLAN`. On the favourites path SQLite drives from
the public-list index and probes favourites, rather than starting from the
user's own — usually few — favourite rows; with no `ANALYZE` statistics it has
no reason to prefer either. It costs nothing at this size, but it is the first
thing to look at if that listing ever slows down.

The public ranking orders by favourite count, with recency only as a tiebreak,
so no index can supply that order — it is counted and sorted per query. That is
comfortably cheap at this size; if it ever stops being so, the answer is a
denormalised `favourite_count` column on `packing_list`, indexed alongside
`is_public`, updated as favourites change.

## Access rules

They live in `src/lib/db/packing-lists.ts` and nowhere else, so a new page or
route cannot accidentally choose a weaker one.

- A private list is visible only to its owner. `getById` returns `null` both for
  a missing list and for a private list the viewer does not own, so a caller
  cannot tell the two apart and probe for ids that exist.
- Only the owner can update or delete a list. Both functions return `false`
  rather than throwing when the list is missing *or* owned by someone else —
  again indistinguishable from outside.
- Only public lists can be favourited. A private list is invisible to anyone but
  its owner, so a favourite on one could only follow from a guessed id.
- The viewer's own public lists stay in the public listing. They are visible to
  everyone else, so hiding them would misreport the ranking.

## Reads

`listOwned`, `listPublic` and `listFavourites` all return the same summary
shape, carrying `itemCount`, `favouriteCount`, `isFavourite` and `isOwn`.
Favourite state is resolved with a correlated subquery in the same statement as
the listing, so rendering a page never needs a second round trip.

`listPublic` orders by favourite count and falls back to recency for ties.

## Writes

`update` replaces the whole list, items included: the editor submits the full
set, so diffing rows would add complexity without changing the result. D1 has
no interactive transactions, so writes that touch two tables go through
`db.batch`, which is atomic.

`normaliseInput` trims the title and every item, drops blank items, and rejects
an empty title or anything past `TITLE_MAX_LENGTH`, `ITEM_MAX_LENGTH` or
`MAX_ITEMS`. Every write path goes through it, so validation cannot be skipped
by calling a different function.

## Tests

`test/packing-lists.test.ts` runs against a real D1 database in workerd and
covers ordering, normalisation and limits, the access rules above, favourite
counting and idempotency, and the cascade behaviour on both list and user
deletion.

## HTTP API

| Route | Method | Answers |
| --- | --- | --- |
| `/api/packing-lists` | `POST` | `201 { id }` |
| `/api/packing-lists/[id]` | `PATCH` | `200 { id }` |
| `/api/packing-lists/[id]` | `DELETE` | `200 { id }` |

All three are `prerender = false` and require a session; without one they answer
`401`. Failures are always `{ error }` with a message written for a visitor to
read, so the UI can show it as-is.

`PATCH` sends the whole list, matching the data layer's replace-everything
update. A list that does not exist and one owned by somebody else both answer
`404` with an identical body, so the routes cannot be used to discover which
ids are real.

Layering: the routes shape-check the body's types, `normaliseInput` owns the
content rules, and `PackingListValidationError` carries the difference between
a bad request and a genuine failure — without it, a rejected title would be a
`500`.

Bodies must arrive as JSON, content type included. `text/plain` would make a
cross-origin `POST` a "simple" request that skips the CORS preflight; insisting
on JSON forces one. The session cookie's `SameSite=Lax` stops that attack too,
but neither should be the only thing in the way. `PATCH` and `DELETE` are never
simple requests, so they are always preflighted.

`test/packing-lists-api.test.ts` drives each route through the real middleware
and a real signed cookie, covering the success path, anonymous callers,
malformed and mistyped bodies, the content-type rule, and that another user's
list is indistinguishable from a missing one.

## Pages

| Path | Shows |
| --- | --- |
| `/packing-lists` | The visitor's own lists, then public lists ranked by favourites |
| `/packing-lists/[id]` | One list and its items |

Both set `prerender = false`, since both read the session. They are rendered in
the Worker, so the lists are queried in the same request that returns the HTML
and never travel as JSON — which is why there is no `GET` route.

A signed-out visitor sees the public section and a prompt to sign in. A
signed-in one also gets a "Your lists" section, private lists included; their
own public lists appear in both, because the public section is a ranking and
leaving them out would misreport it.

A list that does not exist and a private one belonging to somebody else render
the same not-found page with a `404`, matching the API's refusal to confirm
which ids are real.

`src/lib/packing-lists-view.ts` assembles what the index shows, so the rules
about who sees what are testable without rendering anything;
`test/packing-lists-view.test.ts` covers them. The pages themselves stay thin
enough that `astro check` and the build are adequate cover.

The star on a card is decorative for now — it shows how many people favourited
a list and whether the visitor is one of them. Making it clickable is the next
change.

## Ticking items off

The detail page renders each item as a checkbox, and the ticks are kept in
`localStorage` for 24 hours — not in the database.

That is a deliberate limit rather than a shortcut. A packing list is a
*template*; ticking one is a single occasion of using it, which belongs to a
trip. Until trips exist, ticks are per-device scratch state, so the store that
fits is the one already in the browser: instant, available signed-out, and
costing no request per checkbox. Workers KV was the alternative — the `SESSION`
binding is already there — but it is eventually consistent with edge caching,
which is the wrong model for reading back what you just clicked.

`src/lib/packing-ticks.ts` holds the rules and takes a `Storage` rather than
touching `localStorage` itself, which is what makes them testable:

- Ticks expire 24 hours after the last change, and expired entries are deleted
  on read rather than merely ignored.
- Ticks are stored as item ids, so ticks for items since removed from the list
  simply disappear.
- Anything unreadable is treated as no ticks: this is scratch state, and a
  corrupt entry should reset quietly rather than break the page.
- A full or blocked storage never stops a box being ticked; the tick just does
  not outlive the page.
- Every page view prunes expired entries for *all* lists, so abandoned ones
  cannot pile up in a visitor's browser.

Without JavaScript the checkboxes still tick — they just do not persist, and
the counter and "Clear ticks" button stay hidden.

When trips arrive, durable ticks belong there, against a trip's copy of a list,
and this module can be deleted without regret.
