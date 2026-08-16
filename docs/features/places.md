# Places: locations and activities

A personal database of **locations** (a lake, a car park, a refuge, a whole
region) and **activities** (a hike, a via ferrata, a kayak route), owned by the
person who added them, linked to each other in whatever way makes sense, and
browsed as either a list or a map with filters.

This document is the design and the plan. It is written before the code, so
everything below is a decision with its reasoning attached rather than a
description of what exists — sections are marked **Planned** until the change
that lands them says otherwise.

Status: **Planned.** Nothing here is implemented yet.

## The shape of the problem

Three things make this bigger than packing lists:

1. **Two kinds of thing that are 80% the same.** A location and an activity both
   have a name, a description, a type, an owner, photos, visibility and a place
   on a map. Only a handful of columns differ.
2. **Links that refuse to be a foreign key.** A hike is linked to its car park,
   to the refuge halfway up, and to the lake you swim in at the top — and that
   lake is also a wild-swimming *activity*. So links have to run
   activity→location, location→location and activity→activity, and carry a
   meaning ("park at", "passes through", "inside").
3. **Moderation.** Private by default, promotable to public by an admin, with
   signed-out visitors seeing only what an admin has blessed.

## The model

### One table or two?

**Recommendation: one `entry` table with a `kind` column**, plus two thin
detail tables for the columns that genuinely differ.

| Option | Verdict |
| --- | --- |
| **`entry` (kind) + `location_detail` + `activity_detail`** | Chosen. Visibility, ownership, moderation, photos, visits, types and links are written once and cannot drift. Links get real foreign keys. Filters that span both kinds ("everything family-friendly within 2 hours") are one query. |
| Separate `location` and `activity` tables | The obvious modelling, but every shared concern doubles: two photo tables, two visit tables, two moderation flows, two filter query builders — or one set of polymorphic ones, which is the same thing with the type safety removed. |

The decisive argument is links. With two tables, a link table needs
`(from_kind, from_id, to_kind, to_id)` and **SQLite cannot foreign-key a
polymorphic column**, so nothing stops a link pointing at a deleted row and
nothing cascades when one is removed. With a single `entry` table the link table
is a plain self-join with two real `references()` and `on delete cascade` — the
database enforces what would otherwise be application code that must never have
a bug.

The cost is one join to read a location's location-specific columns, and the
mild conceptual oddity of a table whose rows are two different nouns. Both are
cheap. The detail tables keep the kind-specific columns genuinely `NOT NULL`
where they should be, so `entry` does not become a sea of nullable columns.

The alternative, if this ever proves wrong, is to split `entry` into two tables
and rewrite the link table with a polymorphic key. That is a real migration, so
this is a decision worth being sure about before the first row lands.

### Tables

| Table | Role |
| --- | --- |
| `entry` | The shared row: kind, type, name, description, owner, visibility, geometry, seasons, attributes, timestamps |
| `location_detail` | Location-only columns, one row per location entry |
| `activity_detail` | Activity-only columns, one row per activity entry |
| `entry_type` | The vocabulary of types, per kind — admin-managed |
| `entry_type_suggestion` | A user asking for a type that does not exist yet |
| `entry_link` | `(from_entry, relation, to_entry)` — the flexible graph |
| `entry_photo` | Ordered image URLs with captions |
| `entry_visit` | One row per visit, per user, per entry |
| `entry_review` | The publication request and its outcome |

#### `entry`

```
id            text pk
kind          text not null            -- 'location' | 'activity'
type_id       text not null → entry_type.id
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
its trailhead. That is what a pin needs and what the drive-time filter measures
from, so it is not optional in practice even when the thing is not a point.
`extent` says how literally to read it, and the optional bounding box gives an
area or region something to draw and something to filter on. The known limit
from [database.md](./database.md) stands: D1 is SQLite, so this is
`REAL` columns and bounding-box arithmetic, not PostGIS. That is fine for
thousands of rows.

Anything genuinely polygonal — a coastline, a national park border — is out of
scope. A bounding box is a rectangle around Catalunya, not Catalunya. If the map
ever needs real shapes, they belong in a `geojson` text column read only by the
map, never by a query.

**Seasons** are a bitmask (`spring 1`, `summer 2`, `autumn 4`, `winter 8`) so
"summer or autumn" is one integer and the filter is `seasons & ? != 0`. `0`
means any time, which reads better than `NULL` because it needs no separate
branch: `0 & anything` is `0`, so an unrestricted entry is simply never excluded
by the season filter — the query says `seasons = 0 OR seasons & ? != 0`.

**`slug`** exists so URLs read as `/places/lake-banyoles` rather than an id.

**`attributes`** is the escape hatch the brief asks for: a JSON object of extra
properties, rendered as a key/value list and never queried in SQL. The moment
something in there wants filtering, it has earned a column.

#### `location_detail`

```
entry_id      text pk → entry.id (cascade)
access        text        -- free text: 'toll road', '20 min walk in', …
```

Deliberately near-empty at the start. Locations carry almost nothing that
`entry` does not already hold; the table exists so that location-only columns
have somewhere to go without widening `entry`.

#### `activity_detail`

```
entry_id         text pk → entry.id (cascade)
difficulty       text        -- 'easy' | 'moderate' | 'difficult' | null
duration_bucket  text        -- 'short' | 'half_day' | 'full_day' | 'multi_day' | null
duration_minutes integer     -- optional precision
family_friendly  integer     -- 1 yes, 0 no, null unknown
distance_m       integer
ascent_m         integer
```

**Duration is a bucket, optionally backed by minutes.** The brief is explicit
that the bucket is what matters and that it is often unknown, so the bucket is
the stored, filtered, indexed value and `duration_minutes` is decoration. When
minutes are given the bucket is derived from them at write time — under 3 hours
is `short`, under 6 `half_day`, under 12 `full_day`, beyond that `multi_day` —
so the two can never disagree. Deriving on read instead would mean a filter that
cannot use an index.

**`family_friendly` is tri-state**, not a boolean. "Not marked" and "explicitly
not for small children" are different answers, and collapsing them would either
hide unmarked entries from families or promise something nobody checked. The UI
therefore shows three states, and the filter's "family friendly" chip matches
only `1`.

**Difficulty** is `easy | moderate | difficult` as the brief says, nullable for
unknown. It is a text enum rather than an `entry_type`-style table: unlike types,
this vocabulary is ordered, small, and unlikely to grow. If it ever does grow, it
becomes a lookup table then.

#### `entry_type`

```
id, kind, slug, label, description, icon, colour, position,
is_active, created_at
unique (kind, slug)
```

Types are rows, not a TypeScript union, so adding "canyoning" is an admin
action rather than a deploy. `kind` scopes them, so an activity cannot be typed
"car park". `icon` and `colour` drive the map pin and the list badge, so a new
type looks right without a code change. `is_active` retires a type without
orphaning the entries that use it — deleting a type in use is refused.

The initial seed ships in the migration: locations get *lake, viewpoint, car
park, refuge, beach, camp spot, town, region*; activities get *hike, via
ferrata, climbing, kayaking, cycling, wild swimming, ski tour*. A seed is a
starting vocabulary, not a fixed one.

#### `entry_type_suggestion`

```
id, kind, label, note, user_id, status ('pending'|'accepted'|'rejected'),
resolved_by, resolved_at, created_at
```

A normal user cannot create a type, but can ask for one. Accepting a suggestion
creates the `entry_type` and, if the suggestion came from an entry form, retypes
the entry that prompted it.

**Notification: an in-app queue first, email second.** The project sends no mail
today and adding a provider, a domain, DKIM records and a template layer is a
feature of its own. The admin dashboard shows a pending count, which is enough
when there is one admin who also uses the site. The email hook is a single
function called at the point of creation, so wiring Resend or MailChannels later
touches one file. Suggestions are rate-limited per user per day so the queue
cannot be flooded.

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
questions. The list is small and deliberate:

| Relation | Reads as | Typical endpoints |
| --- | --- | --- |
| `starts_at` | *this activity starts at that location* | activity → location |
| `parks_at` | *park here for this* | activity → location |
| `passes_through` | *this activity includes/visits that* | activity → location or activity |
| `ends_at` | *finishes here* | activity → location |
| `inside` | *that contains this* | location → location, activity → location |
| `near` | *these two are close enough to combine* | anything ↔ anything |
| `related` | *see also*, the honest catch-all | anything ↔ anything |

The brief's example falls out of this: a hike `parks_at` a car park,
`passes_through` a refuge, and `passes_through` the wild-swimming activity at
the lake — which in turn `inside` the lake location. `parent_of` is expressed as
`inside` in the other direction, so there is one relation instead of two names
for one edge.

**Direction matters, symmetry is handled at read time.** `near` and `related`
are symmetric, so the query for an entry's links unions both directions and
flips the label for the ones stored backwards; `inside` and the rest are
asymmetric and display as "part of" or "contains" depending on which end you are
standing on. Storing both directions instead would double the rows and invite
them to disagree.

Adding a relation is a code change, unlike adding a type — that is the intended
difference. Types are vocabulary; relations are structure that queries and UI
copy depend on.

#### `entry_photo`

```
id, entry_id → entry.id (cascade), url, caption, position, created_at
```

Rows, ordered by `position`, matching `packing_list_item`. URLs only, as the
brief says — no uploads, no R2 bucket, no image pipeline. The first photo is the
card image.

#### `entry_visit`

```
id, entry_id → entry.id (cascade), user_id → user.id (cascade),
visited_on text (ISO date), note, created_at
unique (entry_id, user_id, visited_on)
```

Rows rather than the ordered JSON array the brief sketches, for three reasons: a
visit is **per user** (a public entry is visited by different people on
different days, and one array on the entry could not say whose), the order the
brief wants is just `ORDER BY visited_on`, and "have I been there" and "what did
we do last August" become queries rather than array scans.

`visited_on` is an ISO date string rather than a timestamp because a visit is a
day, not a moment, and dates that came from memory should not pretend to a time
zone.

#### `entry_review`

```
id, entry_id → entry.id (cascade), requested_by → user.id,
status ('pending'|'approved'|'rejected'), note,
reviewed_by → user.id, reviewed_at, created_at
```

A table rather than columns on `entry`, so a rejected entry that is improved and
resubmitted has a history, and so the moderation queue is a query over one small
table rather than a scan of every entry.

### Access rules

They live in `src/lib/db/places.ts` and nowhere else, exactly as the packing
list rules live in one module, so a new page cannot pick a weaker one.

- A private entry is visible only to its owner and to admins. Reads return
  `null` for missing and for forbidden alike, so ids cannot be probed.
- Only the owner or an admin may edit or delete an entry.
- Only an admin may set `visibility` directly. A normal user's create is always
  private; their route to public is a review request.
- An admin creating an entry chooses private or public on the form.
- Signed-out visitors see `visibility = 'public'` only. This is a single
  predicate applied in the query layer, never in a template.
- A link may only be created between two entries the actor can see, and a link
  is visible only if **both** endpoints are visible to the viewer — otherwise a
  public entry would leak the names of private ones linked to it.

That last rule is the one most likely to be got wrong, so it is enforced in the
link query itself and tested directly.

### Indexes

| Path | Index |
| --- | --- |
| Public browse, newest first | `(visibility, created_at)` |
| A user's own entries | `(user_id)` |
| Map / bounding box | `(lat, lng)` — prefilters the box, the rest is arithmetic |
| Filter by type | `(type_id)` |
| Links from and to an entry | `(from_entry_id)`, `(to_entry_id)` |
| Moderation queue | `(status, created_at)` on `entry_review` |

Verified with `EXPLAIN QUERY PLAN` when the queries exist, and the findings
written back into this document as the packing-list one does.

## Filtering

Filters are the point of the feature, so they get their own module —
`src/lib/places-filter.ts` — holding the matching rules and knowing nothing of
the DOM or the database, the way `packing-lists-search.ts` does. The server
applies them while rendering so a shared link arrives already filtered, and the
browser applies the same functions on every change. One set of rules, two
callers, no way for them to disagree.

| Filter | Applied where | How |
| --- | --- | --- |
| Kind (locations / activities / both) | SQL | `kind IN (…)` |
| Type | SQL | `type_id IN (…)` |
| Difficulty | client | set membership, nulls excluded when the filter is on |
| Duration bucket | client | set membership |
| Family friendly | client | `family_friendly = 1` |
| Season | client | bitmask, `0` always passes |
| Text search | client | the packing-list scorer, reused |
| Map viewport | client | bounding box against `lat`/`lng` |
| Within X hours' drive of Y | client, from a server-computed distance | see below |

The split is deliberate: the SQL filters are the ones that meaningfully cut the
row count, and everything else runs in the browser over rows already on the
page, so changing a chip costs no request. This is the same trade the packing
list index makes, with the same honest limit — it loads every entry the visitor
may see. Comfortable in the hundreds; past that, the SQL side takes over more of
the work and the list paginates while the map keeps a viewport query.

### "Within X hours' drive of Y"

This is the one filter that cannot be answered honestly on D1.

**What ships: a straight-line approximation.** Pick an origin — a saved home
location, a searched place, or the current position — and a number of hours. The
radius is `hours × 65 km/h`, a deliberately conservative average that accounts
for mountain roads being nothing like motorways. The query prefilters with a
bounding box (which the `(lat, lng)` index serves), then the haversine distance
is computed over the survivors.

It is labelled honestly in the UI — "about 2 hours away" — and it is *wrong* in
the way straight-line distance is always wrong: a fjord, a mountain range or a
missing bridge all make it optimistic.

**The upgrade path, when that becomes annoying:** a real routing matrix, called
server-side against a small set of origins (a person has two or three homes, not
two hundred), with the results cached in a `drive_time` table keyed by
`(origin_id, entry_id)` and refreshed lazily. That turns a routing API's per-call
cost into a one-off per pair, and leaves the filter itself unchanged — it still
compares a stored number to a threshold. Worth building when the approximation
has actually misled someone, and not before.

The average speed is a named constant with the reasoning next to it, so tuning
it does not require reading the query.

## Pages

| Path | Shows |
| --- | --- |
| `/places` | List view: everything visible, filtered and searched |
| `/places/map` | Map view: the same set, same filters, as pins |
| `/places/[slug]` | One entry, its photos, its visits and its links |
| `/places/new` | The editor, empty — signed in only |
| `/places/[slug]/edit` | The editor, loaded — owner or admin |
| `/admin/places` | Moderation queue and type suggestions — admin only |
| `/admin/places/types` | Type management — admin only |

All are `prerender = false`, since all read the session.

**The list and the map are two views of one query**, sharing the filter bar and
the URL state, with a toggle between them. Filter state lives entirely in the
query string (`?kind=&type=&difficulty=&duration=&family=&season=&q=&near=&hours=`),
so a filtered view is linkable and survives a reload — and so switching between
list and map keeps the filters, because the toggle is just a link that carries
the query string across.

**The map.** Leaflet with OpenStreetMap tiles: no API key, no account, no
per-view billing, and small enough to load only on the map page. MapLibre is the
alternative and is better at vector tiles and clustering, but wants a tile
provider with a key. Pins are coloured by `entry_type.colour`; areas and regions
draw their bounding box instead of a pin. Clustering arrives when the pins
overlap enough to need it, not before.

The map page must work as a page, not as an app: the entries are rendered into
the HTML by the server, and Leaflet reads them from there. That keeps the map
consistent with the list, and keeps a shared link from flashing an empty map
while it fetches.

## HTTP API

| Route | Method | Answers |
| --- | --- | --- |
| `/api/places` | `POST` | `201 { id, slug }` |
| `/api/places/[id]` | `PATCH` / `DELETE` | `200 { id }` |
| `/api/places/[id]/links` | `POST` / `DELETE` | `200 { links }` |
| `/api/places/[id]/visits` | `POST` / `DELETE` | `200 { visits }` |
| `/api/places/[id]/review` | `POST` | `200 { status }` — request publication |
| `/api/admin/places/[id]/review` | `POST` | `200 { status }` — approve or reject |
| `/api/admin/place-types` | `POST` / `PATCH` | `200 { id }` |
| `/api/place-type-suggestions` | `POST` | `201 { id }` |

Following the packing-list routes exactly: `prerender = false`, a session
required, JSON content type required (so a cross-origin `POST` cannot skip the
CORS preflight), `{ error }` bodies written for a human to read, and a
`PlacesValidationError` separating a bad request from a genuine failure.
Forbidden and missing both answer `404` with an identical body.

Admin routes check `locals.user.role === 'admin'` through one shared helper, so
there is a single place to get it right.

## Tests

Following the packing-list precedent — real D1 in workerd, no mocks:

| File | Covers |
| --- | --- |
| `test/places.test.ts` | Access rules, visibility, the link-visibility rule, cascades |
| `test/places-links.test.ts` | Relation direction, symmetry, the unique constraint |
| `test/places-filter.test.ts` | Every filter, the bitmask, the distance maths, URL round-trip |
| `test/places-api.test.ts` | Each route: success, anonymous, non-owner, admin-only, malformed bodies |
| `test/places-moderation.test.ts` | Request → approve/reject, who may do what |

The link-visibility rule and the admin checks are the two places where a bug is
a data leak rather than a broken page, so both get tests that assert the refusal
looks identical to absence.

## Plan

Each step is a mergeable change that leaves the site working.

1. **Schema and query layer.** All nine tables, the type seed, `places.ts` with
   the access rules, and `places.test.ts`. No UI. This is the step worth getting
   right; everything after it is comparatively mechanical.
2. **Read-only list view.** `/places` and `/places/[slug]`, public entries only,
   no filters. Proves the read paths and the visibility predicate against real
   pages.
3. **The editor and the write API.** Create, edit, delete, photos, visits.
   Private by default.
4. **Links.** The link editor on the detail page, the vocabulary, the both-ends
   visibility rule.
5. **Filters.** The shared filter module, the filter bar, URL state, and the
   text scorer reused from packing lists.
6. **Map view.** Leaflet, pins by type, viewport filtering, the list/map toggle.
7. **Moderation.** Review requests, the admin queue, approve and reject.
8. **Type management.** Admin CRUD for types, user suggestions, the notification
   hook.
9. **Drive-time filter.** The straight-line approximation and its honest label.

Steps 2–4 are the usable core; a person can record places before any filter
exists. Moderation lands late on purpose — until there is a second user, every
entry is the admin's own.

## Open questions

Worth settling before step 1, since each changes the schema:

- **Is one `entry` table the right call?** The alternative is above with its
  costs. Changing it later is a real migration.
- **Should an activity be able to *be* a location?** A wild swimming spot is
  arguably one row, not two linked ones. The current answer is two rows and a
  link, because the alternative is a row that is sometimes both and filters that
  must then decide what it counts as. Worth confirming against a handful of real
  examples first.
- **Do visits belong to a user or to a household?** Per user is modelled here;
  "we went" is the more natural phrasing for this site, which might mean visits
  should be shared between two linked accounts. Deferred, not decided.
