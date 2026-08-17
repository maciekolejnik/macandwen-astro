# Places: locations and activities

A personal database of **locations** (a lake, a car park, a refuge, a whole
region) and **activities** (a hike, a via ferrata, a kayak route), owned by the
person who added them and linked to each other in whatever way makes sense.

This document is the design and the plan. It is written before the code, so
everything below is a decision with its reasoning attached rather than a
description of what exists.

Status: **Planned.** Nothing here is implemented yet.

**Scope for the first release: storing, editing and displaying entries, on a
list and on a map.** Filtering, moderation and the type-management UI are
[future deliverables](#future-deliverables). The schema is designed so each of
them is an addition rather than a rewrite, and the places where that costs
something today are called out as they arise.

## The shape of the problem

Three things make this bigger than packing lists:

1. **Two kinds of thing that are mostly the same.** A location and an activity
   both have a name, a description, a type, an owner, photos, visibility and a
   place on a map. Only a handful of columns differ — and sometimes one thing is
   both.
2. **Links that refuse to be a foreign key.** A hike is linked to its car park,
   to the refuge halfway up, and to the lake at the top. So links have to run
   activity→location, location→location and activity→activity, and carry a
   meaning ("park at", "passes through", "inside").
3. **Visibility.** Everything a normal user adds is private. Admins choose.
   Signed-out visitors see only what an admin made public.

## The model

### One table, with the kind carried by which details exist

**One `entry` table**, plus two detail tables for the columns that genuinely
differ. `location_detail` and `activity_detail` are each optional, and **an
entry may have both** — which is the answer to "should a wild swimming spot be
one row or two?".

| Option | Verdict |
| --- | --- |
| **`entry` + optional `location_detail` + optional `activity_detail`** | Chosen. Shared concerns are written once, links get real foreign keys, and a thing that is both a place and a thing to do is one row rather than two that duplicate its name, photos and coordinates. |
| Separate `location` and `activity` tables | Every shared concern doubles: two photo tables, two visit tables, two filter builders. And the link table becomes polymorphic — **SQLite cannot foreign-key a polymorphic column**, so nothing cascades and nothing is enforced. |
| One table, `kind` a strict `'location' \| 'activity'`, hybrids modelled as two linked rows | Where this document started. It forces "Lake Banyoles" and "Swimming in Lake Banyoles" to be separate rows with the same coordinates, the same photos and two descriptions to keep in step. |

So there is no `hybrid` kind as such: **the kind is not a column you choose, it
is a consequence of what you filled in.** Ticking "this is a place" on the
editor gives the entry a `location_detail`; ticking "this is a thing to do"
gives it an `activity_detail`; at least one is required.

`entry.kind` still exists as a text column — `'location' | 'activity' | 'both'`
— but it is **derived**, written from the detail rows on every save. It is there
so a listing can filter and badge without joining both detail tables, and so an
index can serve that filter later. The detail rows are the truth; `kind` is a
cache of it, maintained in exactly one function.

**When to use one hybrid row and when to use two linked rows.** The rule is
whether the activity *is* the place:

- A wild swimming spot is one row: the lake and the swim are the same thing, and
  splitting them duplicates everything.
- A lake you can swim in, kayak on **and** cycle around is one location row plus
  separate activity rows linked `inside` it. Three activities cannot be one
  hybrid — each has its own difficulty and duration — and the moment there is a
  second activity, the first stops being the place.

This rule belongs in the editor's help text, not only here.

### Where the type lives

**On the detail rows, not on `entry`.** A hybrid has two types — the lake is a
*lake*, the swim is *wild swimming* — so a single `entry.type_id` could not
describe it. Putting the type next to the detail it describes also makes the
`kind`-scoping structural rather than a constraint: a location's type comes from
the location vocabulary because it is stored in the location table.

### Tables

| Table | Role |
| --- | --- |
| `entry` | The shared row: name, description, owner, visibility, geometry, seasons, attributes, derived `kind`, timestamps |
| `location_detail` | Present if the entry is a place. Type, access notes |
| `activity_detail` | Present if the entry is a thing to do. Type, difficulty, duration, family friendliness |
| `entry_type` | The vocabulary of types, per kind |
| `entry_link` | `(from_entry, relation, to_entry)` — the flexible graph |
| `entry_photo` | Ordered image URLs with captions |
| `entry_visit` | One row per visit, per user, per entry |

#### `entry`

```
id            text pk
kind          text not null            -- derived: 'location' | 'activity' | 'both'
name          text not null
slug          text not null unique
description   text
user_id       text not null → user.id  (cascade)
visibility    text not null default 'private'   -- 'private' | 'public'
lat           real                     -- representative point
lng           real
extent        text not null default 'point'     -- 'point' | 'area' | 'region'
bbox_min_lat  real  bbox_min_lng real
bbox_max_lat  real  bbox_max_lng real
seasons       integer not null default 0        -- bitmask, 0 = any time
attributes    text                     -- JSON blob, free-form extras
created_at / updated_at
```

**Geometry.** Every entry that appears on a map has a representative point —
Barcelona's is the city centre, a lake's is the middle of the water, a hike's is
its trailhead. That is what a pin needs and what the distance bands measure
from, so it is not optional in practice even when the thing is not a point.
`extent` says how literally to read it, and the optional bounding box gives an
area or a region something to draw. The known limit from
[database.md](./database.md) stands: D1 is SQLite, so this is `REAL` columns and
bounding-box arithmetic, not PostGIS.

Anything genuinely polygonal — a coastline, a national park border — is out of
scope. A bounding box is a rectangle around Catalunya, not Catalunya.

**Seasons** are a bitmask (`spring 1`, `summer 2`, `autumn 4`, `winter 8`) so
"summer or autumn" is one integer. `0` means any time, which needs no separate
branch when the filter arrives: `seasons = 0 OR seasons & ? != 0`.

**`slug`** exists so URLs read as `/places/lake-banyoles` rather than an id. It
is derived from the name, deduplicated with a numeric suffix, and does not
change when the name is edited — a link that has been shared should keep
working.

**`attributes`** is the escape hatch: a JSON object of extra properties,
rendered as a key/value list and never queried in SQL. The moment something in
there wants filtering, it has earned a column.

#### `location_detail`

```
entry_id  text pk → entry.id (cascade)
type_id   text not null → entry_type.id
access    text        -- free text: 'toll road', '20 min walk in', …
```

#### `activity_detail`

```
entry_id         text pk → entry.id (cascade)
type_id          text not null → entry_type.id
difficulty       text        -- 'easy' | 'moderate' | 'difficult' | null
duration_bucket  text        -- 'short' | 'half_day' | 'full_day' | 'multi_day' | null
duration_minutes integer     -- optional precision
family_friendly  integer     -- 1 yes, 0 no, null unknown
distance_m       integer
ascent_m         integer
```

**Duration is a bucket, optionally backed by minutes.** The bucket is what
matters and it is often unknown, so the bucket is the stored value and
`duration_minutes` is decoration. When minutes are given the bucket is derived
from them at write time — under 3 hours `short`, under 6 `half_day`, under 12
`full_day`, beyond that `multi_day` — so the two can never disagree. Deriving on
read instead would mean a future filter that cannot use an index.

**`family_friendly` is tri-state**, not a boolean. "Not marked" and "explicitly
not for small children" are different answers, and collapsing them would either
hide unmarked entries from families or promise something nobody checked.

**Difficulty** is a text enum, nullable for unknown. Unlike types, this
vocabulary is ordered, small and unlikely to grow, so it is not a lookup table.

#### `entry_type`

```
id, kind, slug, label, description, icon, colour, position,
is_active, created_at
unique (kind, slug)
```

Types are rows, not a TypeScript union, so adding "canyoning" does not need a
deploy. `kind` here is strictly `'location' | 'activity'` — it scopes the
vocabulary, and is a different thing from the derived `entry.kind`. `icon` and
`colour` drive the map pin and the list badge. `is_active` retires a type
without orphaning the entries using it; deleting a type in use is refused.

The seed ships in the migration:

| Kind | Types |
| --- | --- |
| Location | lake, viewpoint, car park, refuge, beach, wild camping spot, campsite, town, region, cave, mountain peak, restaurant |
| Activity | hike, via ferrata, climbing, kayaking, cycling, wild swimming, stand-up paddleboarding |

**There is no admin UI for types in the first release.** Adding one is a single
`wrangler d1 execute` insert (see [database.md](./database.md)), which is
acceptable while the only person adding types also has the database open. The
table is shaped for the UI that comes later.

#### `entry_link`

```
id
from_entry_id text not null → entry.id (cascade)
to_entry_id   text not null → entry.id (cascade)
relation      text not null
note          text
created_at
unique (from_entry_id, to_entry_id, relation)
```

**Relations come from a fixed vocabulary**, because a free-text relation is a
tag: two people write "parking" and "park at" and the graph stops answering
questions.

| Relation | Reads as | Typical endpoints |
| --- | --- | --- |
| `starts_at` | *this activity starts at that location* | activity → location |
| `parks_at` | *park here for this* | activity → location |
| `passes_through` | *this activity includes or visits that* | activity → location or activity |
| `ends_at` | *finishes here* | activity → location |
| `inside` | *that contains this* | location → location, activity → location |
| `near` | *close enough to combine* | anything ↔ anything |
| `related` | *see also* — the honest catch-all | anything ↔ anything |

A hike `parks_at` a car park, `passes_through` a refuge, and `passes_through`
the lake — which, being a hybrid, is both the place and the swim without a
second row. `parent_of` is `inside` in the other direction, so there is one
relation rather than two names for one edge.

**Direction matters; symmetry is handled at read time.** `near` and `related`
are symmetric, so reading an entry's links unions both directions and flips the
label for the ones stored backwards. Storing both directions instead would
double the rows and invite them to disagree.

Adding a relation is a code change, unlike adding a type — that is the intended
difference. Types are vocabulary; relations are structure that queries and UI
copy depend on.

#### `entry_photo`

```
id, entry_id → entry.id (cascade), url, caption, position, created_at
```

Rows, ordered by `position`, matching `packing_list_item`. URLs only — no
uploads, no R2 bucket, no image pipeline. The first photo is the card image.

#### `entry_visit`

```
id, entry_id → entry.id (cascade), user_id → user.id (cascade),
visited_on text (ISO date), note, created_at
unique (entry_id, user_id, visited_on)
```

Rows rather than an ordered JSON array on the entry, for three reasons: a visit
is **per user**, so a public entry visited by several people needs to say whose;
the ordering wanted is just `ORDER BY visited_on`; and "have I been there"
becomes a query rather than an array scan.

`visited_on` is an ISO date string rather than a timestamp because a visit is a
day, not a moment, and dates recalled from memory should not pretend to a time
zone.

### Access rules

They live in `src/lib/db/places.ts` and nowhere else, exactly as the packing
list rules live in one module, so a new page cannot pick a weaker one.

- A private entry is visible to its owner. Reads return `null` for missing and
  for forbidden alike, so ids cannot be probed.
- **Only the owner may edit or delete an entry — admins included.** An admin is
  not an editor of other people's writing; the admin power is over *visibility*,
  not content. Ownership is one predicate, with no role exception in it.
- **A normal user's entries are always private.** There is no request-to-publish
  flow and no review queue in the first release: `visibility` is only settable
  by an admin, and only on their own entries.
- An admin chooses private or public when creating or editing their own entry.
- Signed-out visitors see `visibility = 'public'` only. A single predicate in
  the query layer, never in a template.
- A link may only be created between two entries the actor can see, and a link
  is visible only if **both** endpoints are visible to the viewer — otherwise a
  public entry would leak the names of the private ones linked to it.

That last rule is the one most likely to be got wrong, so it is enforced in the
link query itself and tested directly.

**Every ownership question goes through `canEdit(entry, viewer)` and
`canView(entry, viewer)`**, never through `entry.user_id === viewer.id` written
out in a page. That is what makes households later a change to two functions
rather than a search across the codebase — see [Households](#households).

### Indexes

Two to start with, because the data is small and an index that serves no query
is a write cost with no reader:

| Path | Index |
| --- | --- |
| A user's own entries | `(user_id)` |
| Public browse, newest first | `(visibility, created_at)` |
| Map bounding box | `(lat, lng)` |

`(type_id)` arrives with the filters, since that is what will use it.
`EXPLAIN QUERY PLAN` findings get written back into this
document as the packing list one does.

## Pages

| Path | Shows |
| --- | --- |
| `/places` | Everything the visitor may see, as a list |
| `/places/map` | The same set, as pins |
| `/places/[slug]` | One entry: details, photos, visits, links |
| `/places/new` | The editor, empty — signed in only |
| `/places/[slug]/edit` | The editor, loaded — owner only |

All are `prerender = false`, since all read the session.

A signed-out visitor sees public entries and a prompt to sign in. A signed-in
one sees their own — private ones included — and the public ones, in two
sections, following the packing list index.

**The editor** is one form for both kinds. Two checkboxes, "this is a place" and
"this is a thing to do", reveal the location and activity sections; at least one
must be ticked. That is what makes a hybrid a natural thing to create rather
than an advanced feature. It is a plain form with a `<script>`, not a framework
island, matching `PackingListForm.astro`.

Coordinates come from a **map picker**: the editor shows the same map component
as `/places/map`, and clicking it drops the pin. Dragging the pin moves it, and
the numbers stay visible and editable underneath, because a coordinate pasted
from Google Maps is often the fastest way in — the field accepts a `lat, lng`
pair, which is exactly what copying from Maps gives you. The two are bound
together: typing moves the pin, moving the pin updates the numbers.

Without JavaScript the picker is absent and the pair of number fields is the
whole story, so the form still works.

An entry whose `extent` is `area` or `region` picks a bounding box by dragging a
rectangle, with the representative point defaulting to its centre and still
movable — a region's centre is rarely the place you would point at.

**The map** is Leaflet with OpenStreetMap tiles: no API key, no account, no
per-view billing, and small enough to load only on the pages that use it. It is
the one dependency this feature adds. MapLibre is the alternative and is better
at vector tiles, but wants a tile provider with a key.

`/places/map` renders the entries into the HTML server-side and Leaflet reads
them from there, so a shared link does not flash an empty map and the map and
the list can never show different sets. The list and the map are two views of
one query with a toggle between them; when filters arrive, the toggle becomes a
link that carries the query string across, which is the whole of what it takes
for filters to work on both.

Pins are coloured and iconed by `entry_type` — which is why those columns exist
now. A hybrid takes its activity type's pin, since "what can I do here" is the
question a map is being asked. Areas and regions draw their bounding box as well
as their pin. Clustering arrives when the pins actually overlap, not before.

`src/components/PlacesMap.astro` is the single map component, used by the map
page and the editor, so pin colours and tile configuration are written once.
The detail page reuses it too, showing one pin and any linked entries around it.

## HTTP API

| Route | Method | Answers |
| --- | --- | --- |
| `/api/places` | `POST` | `201 { id, slug }` |
| `/api/places/[id]` | `PATCH` / `DELETE` | `200 { id }` |
| `/api/places/[id]/links` | `POST` / `DELETE` | `200 { links }` |
| `/api/places/[id]/visits` | `POST` / `DELETE` | `200 { visits }` |

Following the packing list routes exactly: `prerender = false`, a session
required, JSON content type required (so a cross-origin `POST` cannot skip the
CORS preflight), `{ error }` bodies written for a human to read, and a
`PlacesValidationError` separating a bad request from a genuine failure.
Forbidden and missing both answer `404` with an identical body.

`PATCH` replaces the whole entry, details and photos included, matching the
packing list editor's replace-everything update. D1 has no interactive
transactions, so multi-table writes go through `db.batch`.

## Tests

Real D1 in workerd, no mocks, following the packing list precedent:

| File | Covers |
| --- | --- |
| `test/places.test.ts` | Access rules, visibility, the derived `kind`, slug generation, cascades |
| `test/places-links.test.ts` | Relation direction, symmetry, the both-ends visibility rule |
| `test/places-api.test.ts` | Each route: success, anonymous, non-owner, admin-is-not-owner, malformed bodies |

The link-visibility rule and "an admin may not edit someone else's entry" are
the two places where a bug is a leak rather than a broken page, so both get
tests asserting the refusal looks identical to absence.

## Plan

Each step is a mergeable change that leaves the site working.

1. **Schema and query layer.** Every table, the type seed, `places.ts` with the
   access rules, `places.test.ts`. No UI. This is the step worth getting right;
   the rest is comparatively mechanical.
2. **Read-only display.** `/places` and `/places/[slug]`. Proves the read paths
   and the visibility predicate against real pages.
3. **The editor and the write API.** Create, edit, delete, both detail sections,
   photos, visits. The shared map component lands here, since the picker is its
   first user.
4. **The map view.** `/places/map` reusing that component, and the list/map
   toggle.
5. **Links.** The link editor on the detail page and the both-ends visibility
   rule.

That is the release. A person can record places and things to do, see them on a
list and on a map, and connect them.

## Future deliverables

Deferred deliberately, in roughly the order they are likely to be wanted. Each
notes what the current schema already does for it, since that is the part that
would be expensive to retrofit.

**Filters.** Type, kind, difficulty, duration bucket, season, family
friendliness and text search, on both the list and the map. The schema is filter-ready: buckets are stored
rather than derived, `family_friendly` is tri-state so "unknown" is not silently
counted as "no", and seasons are a bitmask so a multi-season filter is one
integer comparison. The mechanism will follow the packing list index — a shared
matching module used by both the server render and the browser, with state in
the query string so a filtered view is linkable.

**Distance bands.** Not driving time — a routing API is a dependency, a cost and
a cache table, and straight-line distance from a home point answers the real
question, which is "is this a day out or a trip?". Three bands, measured as
crow-flies distance from a chosen origin:

| Band | Distance | Means |
| --- | --- | --- |
| Nearby | under about 120 km | an easy day trip |
| Further | about 100–250 km | a long day, or a weekend |
| Far | over about 250 km | a trip in its own right |

**The bands overlap on purpose.** Something 110 km away is honestly both, and a
hard boundary would hide it from one of the two searches it belongs in. The
numbers are named constants, because they are a judgement about the roads around
here rather than a fact — and since a band is computed at query time and stored
nowhere, tuning them changes no data. Beyond 250 km the band stops being
interesting, which is why there is no fourth.

The schema needs nothing new: `lat`/`lng` are already there, and the band is
computed with haversine from an origin. What it does need is somewhere to put
the origin — a "home" location per user — which is a small table added then.

**Publishing other people's entries.** A user asking for a private entry to be
made public, and an admin queue to approve or reject. This wants a table of its
own — `entry_review`, with the request, the outcome and who decided — so that a
rejected entry which is improved and resubmitted has a history. Nothing in the
current schema blocks it: `visibility` is already a column an admin controls,
and the review table only records how it came to change.

**Type management and suggestions.** An admin UI over `entry_type`, and a way
for a user to ask for a type that does not exist. The suggestion side needs a
notification, and the project sends no mail today — so the first version is a
pending count on an admin page, with the email hook as a single function called
at the point of creation.

**Scale.** Everything here loads every entry the visitor may see, which is
comfortable in the hundreds. Past that the list paginates, the filters move into
SQL, and the map gets a viewport query and clustering. Not a concern at the size
this starts at, and noted so that it is recognised when it arrives rather than
discovered.

## Households

Two people who go on the same trips should share their places, their visits and
their packing lists, and "we went" is the natural phrasing for this site — so
households are a real want, not a hypothetical one.

**They are not being built now.** A household is its own feature and a larger
one than this: invitations and acceptance, membership and leaving, what happens
to shared content when someone leaves, ownership transfer, and a retrofit of
packing lists to match. Building it before the first entry exists would delay a
launch for a second user who does not exist yet.

**What is being done instead is making it cheap.** The retrofit cost of
ownership models is not the migration — adding a nullable `household_id` is one
`ALTER TABLE` — it is the ownership check written out by hand in forty places.
So:

- Every visibility and ownership decision goes through `canView` and `canEdit`
  in `src/lib/db/places.ts`. No page, template or route compares `user_id`
  itself. Households then change those two functions and the listing queries
  behind them, not the call sites.
- Visits are already per-user rows, so a household view of "when have *we* been
  here" is a widened `WHERE`, not a remodelling.
- `entry.user_id` stays as the *author*, which remains meaningful after
  households exist. A household is an additional axis of access, not a
  replacement for authorship.

The one thing worth deciding early, and left open: whether a household shares
*everything* by default or per-item, since that is a product decision that
outlives the schema. Per-item sharing needs a column on each shareable table and
is easy to add later; share-everything needs nothing at all. Neither is
foreclosed.
