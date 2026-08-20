# Packing list options

A camping list is not one list. Cooking adds a stove, gas, a pan, a lighter,
washing-up liquid; a wild pitch adds a trowel and water carriers a campsite
would have provided. The items are the same list either way — it is the
occasion that differs.

This describes how a list carries those choices, and how a visitor picks them
when they use it.

## Why toggles rather than variants

The obvious model is a *variant*: "Camping — cooking", "Camping — no cooking",
each with its own items. It is wrong for two reasons.

It multiplies. Cooking × wild/campsite is four variants, and the third question
makes eight. Every shared item — tent, sleeping bag, head torch — then exists in
eight places, and adding a head torch means editing all of them. The list stops
being a list and becomes a maintenance job.

It also duplicates what the visitor already said. The answer to "am I cooking?"
is one bit, not a choice between four bundles, and asking for it as a bundle
makes them work out which bundle their trip is.

So a list carries **options**: independent, named yes/no choices. Items may be
tagged with one or more; an untagged item is always packed. Three options
describe eight trips with one copy of the tent.

Trade: options cannot express "either A or B, never both" — a mutually
exclusive pair is two toggles that a visitor could turn both on. That is
acceptable. The failure mode is packing slightly too much, which is what a
packing list is for; the alternative is a radio-group concept nobody has asked
for yet.

## Data

Two tables, alongside the three that exist.

| Table | Role |
| --- | --- |
| `packing_list_option` | `id`, `list_id`, `label`, `position`, `default_on` |
| `packing_list_item_option` | `(item_id, option_id)` primary key |

Both cascade on delete: dropping a list drops its options, dropping an option
drops its taggings, and dropping an item drops its taggings. `update` already
deletes and re-inserts every item, so item ids change on every save — taggings
must be re-inserted in the same batch, keyed by the option's *identity*, which
is why options survive an update where items do not.

That means options need stable ids across an edit. The editor therefore submits
each option with the id it was rendered with, and a new option arrives without
one; `update` keeps the ids it recognises, inserts the new ones, and deletes
those the form no longer mentions — the cascade then clears their taggings.
Anything else would reset every visitor's toggles on a typo fix.

Indexes: `packing_list_option_listId_position_idx` for reading a list's options
in order, and the `(item_id, option_id)` primary key, usable on its `item_id`
prefix, for reading an item's taggings. Taggings for a whole list are fetched in
one query joined through `packing_list_item`, matching `itemTextsFor`'s
one-query-per-page habit.

Limits live beside the existing ones in `packing-list-limits.ts`:
`MAX_OPTIONS` of 8 — past that the toggle row stops being scannable, and 2^8
trips is already more than a list can honestly describe — and
`OPTION_LABEL_MAX_LENGTH` of 40.

## Showing an item

An item is shown when it has no options, or when **any** of its options is on.

Any, not all. "Stove" is tagged *Cooking*; "trowel" is tagged *Wild camping*.
An item tagged with both reads as "needed if either applies", which is how a
person tags something they are unsure about. Requiring all would hide items in
exactly the case where the visitor said yes to more, which is the wrong
direction: more trip, more kit.

The rule lives in `src/lib/packing-list-options.ts` — `isItemVisible`, a pure
function over `(itemOptionIds, activeOptionIds)` knowing nothing of the DOM or
the database, in the same spirit as `packing-lists-search.ts`. The detail page
and `test/packing-list-visibility.test.ts` both call it.

`resolveActiveOptions` sits beside it and answers the other question: which
options are on, given what the visitor last chose. Stored answers are explicit
per option rather than a list of the ones that are on, so an option *added to
the list since* falls back to its own `default_on` instead of silently arriving
off, and an answer naming an option that has gone is ignored.

## The detail page

Options render as a row of toggle chips above the items, in `position` order.
Every item is rendered whichever way the toggles stand, with `hidden` flipped in
the browser — the same trick as search filtering, and for the same reason: no
round trip between a tap and the answer.

The item counter counts only visible items, since "3 of 20 packed" is a lie when
seven of the twenty are for a trip that is not this one.

Toggle state is per-device scratch state, exactly like ticks, and belongs in the
same place: `localStorage`, sliding week-long expiry, pruned on every view. It
gets its own module (`packing-list-option-state.ts`, prefix
`packing-options:`) rather than being bolted onto `packing-ticks.ts`, because
the two answer different questions and a corrupt entry for one should not reset
the other. Absent state means each option sits at its `default_on`.

Ticks are stored by item id and are unaffected: hiding an item does not untick
it, so turning cooking off and on again finds the pan where it was left.

Without JavaScript the chips are inert and every item shows — a full list is the
right degradation, and it is what the page does today.

## The editor

An **Options** fieldset above Items: `PackingListOptionRow.astro`, a label plus
an "on by default" checkbox and a remove button, rendered once per option and
once more inside a `<template>` for the script to clone — the arrangement item
rows already use. Removing an option that has items tagged with it asks first,
naming how many, since untagging them is not something the button says.

Each item row then carries a `[data-item-tags]` strip of small toggle chips,
one per option. It is **rebuilt** from the options fieldset on every change to
it rather than patched: option rows and item rows have to stay in step with no
framework, and copying in one direction cannot fall out of step the way
reconciling two lists can. At eight options and a few hundred items it costs
nothing.

An item's tags live in `data-option-ids` on its row, which is what the chips
toggle and what the submit handler reads. A list with no options renders the
strip empty and hidden, so a list that is just a list looks as it did.

An option added in the browser has no id, so the form gives it a temporary one
for the tags to point at; the server swaps in a real id when the list is saved.
Editor state goes up in the same whole-list `POST` or `PATCH` as everything
else.

## HTTP

No new routes. The existing bodies grow:

```jsonc
{
  "title": "Camping",
  "isPublic": true,
  "options": [{ "id": "…", "label": "Cooking", "defaultOn": false }],
  "items": [{ "text": "Stove", "optionIds": ["…"] }]
}
```

`items` becomes an array of objects rather than strings. That is a breaking
change to the request shape, and since the only client is the editor shipped in
the same build, the honest move is to change it outright rather than accept both
forever. `parsePackingListBody` shape-checks the new fields; `normaliseInput`
gains the content rules — trimming labels, dropping blank ones, rejecting
duplicates within a list, enforcing `MAX_OPTIONS`, and discarding `optionIds`
that name no option of this list, which is what a stale form would send.

Omitting `options` entirely stays valid and means a list without them, so
every existing list keeps working unchanged.

## Migration

`migrations/0002_packing_list_options.sql` creates both tables. Nothing
backfills: an existing list has no options, which is exactly the state the whole
feature degrades to.

## Tests

| File | Covers |
| --- | --- |
| `test/packing-list-options.test.ts` | Storing options and taggings, server-assigned ids, ids kept across an update, options and taggings deleted with the list, stale taggings dropped, labels and limits |
| `test/packing-list-visibility.test.ts` | `isItemVisible` and `resolveActiveOptions` |
| `test/packing-list-option-state.test.ts` | The `localStorage` rules: round trip, sliding window, corrupt and full storage, pruning |

The browser wiring on both pages is thin on purpose, because everything it
decides is decided by those pure modules. `test/helpers.ts` gained `texts()`,
which builds item inputs from plain strings — most tests care about an item's
text and not its options, and this lets them keep saying so.

## What this deliberately does not do

- **No mutually exclusive groups.** See above.
- **No per-option item counts on the index card.** The card says "24 items";
  which of them apply depends on toggles the browser has not read yet at
  render time.
- **No search interaction.** `itemTextsFor` keeps returning every item text, so
  a hidden item still makes its list findable. Searching is for finding the
  list, not for packing it.
- **No sharing of a chosen combination by URL.** Once trips exist, a trip is
  where a chosen combination lives; adding `?options=` first would build the
  same idea in a worse place. Until then the toggles remember themselves per
  device, which covers the visitor who opens their own list twice a day for a
  week.
