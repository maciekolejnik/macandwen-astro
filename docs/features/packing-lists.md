# Packing lists

A packing list is a title plus a flat, ordered list of item strings, owned by
one signed-in user and either private or public. Public lists are readable by
everyone, including signed-out visitors, and any signed-in user can favourite
one; the public listing is ranked by how many favourites a list has.

This document covers the data layer. The HTTP and UI layers arrive in later
changes and are described here as they land.

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

Indexes cover the three read paths: lists by owner, public lists by recency,
and favourites by list (the ranking's counting key).

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
