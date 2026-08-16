# Packing lists

A packing list is a title plus a flat, ordered list of item strings, owned by
one signed-in user and either private or public. Public lists are readable by
everyone, including signed-out visitors, and any signed-in user can favourite
one; the public listing is ranked by how many favourites a list has.

This document covers the data, HTTP and UI layers. Saving other people's lists
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
- An owner cannot favourite their own list. A save means "someone else found
  this useful", and self-saves would make the ranking say something it does not
  mean. `setFavourite` enforces it in the query rather than the route, so no
  caller can get round it, and it answers `null` — the same answer as a private
  or missing list, so the refusal still reveals nothing.

## Reads

`listOwned`, `listPublic` and `listFavourites` all return the same summary
shape, carrying `itemCount`, `favouriteCount`, `isFavourite` and `isOwn`.
Favourite state is resolved with a correlated subquery in the same statement as
the listing, so rendering a page never needs a second round trip.

`listPublic` orders by favourite count and falls back to recency for ties.

`itemTextsFor` fetches the item texts of many lists in one query, keyed by list
id. The index needs them to search inside lists; one query for the page beats
one per card. It checks nothing itself — it is only ever handed ids a listing
has already decided the viewer may see.

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
| `/api/packing-lists/[id]/save` | `POST` | `200 { saved, count }` |
| `/api/packing-lists/[id]/save` | `DELETE` | `200 { saved, count }` |

All of them are `prerender = false` and require a session; without one they answer
`401`. Failures are always `{ error }` with a message written for a visitor to
read, so the UI can show it as-is.

`PATCH` sends the whole list, matching the data layer's replace-everything
update. A list that does not exist and one owned by somebody else both answer
`404` with an identical body, so the routes cannot be used to discover which
ids are real.

The save route is idempotent in both directions — saving twice counts once —
so a double click or a retried request cannot inflate the ranking. It returns
the fresh count so the page can correct the number it guessed. A list that is
private, missing, or the caller's own all answer the same `404`.

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
| `/packing-lists` | The visitor's own lists and saves, then the remaining public lists — filterable and searchable |
| `/packing-lists/[id]` | One list and its items |
| `/packing-lists/new` | The editor, empty |
| `/packing-lists/[id]/edit` | The editor, loaded — owner only |

Both set `prerender = false`, since both read the session. They are rendered in
the Worker, so the lists are queried in the same request that returns the HTML
and never travel as JSON — which is why there is no `GET` route.

A signed-out visitor sees one public section and a prompt to sign in.

A signed-in one gets two more, boxed together because both are theirs: "Your
lists", private ones included, and "Saved lists". Anything in either is left out
of the browse section below. A page that shows the same list twice reads as
padding, and the save count on each card already says how popular a list is
without it needing a place in the ranking as well. Both sections stay on the
page when empty, saying what would go there — an empty box that disappears makes
the feature hard to find.

A list that does not exist and a private one belonging to somebody else render
the same not-found page with a `404`, matching the API's refusal to confirm
which ids are real.

`src/lib/packing-lists-view.ts` assembles what the index shows, so the rules
about who sees what are testable without rendering anything;
`test/packing-lists-view.test.ts` covers them. The pages themselves stay thin
enough that `astro check` and the build are adequate cover.

Saving is a bookmark button on the card and on the detail page, shown only to a
signed-in visitor looking at somebody else's public list — the two cases where
it would do anything. A bookmark rather than a star, to match the verb.

`src/lib/save-button.ts` wires every `[data-save-list]` button on the page and
is shared by both. The click is optimistic: the icon fills and the count moves
straight away, and both are put back if the request fails. Saving is small and
reversible, so waiting on a round trip to see a bookmark fill would only make it
feel broken. The server's count then replaces the guess, since other people may
have saved the list since the page was rendered. The button also stops its
click, because the card is one big stretched link and the button sits on top of
it.

## Filtering and search

The index carries a search box and, for a signed-in visitor, one chip per
section: Mine, Saved, Public. Unticking every chip shows everything rather than
nothing — a filter that blanks the page when the last box comes off is an
obstacle, and nobody means "show me nothing".

Both live in the URL, `?q=` and `?show=`, so a filtered view can be linked,
bookmarked and reloaded. The default — all three sections — is left out of the
query string, so the plain address stays plain.

**The same code runs in both places.** `src/lib/packing-lists-search.ts` holds
the matching rules and knows nothing of the DOM or the database;
`applyFilters` in `src/lib/packing-lists-view.ts` applies them to a loaded view.
The page runs them while rendering, so a shared link arrives already filtered
with no flash of the unfiltered page, and the form — a real `GET` form — works
with JavaScript off. `src/lib/packing-lists-filter.ts` then runs the very same
functions in the browser on every keystroke. One set of rules, so the two can
never disagree about what matches.

Every list is rendered whether it matches or not, non-matching ones with the
`hidden` attribute. That is what makes filtering instant: nothing to fetch, no
round trip between a keystroke and the answer. It costs the item texts of every
list on the page, which `itemTextsFor` collects in one query — a few kilobytes,
against a request per keystroke.

Matching is a small scorer rather than a dependency. Terms are ANDed, so more
words narrow; each term may match the title or any item, and the title counts
double, because a list *called* "Ski trip" answers "ski" better than one that
merely mentions ski socks. Within a string the ladder runs: the whole string,
its start, the start of a word inside it, anywhere inside it, and last a
scattered subsequence — "slpbg" finds "sleeping bag". Subsequences need three
characters, because on one or two nearly everything matches. Text is compared
with accents stripped, so "rucken" finds "Rückenprotektor".

Searching reorders each section by score, since that is what a search box is
for; clearing the box restores the order the queries gave — the visitor's lists
by recency, the public ones by saves. A section whose lists all fail the filter
is hidden entirely, heading and all, but a section with no lists *yet* stays,
because its prompt is how the visitor learns what would go there.

### What costs a request

Typing never reaches the server. The whole cost is paid once, when the page
loads:

| Moment | Requests | Queries |
| --- | --- | --- |
| Page load, signed in | 1 | 4 — `listOwned`, `listFavourites` and `listPublic` in parallel, then `itemTextsFor` |
| Page load, signed out | 1 | 2 — `listPublic`, then `itemTextsFor` |
| Every keystroke, every chip | 0 | 0 |
| Opening a shared `?q=` link | 1 | as above |

After the load, filtering is entirely local: `scoreList` runs over the cards
already in the document, flips their `hidden` attribute, reorders them, and
`history.replaceState` updates `?q=` and `?show=` in the address bar without
navigating. No fetch, no query, no re-render.

The trade is payload for latency — the item texts add a few kilobytes to the
HTML, and buy filtering with no round trip between a keystroke and the answer.

Only two things go back to the server, and both are an ordinary page render: a
shared link, which the server filters so it arrives without a flash of the full
list, and the `<noscript>` submit button.

**This loads every list the visitor may see**, which is the honest limit of the
design. It is comfortable at tens or low hundreds of lists. Past that the public
section wants pagination and the search wants to move into the database — D1
supports SQLite's FTS5, so item text could be indexed rather than shipped. Worth
doing when the page starts feeling heavy, and not before: the current approach
is a few hundred lines lighter and answers instantly.

`test/packing-lists-search.test.ts` covers the scorer and the URL round trip,
and `test/packing-lists-view.test.ts` covers `applyFilters`. The browser wiring
is thin on purpose, since everything it decides is decided by those two.

## Ticking items off

The detail page renders each item as a checkbox, and the ticks are kept in
`localStorage` — not in the database — for a week after the list was last
opened.

That is a deliberate limit rather than a shortcut. A packing list is a
*template*; ticking one is a single occasion of using it, which belongs to a
trip. Until trips exist, ticks are per-device scratch state, so the store that
fits is the one already in the browser: instant, available signed-out, and
costing no request per checkbox. Workers KV was the alternative — the `SESSION`
binding is already there — but it is eventually consistent with edge caching,
which is the wrong model for reading back what you just clicked.

`src/lib/packing-ticks.ts` holds the rules and takes a `Storage` rather than
touching `localStorage` itself, which is what makes them testable:

- The expiry window slides: reading renews the entry, so a list still being
  packed keeps its ticks however long the trip runs, while one opened once and
  abandoned still clears itself. A fixed lifetime measured from when the ticks
  were made is wrong at every value, which is why the window is not a setting —
  noticing that somebody came back beats asking them to predict a trip length
  before ticking a box.
- Expired entries are deleted on read rather than merely ignored.
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

## A note on wording

The visitor-facing verb is **save** — "Most saved first", "Saved by 3 people" —
because it describes what the button does, where "favourite" describes a
feeling. The database, the query module and the API keep `favourite` in their
names: renaming a table and its columns to follow a wording choice would be
churn with no benefit, and the two never appear together. The one place they do
meet is the save route's JSON, which speaks the visitor's language (`saved`,
`count`) because the page it feeds does.

If the copy is ever revisited, keep the two consistent within their own layer
rather than half-renaming across both. The icon is a bookmark, not a star, for
the same reason the verb is "save".

## The editor

`src/components/PackingListForm.astro` serves both creating and editing; the
only differences are where it submits and whether a delete button appears.
Handing it a list switches it to `PATCH`, which suits an update that replaces
everything anyway.

It is a plain form with a `<script>`, not a framework island — the project has
no UI framework, and adding one to reorder list rows would ship a runtime to do
what the DOM already does. The script is still bundled and typechecked.

Details worth knowing:

- Row buttons are handled by one listener on the container, so rows added later
  need no wiring.
- Enter inserts a row directly below the current one, the way a notes app does.
  Remembering something halfway down a list therefore means typing it where it
  belongs, rather than appending it and moving it up — which is most of what
  reordering was for. From a blank row it moves on instead, so holding Enter
  cannot stack up blanks.
- Backspace in an empty row deletes it and puts the cursor at the end of the
  row above. That is the way out of a row added by mistake, and what lets Enter
  afford to be eager.
- The arrow buttons remain for genuine reordering. They work by keyboard and on
  touch, which drag-and-drop would not without considerably more code; dragging
  is polish worth adding only if arrows prove annoying in practice.
- Removing the last row immediately adds a blank one back, so the list can never
  become a dead end with nothing to type into.
- Both pages guard access server-side: `/new` redirects a signed-out visitor to
  sign in, and `/[id]/edit` renders the same not-found page as the detail view
  for a list that is missing *or* somebody else's. The API enforces this again
  regardless.
- `src/lib/packing-list-limits.ts` exists so the browser can share the length
  limits without importing Drizzle and the D1 binding with them.
- A row is `PackingListItemRow.astro`, rendered once per existing item and once
  more inside a `<template>`. The client script clones the template for every
  row it adds, so the markup exists in one place instead of being repeated as an
  HTML string in the script — two copies in two languages that had to be kept in
  step by hand. Astro inlines the script into the page now that it imports
  nothing, which costs a request less and a shared cache entry more; at this
  size neither matters.

### Astro's origin check

Astro rejects a cross-site `DELETE` (and other non-`GET` requests) with a `403`
before the route runs, using the `Origin` header. That is a third CSRF layer
beneath `SameSite=Lax` and the required JSON content type, and it is worth
knowing about when testing by hand: `curl` sends no `Origin`, so a bare
`curl -X DELETE` answers `403` where a browser succeeds. Add
`-H "Origin: http://localhost:4321"` to reproduce what the form does.
