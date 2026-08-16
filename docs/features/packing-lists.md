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
| `/packing-lists` | The visitor's own lists and saves, then the remaining public lists |
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

### Astro's origin check

Astro rejects a cross-site `DELETE` (and other non-`GET` requests) with a `403`
before the route runs, using the `Origin` header. That is a third CSRF layer
beneath `SameSite=Lax` and the required JSON content type, and it is worth
knowing about when testing by hand: `curl` sends no `Origin`, so a bare
`curl -X DELETE` answers `403` where a browser succeeds. Add
`-H "Origin: http://localhost:4321"` to reproduce what the form does.

## Rate limiting

**Not implemented yet.** Nothing currently caps how many lists a user can
create; a script with a valid session could fill the database. This section is
the agreed plan.

**The limit is 50 lists per user per rolling 24 hours.** Far past any honest
use — a busy day of trip planning is a handful — and low enough that a runaway
script achieves nothing interesting. It is a rate rather than a ceiling, so it
bounds the damage per day rather than the total, which is the right trade for a
site that requires a Google sign-in to write anything at all.

It belongs in `create` in `src/lib/db/packing-lists.ts`, alongside the other
limits, so no route can be added later that forgets it:

```ts
const [{ recent }] = await getDb()
  .select({ recent: count() })
  .from(packingList)
  .where(and(
    eq(packingList.userId, userId),
    gt(packingList.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
  ));

if (recent >= MAX_LISTS_PER_DAY) {
  throw new PackingListValidationError(
    'That is a lot of packing lists for one day. Try again tomorrow.',
  );
}
```

`PackingListValidationError` already turns into a `400` carrying a message
written for a visitor to read, so the routes need no change. The count is
covered by the existing index on `user_id`.

Two things this deliberately does *not* do:

- **It does not rate-limit reads or edits.** Reads are cheap and cached by
  Cloudflare in front of the Worker; edits cannot grow the database, since
  `update` replaces a list rather than adding one.
- **It does not use Cloudflare's rate limit binding.** That binding counts per
  data centre rather than globally and only supports 10 or 60 second windows,
  which suits burst protection rather than a daily quota. It is worth adding
  later *as well* if abuse ever looks deliberate rather than accidental.

### The WAF rule

A rate limiting rule at the zone catches floods before they reach the Worker,
and costs no code. The free plan allows one rule, counted by IP, and its
expression may only use **Path** and Verified Bot — method matching needs a
Business plan.

That restriction turns out not to matter. `/api/packing-lists` has no `GET`
routes at all: reads happen server-side while rendering a page, so every request
that path ever sees is a write. Matching the path alone is therefore exactly as
precise as matching the method would be.

Cloudflare dashboard → **macandwen.com** → **Security** → **WAF** →
**Rate limiting rules** → **Create rule**:

| Field | Value |
| --- | --- |
| Name | `packing-list-writes` |
| Expression | `starts_with(http.request.uri.path, "/api/packing-lists")` |
| Characteristics | IP (the only choice on the free plan) |
| Rate | 20 requests per 10 seconds |
| Action | Block, for 10 seconds |

Notes worth having before touching it:

- **Do not widen it to `/api/`.** That would catch `/api/auth/*`, where the
  OAuth callback and session lookups are `GET`s that a path-only rule cannot
  tell apart from abuse. Signing in is Google-only, so there is no password to
  brute-force and little to protect there anyway.
- **The IP is shared.** Mobile carriers and offices put many people behind one
  address, so the limit has to be generous enough that a household never trips
  it. Twenty writes in ten seconds is far above what the editor can produce,
  since it submits once per save.
- **Counters are per data centre** and lag by a second or two, so the rule
  stops a flood rather than enforcing an exact number. The 50-a-day check in
  `create` is what actually bounds the database.
- **Verify it with Security → Events**, filtered by the rule name, rather than
  by trying to trip it from a browser — a block is invisible to the page beyond
  a failed request.
- It applies at the edge only. Local development and `wrangler dev` see nothing
  of it, so it cannot be tested before deploying.
