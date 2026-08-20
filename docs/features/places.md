# Places & activities

A personal database of **locations** (a lake, a car park, a refuge, a whole
region) and **activities** (a hike, a via ferrata, a kayak route), owned by the
person who added them and linked to each other in whatever way makes sense.

The feature is called "places & activities" rather than "places", because half
the data is not a place: a hike is a thing you do. The clumsier name is the
honest one, and it matches the two checkboxes in the editor, so the same
vocabulary runs from the nav to the form. The route stays `/places` — a URL is a
handle, not a title, and shared links should keep working.

This document is the design and the plan. It is written before the code, so
everything below is a decision with its reasoning attached rather than a
description of what exists.

Status: **In progress.** Steps 1 to 3 of the plan have landed: the schema and
the query layer, the read-only pages, and the editor with its write API. The map
is what remains. Sections describing what does not exist yet stay in the future
tense.

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
| `entry` | The shared row: name, description, owner, visibility, geometry, access, seasons, derived `kind`, timestamps |
| `location_detail` | Present if the entry is a place. Type and extras |
| `activity_detail` | Present if the entry is a thing to do. Type, difficulty, duration, family friendliness, extras |
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
access        text                     -- how to reach the point above
maps_url      text                     -- a link to it in a maps app
rating        integer                  -- 1-5, null = not rated
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

**Access** — "toll road", "20 minutes walk in", "gate is usually shut, park on
the verge" — sits on `entry`, beside the point it describes, rather than on
`location_detail`. It was on the location row first, which was wrong twice
over: an activity has a way in as much as a place does, and forcing a hike to
invent a location row just to hold one sentence would corrupt the `kind` that
row is supposed to derive. A hybrid also has one way in, not two.

**A maps link** sits beside it, on `entry` for both of the same reasons: a
hike's trailhead has one as much as a lake does, and a hybrid has one link
rather than two — the lake and the swim in it are the same dot on the earth.

It is not a duplicate of `lat`/`lng`, which stay the authority for the pin and
for distance. A pasted link is a different object from a coordinate: it points
at a *named* place, carrying its reviews, photos and opening hours, and the link
a phone gives you when you share (`maps.app.goo.gl/…`) does not decompose into
numbers without being resolved over the network. Where the two disagree the
coordinates win, because they are what the map draws.

The column is `maps_url`, not `google_maps_url`. Nothing in the code inspects it
beyond checking the scheme, so an Apple Maps, OsmAnd or Organic Maps link works
exactly as well, and a vendor name would be a lie the first time somebody pastes
one. That scheme check is not a formality: the value is rendered as an `href` on
an entry its owner may publish, so `javascript:` would be stored XSS. The host
is deliberately *not* checked, since there is no list of map providers worth
maintaining.

On the page it is a button rather than a link in a sentence, because it is an
*action* — the thing you tap when you are about to drive — while the
coordinates above it are for reading. Other external references, a Wikiloc
route or a refuge's booking page, are a different feature: they would render as
a list of further reading, and folding them together would mean the navigate
button had to go and find itself among them. That list is a
[future deliverable](#future-deliverables).

**The rating** is the third column to land on `entry` for the same reason: you
rate an outing, not separately the lake and the swim in it, and an activity
deserves an opinion as much as a place does.

Stars are the input, but **the words are the feature**. An uncalibrated
five-point scale collapses into "everything I bothered to save is a four" and
the bottom half dies, so each step is named — *Not worth it*, *Fine, nothing
special*, *Good, worth going*, *Excellent, would go back*, *Must see* — and the
name is what the tooltip and the accessible label say. Picking one is then a
judgement rather than a mood.

It is stored as an integer even though the words carry the meaning, because an
integer is the convertible representation: `RATING_LABELS` is a display rule
like `seasonLabel`, so the wording can be rewritten without touching data, and
`rating >= 4` — the single query a rating exists to answer — stays trivial. An
enum of words would need a companion ordering column to do the same job.

**Null is not zero and not three.** "We have not been yet" is a common and
honest state, and a filter has to be able to tell it from "it was poor" — the
same lesson `family_friendly` learned by being tri-state.

**One rating per entry, not one per person.** This is the owner's editorial
judgement, inseparable from the description they wrote, and not crowd feedback
to be averaged; there is no wisdom of crowds in a database with two people in
it. That is deliberately the opposite of the call made for visits, which needed
their own table precisely because a visit is *not* the owner's — anyone can go
somewhere, but the entry says what its author thought. If per-person ratings are
ever wanted, `entry_rating` is additive and changes nothing here.

It stays separate from `description` because the two are read at different
moments: the description is why you would go, the access line is what you need
when you are already in the car looking for the turning.

For an activity this is the short version — a full "park here, then walk 20
minutes" is better expressed as a `parks_at` link to a car park entry, which is
reusable by every walk that starts there. The column is for when a whole second
entry would be overkill.

**Seasons** are a bitmask (`spring 1`, `summer 2`, `autumn 4`, `winter 8`) so
"summer or autumn" is one integer. `0` means any time, which needs no separate
branch when the filter arrives: `seasons = 0 OR seasons & ? != 0`.

**`slug`** exists so URLs read as `/places/lake-banyoles` rather than an id. It
is derived from the name, deduplicated with a numeric suffix, and does not
change when the name is edited — a link that has been shared should keep
working.

#### `location_detail`

```
entry_id    text pk → entry.id (cascade)
type_id     text not null → entry_type.id
attributes  text        -- JSON, free-form extras
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
attributes       text        -- JSON, free-form extras
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

#### Where the extras live

**`attributes` sits on the detail rows, not on `entry`**, for the same reason
the type does. It is the escape hatch — a JSON object of extra properties,
rendered as a key/value list and never queried in SQL — and what decides which
extras a thing has is *what kind of thing it is*. A via ferrata has a cable
length, a restaurant has a phone number, a lake has a depth. Those are facts
about the activity or the place, not about the entry, and on a hybrid a single
bag would mix the lake's facts with the swim's.

The cost is that a genuinely entry-wide extra on a hybrid has two homes and no
obvious one. That is rare and harmless: anything that really belongs to the
entry as a whole — and is used often enough to notice — has earned a column,
which is the same rule that governs `attributes` in the first place.

**It is `TEXT`, not SQLite's JSONB.** D1 does support JSONB — both the local
runtime and production answer `jsonb('{"a":1}')` with a blob, so the SQLite
underneath is 3.45 or newer — but it would buy nothing here and cost something.
JSONB is a parsing optimisation for documents repeatedly read *inside* SQL with
`json_extract`; these are read whole, once, and parsed in the Worker. Against
that, a blob is unreadable in `wrangler d1 execute` and in the Cloudflare
console, where `TEXT` shows the object as written. SQLite's own documentation
also calls the JSONB format an internal detail rather than an interchange one.

If some future query does start extracting keys in SQL — the point at which
that becomes tempting is also the point at which the key deserves a column —
the conversion is `jsonb(attributes)` in place, with no change to what is
stored elsewhere.

#### `entry_type`

```
id, kind, slug, label, description, icon, colour, position,
is_active, created_at
unique (kind, slug)
```

Types are rows, not a TypeScript union, so adding "canyoning" does not need a
deploy. `kind` here is strictly `'location' | 'activity'` — it scopes the
vocabulary, and is a different thing from the derived `entry.kind`. `is_active`
retires a type without orphaning the entries using it; deleting a type in use is
refused.

##### Icons and colour

**The label carries the meaning; the icon is decoration and may be absent.**
That rule exists because the alternative does not survive contact with the
vocabulary: there is no emoji that means *via ferrata*, and the nearest one
(🧗) already means climbing. Nor is there one for a viewpoint (👁️ is an eye),
a cave (🕳️ is a hole), a lake (🏞️ reads as scenery) or a paddleboard (🏄 is
surfing). Half the seed was wrong on the first pass.

So `icon` is nullable, holds an emoji, and is left NULL wherever none is
honest. A forced-in icon is worse than none: it is read as a claim about the
type and quietly miscategorises it.

Three rules follow, and they are what make a missing icon cost nothing:

- **Nothing renders an icon alone.** On a card or a chip it sits next to the
  label, so it is a visual anchor for something already spelled out.
- **A map pin is identified by colour and shape**, with the emoji drawn inside
  only if there is one. At the size a pin is drawn, a glyph is barely legible
  anyway — which is why the map needs a legend, and why the pin's tooltip and
  its popup both carry the label.
- **Colour is only memorable for a handful of types at once.** With thirty-odd
  seeded types no palette is self-explanatory, so colour separates what is on
  screen rather than encoding the whole vocabulary; the legend does the naming.
  At this many types some pairs are genuinely close, which is fine as long as
  nothing depends on colour alone.

Emoji rather than an icon set, because an icon set would break the promise that
a type is data: adding one whose icon name is not bundled would render nothing,
so either the whole set ships or types quietly stop working. If a set is wanted
later, `icon` holds a name from it and an unrecognised name falls back to the
plain coloured pin — the same fallback a NULL already uses, so no data has to
change.

Near-duplicates within one family are fine — ⛺ for a wild camping spot beside
🏕️ for a campsite — because they *are* the same family, and the label is always
there to separate them.

The seed ships in the migration:

| Kind | Types |
| --- | --- |
| Location | lake, river, waterfall, spring, hot spring, beach, island, valley, gorge, cave, forest, mountain peak, mountain pass, viewpoint, refuge, campsite, wild camping spot, restaurant, castle or ruins, ski area, car park, town, region, **other** |
| Activity | hike, via ferrata, climbing, kayaking, cycling, wild swimming, stand-up paddleboarding, **other** |

Ids are readable and deterministic — `loc_lake`, `act_hike` — so a seeded type
can be named in a test or a fixture without a lookup, and so re-running the seed
is an obvious no-op. They are ordered in families — water, then land, then
places to stay, then the human-made — because `position` is what the dropdown
reads and a list of thirty in invention order is not scannable.

**`region` means an administrative or named division**, Catalunya or la
Cerdanya — the things an `inside` link points at. It is deliberately *not* the
answer for the Ordesa valley. That entry is a `valley` whose `extent` is `area`:
**`type` says what a thing is and `extent` says how big it is**, and they are
different questions. Before the landforms were seeded, `region` was drifting
into meaning "the big one", which is not something you can filter on or colour a
pin by. A river swimming spot had the same problem from the other end — the
nearest type was `lake`, which was simply wrong.

Note that *national park* is not in the list, and should not be: Ordesa is a
valley **and** a national park, and a type has cardinality one. That is a
[tag](#future-deliverables), and a good argument that the two axes both need to
exist eventually.

**`Other` is the fallback, on both sides.** Without one, somebody meeting an
unlisted thing either picks a wrong type — which silently corrupts the pin
colour and every filter later built on it, worse than no answer — or abandons
the entry. `Other` makes the gap explicit and recoverable: retyping is one
`UPDATE`, and the frozen slug means the URL does not move.

It also earns its keep as a work queue, since the entries sitting on it are
exactly the list of types the vocabulary is missing — most of what the "suggest
a type" idea was going to be for, without the notification machinery. It sorts
last and is never preselected, so it stays an escape hatch rather than a
default.

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
uploads and no image pipeline. The site's own pictures already live in the
`macandwen` R2 bucket and are served from `media.macandwen.com`, so a URL
column is enough to point at them; an upload flow can be added later without
the schema changing.

**Position 0 is the entry's default picture**, and carries real weight: it is
the card image on the list, the first frame of the carousel and the share
preview. Order is therefore something the editor has to let you set rather than
an accident of the order you happened to paste links in — the write path
already renumbers positions from the array it is given, so reordering is a
matter of the form offering it.

#### `entry_visit`

```
id, entry_id → entry.id (cascade), user_id → user.id (cascade),
visited_on text (ISO date), note, created_at
unique (entry_id, user_id, visited_on)
```

Rows rather than an ordered JSON array on the entry, for three reasons: a visit
is **per user**, so a public entry visited by several people keeps them apart
rather than merging them into one list; the ordering wanted is just `ORDER BY
visited_on`; and "have I been there" becomes a query rather than an array scan.

The `user_id` is what makes the visit private to its author — see the access
rules — and the same column is what a household later widens to a set.

`visited_on` is an ISO date string rather than a timestamp because a visit is a
day, not a moment, and dates recalled from memory should not pretend to a time
zone.

### Access rules

They live in `src/lib/db/places.ts` and nowhere else, exactly as the packing
list rules live in one module, so a new page cannot pick a weaker one.

- A private entry is visible to its owner, admins included in the refusal: an
  admin who did not write it cannot read it. Reads return `null` for missing and
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
- A visit belongs to the person who made it, so anyone who can see an entry may
  record one on it — including on somebody else's public entry — and may remove
  only their own.
- **A visit is only ever shown to the person who made it.** A note is a diary
  line, not a description: "kids melted down at the top" is written for the
  person who wrote it, and publishing an entry should not publish the dates and
  moods of everyone who has since been there. So the read is scoped to the
  viewer as well as the entry, and a signed-out reader sees none rather than
  everyone's. Households widen this later; starting narrow is the direction that
  cannot leak, because data shown once cannot be unshown. "Three people have
  been here" is a fair thing to want, but it is a count, not a list of names.
- A link may only be created between two entries the actor can see, and a link
  is visible only if **both** endpoints are visible to the viewer — otherwise a
  public entry would leak the names of the private ones linked to it.

That last rule is the one most likely to be got wrong, so it is enforced in the
link query itself and tested directly.

`setVisibility` is the one admin-only write, and it is still scoped to the
admin's own entries. `update` leaves a normal user's visibility exactly as it
was rather than forcing it back to private, since a silent revert would be as
surprising as an escalation.

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

`EXPLAIN QUERY PLAN` confirms the public listing searches
`entry_visibility_createdAt_idx` on `visibility` rather than scanning. A
signed-in visitor's listing is an `OR` across visibility and ownership, which
SQLite answers by scanning — correct at this size, and the first thing to look
at if that page ever slows down.

## Pages

| Path | Shows |
| --- | --- |
| `/places` | Everything the visitor may see, as a list |
| `/places/map` | The same set, as pins |
| `/places/[slug]` | One entry: details, photos, visits, and any links it has |
| `/places/new` | The editor, empty — signed in only |
| `/places/[slug]/edit` | The editor, loaded — owner only |

All are `prerender = false`, since all read the session.

A signed-out visitor sees public entries and a prompt to sign in. A signed-in
one sees their own — private ones included — and the public ones, in two
sections, following the packing list index.

What a page shows is decided in `src/lib/places-view.ts`, not in the `.astro`
files: which section an entry belongs to, which badges it carries, and how a
season mask, a duration or a coordinate pair reads in English. Templates are
awkward to test and these rules have edge cases — a mask of `0` means "any
time", a hybrid carries two type badges, `family_friendly` has three states —
so they live where a test can reach them.

**Photos lead.** The list gives every card a 3:2 image, and the detail page
puts the carousel directly under the title and badges, above the description —
a photograph answers "do I want to go here" faster than any sentence, and this
is a database of places worth looking at.

**Photographs keep their own shape.** Nothing is cropped to a fixed ratio: a
portrait makes a tall card, a panorama a short one, and the carousel is as tall
as its tallest picture with each one contained inside it. Cropping every image
to 3:2 makes a tidier grid out of worse photographs, and a portrait of a
waterfall loses the waterfall. Because the cards are then ragged, the list is
CSS columns rather than a row-aligned grid, so a short card does not leave a
hole beneath it.

An entry with no photo is simply a text card. A tinted stand-in was tried and
removed: it took up the room of a photograph while saying less than the type
badges directly beneath it already did.

**One picture at the top, the rest below.** The first photo is shown at its own
aspect ratio under the title, and the others go in a Photos section further
down, in columns so the ragged heights do not leave gaps.

A carousel was built and removed. With every photo at its natural shape, a
strip has to be as tall as its tallest member, so a panorama sitting next to a
portrait was displayed as a thin band in an acre of empty background. The
alternatives were both worse: crop everything to one ratio, which loses the
portrait, or let the height jump as you page through. Swipe-through belongs
here eventually, but it needs a considered answer to mixed aspect ratios rather
than a component that mostly works, and shipping the plain version now costs
nothing later — it is one component and no schema.

**The editor** is one form for both kinds. Two checkboxes, "this is a place" and
"this is a thing to do", reveal the location and activity sections; at least one
must be ticked. That is what makes a hybrid a natural thing to create rather
than an advanced feature. Unticking a half hides its section rather than
disabling it, so what is on screen is exactly what will be stored. It is a plain
form with a `<script>`, not a framework island, matching `PackingListForm.astro`.

Photos are a list of URL-and-caption rows with move buttons, and the first is
labelled "Main photo" — the ordering is not decoration, it decides the picture
on the list and in a shared link. Distance is typed in kilometres and stored in
metres; the conversion happens once, in the form.

The type dropdown starts on **"Choose one…"** for a new entry rather than on the
first type. Preselecting meant an untouched form quietly claimed *Lake*, and a
confidently wrong type is worse than a missing one — it colours a pin and feeds
a filter. `Other` is what the impatient answer should be, and it is one option
down the list. The server rejects a blank or unknown type as well; the client
check only buys a better sentence.

Coordinates are **one paste-friendly field**, `42.1256, 2.7469`, because that is
what copying from a map gives you and splitting it into two boxes means
splitting it by hand. It accepts a comma, a space, or both.

Coordinates also come from a **map picker**: the editor shows the same map
component as `/places/map`, clicking drops the pin, dragging moves it, and the
text field stays bound to it — typing moves the pin, moving the pin rewrites
the numbers. The picker is an addition to the field rather than a replacement
for it, which is why the field shipped first and alone: without JavaScript, or
with a coordinate already on the clipboard, it is the faster path anyway. The
field stays the thing that gets saved, so the two can never disagree about what
a save will store.

An entry whose `extent` is `area` or `region` can also put a **bounding box**
round itself, drawn by clicking one corner and then the other. Two clicks
rather than a drag: a drag has to fight the map's own panning on a desktop and
does not exist at all on a phone, where half of these entries get added, and
clicking twice works identically in both. The box lives in a hidden field as
JSON, which is what makes it survive an edit — a `PATCH` replaces the whole
entry, so a box the form did not send would be silently unset on every save.
Changing the extent back to a spot discards the box rather than keeping it out
of sight, since a stored box on a point entry would be drawn on the map, saying
something the extent denies.

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
now. A hybrid has two types, so the pin is a real decision rather than a lookup:
**the activity wins**, because a map is being asked "what can I do here", and
because the location half of a hybrid is usually the less specific of the pair —
"lake" against "wild swimming". `pinType()` in `places-map.ts` is the only
thing allowed to make that choice, so the map page, the detail page and any
future legend cannot disagree about what an entry is. Both types still show as
badges everywhere there is room for two; it is only the pin that has to pick.
**A bounding box is stored but never drawn.** Drawing one was tried and
removed: a rectangle on a map has no label, so on a page about a hike the box
round the park it sits inside reads as belonging to the hike, and even on the
map page a box round a region says nothing a reader can attach to a pin. The
box is still worth keeping — it is what the "inside this area" filter will be
built on, and it is still drawn in the editor, where it is the thing being
edited and cannot be mistaken for anything else. Clustering arrives when the
pins actually overlap, not before.

`src/components/PlacesMap.astro` is the single map component, used by the map
page and the editor, so pin colours and tile configuration are written once.
The detail page reuses it too, showing its own pin — drawn larger, with its
popup left shut, because the page around it already says the name. It opens on
that pin **alone**, with everything the entry is linked to behind a button:
"park at" and "starts at" are worth a glance rather than two page loads, but a
map that draws a car park, a refuge and a region the moment it loads makes the
reader work out which of the pins is the one they came for. The button names
the state it will move to — "Show what it is linked to (3)", then "Show only
this one" — and refits the view each way.

What the browser is given is decided in `src/lib/places-map.ts`: which entries
are mappable, what a pin's colour, icon and popup say, and the rectangle the
view opens on. That module is imported by the browser as well as the server, so
it may hold types from the data layer but never values from it — one import of
Drizzle or of the D1 binding and the map script stops building, which is the
same rule `places-constants.ts` lives under, and the reason `pinType()` moved
here from `places-view.ts`.

An entry **without coordinates is left off** rather than pinned somewhere
plausible: a wrong pin is worse than a missing one, and a bounding box is not
enough to invent one from, since a region's centre is rarely the place you would
point at. The map page says how many it is not showing, because a count that
quietly differs from the list is the kind of thing nobody notices until they are
looking for a place that is there.

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

Visits and links have their own routes rather than riding along with `PATCH`,
and for two different reasons.

A **visit** is not owned by the same person as the entry — it belongs to whoever
recorded it — so it has to be addable by somebody who cannot edit the entry at
all. That is why its control lives on the **detail page**, offered to any signed-in
visitor: it is not editing, and the editor is a page a non-owner cannot reach.

A **link** is owner-only, so it belongs in the **editor** with the rest of the
entry, and the read-only list on the detail page disappears entirely when
nothing is linked. It still has its own route rather than folding into `PATCH`,
because replace-everything semantics are wrong for an edge with two ends:
saving this entry would silently delete a link somebody else made pointing *at*
it. So it saves the moment you click, which the editor says out loud, since
everything around it waits for Save. Linking is unavailable on `/places/new` for
the plain reason that a link needs both ends to exist and one of them does not
yet.

Both sub-editors reload the page on success rather than patching the DOM. That
is heavier, but a link's label depends on which end it is read from and a date
has a format — both are things the server already knows how to work out, and
neither is worth writing a second time in the browser for an action taken this
rarely.

`src/lib/places-payload.ts` shape-checks a body before it reaches the data
layer, which trusts its types. Content rules — trimming, limits, blanks, the
derived kind — stay in `normaliseInput`, so they hold for every caller rather
than only for HTTP.

## Tests

Real D1 in workerd, no mocks, following the packing list precedent:

| File | Covers |
| --- | --- |
| `test/places.test.ts` | Access rules, visibility, the derived `kind`, slug generation, cascades |
| `test/places-links.test.ts` | Relation direction, symmetry, the both-ends visibility rule |
| `test/places-view.test.ts` | The display rules: sectioning, badges, facts, season and duration wording |
| `test/places-map.test.ts` | What reaches the map: which entries are mappable, the pin a hybrid draws, what it opens on, a drawn box |
| `test/places-api.test.ts` | Each route: success, anonymous, non-owner, admin-is-not-owner, malformed bodies |

Leaflet itself is not tested: a map needs a real browser with a real layout, so
mocking one would only assert that the mock was called. What a test can reach —
every decision about what the browser is handed — is in `places-map.ts`, and
the wiring around it was checked by driving a browser by hand.

The link-visibility rule and "an admin may not edit someone else's entry" are
the two places where a bug is a leak rather than a broken page, so both get
tests asserting the refusal looks identical to absence.

## Plan

Each step is a mergeable change that leaves the site working.

1. ~~**Schema and query layer.**~~ **Done.** Every table, the type seed,
   `src/lib/db/places.ts` with the access rules, and
   `src/lib/places-constants.ts` for the vocabulary the browser will need
   without Drizzle — the same reason `packing-list-limits.ts` exists. Covered by
   `places.test.ts` and `places-links.test.ts`.
2. ~~**Read-only display.**~~ **Done.** `/places` lists what you can see, split
   into "Yours" and "Shared with everyone"; `/places/[slug]` shows one entry.
   The display rules live in `src/lib/places-view.ts` rather than in the pages,
   so they can be tested — see `places-view.test.ts`. A missing slug and a slug
   you are not allowed to see both return the same 404, since a distinguishable
   403 would confirm that the entry exists.
3. ~~**The editor and the write API.**~~ **Done.** Create, edit, delete, both
   detail sections, photos — reorderable, since position 0 is the picture
   everything else uses — visits and links. The map picker was held back to step
   4 rather than shipped half-built: coordinates are pasted for now, into a
   field the picker will later fill.
4. ~~**The map view.**~~ **Done.** `/places/map` and the shared
   `PlacesMap.astro`, reused by the detail page's "Getting there" and by the
   editor as a picker, plus the list/map toggle. Leaflet is the one dependency
   the feature added. The rules a test can reach live in `places-map.ts`; the
   Leaflet wiring, which cannot be tested without a browser, lives in the
   component and was checked by driving one.

That is the release. A person can record places and things to do, see them on a
list and on a map, and connect them.

## Future deliverables

Deferred deliberately, in roughly the order they are likely to be wanted. Each
notes what the current schema already does for it, since that is the part that
would be expensive to retrofit.

**Filters.** Type, kind, difficulty, duration bucket, season, rating, family
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

**Tags.** A free-form, many-per-entry label — "dog friendly", "shady", "no phone
signal", "good in the rain". These were considered as a *replacement* for
`entry_type` and rejected, because a type and a tag are different tools:

| | Type | Tag |
| --- | --- | --- |
| How many per entry | One per detail row | Any number |
| Who defines the vocabulary | Admins, so it stays small | Anyone |
| What it drives | The pin, the icon, which extras a thing has | Nothing structural |

Cardinality-one is the whole value. A pin has one colour, and a tags-only model
would need a "primary tag" to draw it — which is a type wearing a disguise, with
the ambiguity of the other four left over. `attributes` sits beside `type_id`
for the same reason: a refuge has beds and half board, a car park has spaces and
a barrier height, and a per-type form is only possible because there is exactly
one type to key it on. Opening the vocabulary up would get "hike", "hiking" and
"walk" within a month.

But the things types handle *badly* are exactly the unbounded, personal,
un-adminned ones in that list, so the two axes are orthogonal and should both
exist eventually. A tag needs `tag` and `entry_tag` and touches nothing that is
here — no column changes, no rewrite — which is the reason it can wait.

**Type-to-filter on the long dropdowns.** Two selects outgrow a plain
`<select>`: the link target, which gains an option for every entry ever added
and so is the only one that degrades without bound, and the location type at
twenty-four. The activity type comes along for consistency once the component
exists. The five short ones — difficulty, duration, extent, family friendliness,
relation — stay native, because a combobox over three options is worse than a
dropdown, not better.

Worth being precise about what is actually missing, because it is less than it
looks. A focused native `<select>` already jumps as you type, and on a phone it
opens the platform picker, which beats anything hand-built. What it cannot do is
match anywhere but the **start** of the label — so it fails exactly when you do
not know how a thing is filed: you think *canyon*, it is under **Gorge**; you
think *col*, it is **Mountain pass**.

That makes **synonyms the real feature** and filtering merely the delivery
mechanism. A `search_terms` column on `entry_type` — space-separated, matched as
substrings alongside the label — is what native can never do, and it is a
one-column migration.

Built as a small accessible combobox of our own (input, filtered listbox,
arrow/enter/escape, `role="combobox"` with `aria-activedescendant`) rather than
a dependency: it is about a hundred and fifty lines, and this repo has no UI
libraries by choice. The matching itself is a pure function in `places-view.ts`,
so it is unit-tested like the other display rules rather than only clickable.

**External links.** A Wikiloc or AllTrails route, a refuge's booking page, a
crag's page on 8a.nu — references rather than actions, so they render as a list
of further reading and stay separate from the maps button. `entry_url`
(`entry_id`, `url`, `label`, `position`) is the whole of it, and nothing
existing changes.

**Uploading photos.** Today a photo is a URL somebody pastes, which is fine for
pictures already on `media.macandwen.com` and useless for one that is still on
a phone. Its own feature, and worth writing up separately, but the shape is
clear enough to record:

- The `macandwen` R2 bucket is already public on `media.macandwen.com`, so an
  upload writes `images/places/<entry>/<uuid>.webp` and hands back a URL. **The
  schema does not change** — `entry_photo.url` holds it either way, which is why
  this can land after the editor rather than before it. Upload swaps the input
  control, not the model.
- `POST /api/uploads` with an `r2_buckets` binding: session required, a content
  type allowlist, a size cap and a random key. Roughly the size of one of the
  packing list routes.
- **Resize in the browser, not the Worker.** `sharp` is native and does not run
  on Workers, and Cloudflare Images is a paid product for a problem this size. A
  `<canvas>` resize to about 2000 px and `toBlob(…, 'image/webp', 0.82)` turns a
  5 MB phone photo into roughly 300 KB before it leaves the device: faster
  upload, less stored, no dependency, and the same format as everything already
  in the bucket. HEIC is the exception — Safari decodes it, desktop Chrome does
  not — so those either fall back to uploading the original or ask the phone to
  shoot JPEG.
- **The real work is orphans.** `entry_photo` rows cascade when an entry is
  deleted; R2 objects do not. Removing a photo has to remove the object, and
  whether that happens inline or as a sweep is the decision that feature exists
  to make.

**Photo dimensions, to stop the page jumping.** No `<img>` in the places UI
carries `width` or `height`, so until the bytes arrive the browser reserves no
height at all and everything below a photo jumps down as each one decodes. That
is ordinary enough on any image-heavy page, but three things here make it worse
than usual:

- **Photos deliberately keep their own shape.** A fixed `aspect-[3/2]` box would
  reserve the space and end the problem, and it was rejected on purpose — a
  panorama and a portrait should not be cropped to the same rectangle. That
  decision stands, and the cost of it is that CSS alone cannot reserve the box,
  because nothing on the page knows the shape until the image loads.
- **The list is a CSS-columns masonry.** When one image resolves the column
  balancing re-runs and cards can move *between* columns, so the shift is not
  merely "things below move down" but "the card being aimed at moved sideways".
- **The detail hero is full width and above the fold**, which makes it the
  largest single shift on the site.

The fix is to store `width` and `height` on `entry_photo` and emit them as
attributes. Browsers derive `aspect-ratio` from the pair even under a
`width: 100%` rule, so the correctly shaped box is reserved before the image
arrives: natural shapes kept, nothing moves. It also unlocks `<Image>` from
`astro:assets`, which refuses remote images without dimensions — see
`docs/astro-feature-opportunities.md`.

**This does not have to wait for uploads.** The obvious moment to measure a
photo is while receiving the file, which would tie this to the deliverable
above. It is not necessary: the editor can load a pasted URL with `new Image()`
and read `naturalWidth`/`naturalHeight` before submitting, so the columns can be
filled today and uploads merely make it free later. A URL that fails to load
stores nulls and renders exactly as it does now, so the columns are nullable and
existing rows need a one-off backfill rather than a blocking migration.

Worth reproducing before fixing, because a warm cache hides it entirely: in
DevTools disable the cache, throttle to Slow 4G, turn on Rendering → Layout
Shift Regions, and hard-reload `/places`. Lighthouse's Cumulative Layout Shift
on the same page is the number to watch move.

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
