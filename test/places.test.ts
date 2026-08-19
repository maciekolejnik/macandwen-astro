import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import {
  addVisit,
  canEdit,
  canView,
  create,
  getById,
  getBySlug,
  listOwned,
  listTypes,
  listVisible,
  normaliseInput,
  remove,
  removeVisit,
  setVisibility,
  update,
  PlacesValidationError,
} from '../src/lib/db/places';
import {
  bucketForMinutes,
  maskToSeasons,
  parseCoordinates,
  seasonsToMask,
  slugify,
} from '../src/lib/places-constants';
import { signedInUser } from './helpers';

const LAKE = 'loc_lake';
const HIKE = 'act_hike';

async function countRows(table: string, column: string, value: string) {
  const row = await env.DB.prepare(
    `SELECT count(*) AS n FROM ${table} WHERE ${column} = ?`,
  )
    .bind(value)
    .first<{ n: number }>();

  return row?.n ?? 0;
}

function aPlace(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Lake Banyoles',
    location: { typeId: LAKE },
    ...overrides,
  } as Parameters<typeof create>[1];
}

describe('places: kind', () => {
  it('derives location, activity and both from the details given', async () => {
    const owner = await signedInUser();

    const location = await create(owner, aPlace());
    const activity = await create(owner, {
      name: 'Ridge walk',
      activity: { typeId: HIKE },
    });
    const hybrid = await create(owner, {
      name: 'Swimming at Banyoles',
      location: { typeId: LAKE },
      activity: { typeId: HIKE },
    });

    expect((await getById(location.id, owner))?.kind).toBe('location');
    expect((await getById(activity.id, owner))?.kind).toBe('activity');
    expect((await getById(hybrid.id, owner))?.kind).toBe('both');
  });

  it('gives a hybrid both types, which is why the type is not on the entry', async () => {
    const owner = await signedInUser();
    const { id } = await create(owner, {
      name: 'Wild swim spot',
      location: { typeId: LAKE, access: 'Park by the church' },
      activity: { typeId: HIKE, difficulty: 'easy' },
    });

    const place = await getById(id, owner);

    expect(place?.location?.type.slug).toBe('lake');
    expect(place?.location?.access).toBe('Park by the church');
    expect(place?.activity?.type.slug).toBe('hike');
    expect(place?.activity?.difficulty).toBe('easy');
  });

  it('refuses an entry that is neither a place nor a thing to do', async () => {
    const owner = await signedInUser();

    await expect(create(owner, { name: 'Nothing' } as never)).rejects.toThrow(
      PlacesValidationError,
    );
  });

  it('rewrites the kind when a detail is added or removed', async () => {
    const owner = await signedInUser();
    const { id } = await create(owner, aPlace());

    await update(id, owner, {
      name: 'Lake Banyoles',
      location: { typeId: LAKE },
      activity: { typeId: HIKE },
    });
    expect((await getById(id, owner))?.kind).toBe('both');

    await update(id, owner, { name: 'Lake Banyoles', activity: { typeId: HIKE } });
    const place = await getById(id, owner);
    expect(place?.kind).toBe('activity');
    expect(place?.location).toBeNull();
    expect(await countRows('location_detail', 'entry_id', id)).toBe(0);
  });

  it('rejects a type from the wrong vocabulary', async () => {
    const owner = await signedInUser();

    await expect(
      create(owner, { name: 'Wrong', location: { typeId: HIKE } }),
    ).rejects.toThrow(PlacesValidationError);
    await expect(
      create(owner, { name: 'Wrong', activity: { typeId: LAKE } }),
    ).rejects.toThrow(PlacesValidationError);
  });

  it('rejects a type that does not exist', async () => {
    const owner = await signedInUser();

    await expect(
      create(owner, { name: 'Wrong', location: { typeId: 'nope' } }),
    ).rejects.toThrow(PlacesValidationError);
  });
});

describe('places: visibility', () => {
  it('keeps a normal user private however they ask', async () => {
    const owner = await signedInUser();
    const { id } = await create(owner, aPlace({ visibility: 'public' }));

    expect((await getById(id, owner))?.visibility).toBe('private');
  });

  it('lets an admin publish their own entry', async () => {
    const admin = await signedInUser({ role: 'admin' });
    const { id } = await create(admin, aPlace({ visibility: 'public' }));

    expect((await getById(id, admin))?.visibility).toBe('public');
  });

  it('hides a private entry from everyone but its owner', async () => {
    const owner = await signedInUser();
    const other = await signedInUser();
    const admin = await signedInUser({ role: 'admin' });
    const { id, slug } = await create(owner, aPlace());

    expect(await getById(id, owner)).not.toBeNull();
    expect(await getById(id, other)).toBeNull();
    // No admin exception on reads: the admin power is over visibility only.
    expect(await getById(id, admin)).toBeNull();
    expect(await getById(id, undefined)).toBeNull();
    expect(await getBySlug(slug, other)).toBeNull();
  });

  it('answers the same for a missing entry as for a forbidden one', async () => {
    const owner = await signedInUser();
    const other = await signedInUser();
    const { id } = await create(owner, aPlace());

    expect(await getById(id, other)).toBe(await getById(crypto.randomUUID(), other));
  });

  it('shows a signed-out visitor only public entries', async () => {
    const admin = await signedInUser({ role: 'admin' });
    await create(admin, aPlace({ name: 'Public lake', visibility: 'public' }));
    await create(admin, aPlace({ name: 'Secret lake' }));

    const visible = await listVisible(undefined);

    expect(visible.map((place) => place.name)).toEqual(['Public lake']);
  });

  it("shows a signed-in visitor their own private entries and everyone's public ones", async () => {
    const admin = await signedInUser({ role: 'admin' });
    const owner = await signedInUser();
    await create(admin, aPlace({ name: 'Public lake', visibility: 'public' }));
    await create(admin, aPlace({ name: "Admin's secret" }));
    await create(owner, aPlace({ name: 'My secret' }));

    const names = (await listVisible(owner)).map((place) => place.name).sort();

    expect(names).toEqual(['My secret', 'Public lake']);
  });

  it('lists a user their own entries, private included', async () => {
    const owner = await signedInUser();
    const other = await signedInUser();
    await create(owner, aPlace({ name: 'Mine' }));
    await create(other, aPlace({ name: 'Theirs' }));

    const owned = await listOwned(owner.id);

    expect(owned).toHaveLength(1);
    expect(owned[0]?.isOwn).toBe(true);
  });
});

describe('places: editing', () => {
  it('lets only the owner edit — an admin is not an editor', async () => {
    const owner = await signedInUser();
    const admin = await signedInUser({ role: 'admin' });
    const { id } = await create(owner, aPlace());

    expect(await update(id, admin, aPlace({ name: 'Renamed' }))).toBe(false);
    expect(await remove(id, admin)).toBe(false);
    expect(await update(id, owner, aPlace({ name: 'Renamed' }))).toBe(true);
    expect((await getById(id, owner))?.name).toBe('Renamed');
  });

  it('answers false for a missing entry, the same as for someone else’s', async () => {
    const other = await signedInUser();

    expect(await update(crypto.randomUUID(), other, aPlace())).toBe(false);
    expect(await remove(crypto.randomUUID(), other)).toBe(false);
  });

  it('never changes a normal user’s visibility on update', async () => {
    const owner = await signedInUser();
    const { id } = await create(owner, aPlace());

    await update(id, owner, aPlace({ visibility: 'public' }));

    expect((await getById(id, owner))?.visibility).toBe('private');
  });

  it('lets an admin flip visibility only on their own entry', async () => {
    const admin = await signedInUser({ role: 'admin' });
    const owner = await signedInUser();
    const mine = await create(admin, aPlace());
    const theirs = await create(owner, aPlace());

    expect(await setVisibility(mine.id, admin, 'public')).toBe(true);
    expect(await setVisibility(theirs.id, admin, 'public')).toBe(false);
    expect(await setVisibility(mine.id, owner, 'public')).toBe(false);
  });

  it('replaces photos wholesale, keeping their order', async () => {
    const owner = await signedInUser();
    const { id } = await create(
      owner,
      aPlace({
        photos: [
          { url: 'https://example.com/a.jpg' },
          { url: 'https://example.com/b.jpg', caption: 'The far shore' },
        ],
      }),
    );

    let place = await getById(id, owner);
    expect(place?.photos.map((photo) => photo.url)).toEqual([
      'https://example.com/a.jpg',
      'https://example.com/b.jpg',
    ]);
    expect(place?.photoUrl).toBe('https://example.com/a.jpg');

    await update(id, owner, aPlace({ photos: [{ url: 'https://example.com/c.jpg' }] }));

    place = await getById(id, owner);
    expect(place?.photos).toHaveLength(1);
    expect(await countRows('entry_photo', 'entry_id', id)).toBe(1);
  });

  it('rejects a photo link that is not http', async () => {
    const owner = await signedInUser();

    await expect(
      create(owner, aPlace({ photos: [{ url: 'javascript:alert(1)' }] })),
    ).rejects.toThrow(PlacesValidationError);
  });
});

describe('places: slugs', () => {
  it('derives a slug from the name and keeps it after a rename', async () => {
    const owner = await signedInUser();
    const { id, slug } = await create(owner, aPlace());

    expect(slug).toBe('lake-banyoles');

    await update(id, owner, aPlace({ name: 'Estany de Banyoles' }));

    expect((await getBySlug(slug, owner))?.name).toBe('Estany de Banyoles');
  });

  it('suffixes a slug that is already taken', async () => {
    const owner = await signedInUser();

    const first = await create(owner, aPlace());
    const second = await create(owner, aPlace());

    expect(second.slug).toBe(`${first.slug}-2`);
  });
});

describe('places: visits', () => {
  it('records a visit against the person who made it', async () => {
    const admin = await signedInUser({ role: 'admin' });
    const visitor = await signedInUser();
    const { id } = await create(admin, aPlace({ visibility: 'public' }));

    // Anyone who can see an entry may record their own visit to it.
    const visits = await addVisit(id, visitor, '2025-08-14', 'Warm water');

    expect(visits).toHaveLength(1);
    expect(visits?.[0]?.note).toBe('Warm water');
    // ...and it is theirs: the owner of the entry does not see it.
    expect((await getById(id, admin))!.visits).toHaveLength(0);
  });

  it('keeps visits to yourself, on a public entry and from a signed-out reader', async () => {
    // An admin owns it, since a normal user's entry is forced private and the
    // point of this test is a public entry with two people's visits on it.
    const owner = await signedInUser({ role: 'admin' });
    const other = await signedInUser();
    const place = await create(owner, aPlace({ visibility: 'public' }));

    await addVisit(place.id, owner, '2025-07-01', 'Ours');
    await addVisit(place.id, other, '2025-07-02', 'Theirs');

    const mine = await getBySlug(place.slug, owner);
    const theirs = await getBySlug(place.slug, other);
    const anonymous = await getBySlug(place.slug, undefined);

    expect(mine!.visits.map((visit) => visit.note)).toEqual(['Ours']);
    expect(theirs!.visits.map((visit) => visit.note)).toEqual(['Theirs']);
    expect(anonymous!.visits).toEqual([]);
  });

  it('is idempotent for the same person on the same day', async () => {
    const owner = await signedInUser();
    const { id } = await create(owner, aPlace());

    await addVisit(id, owner, '2025-08-14');
    const visits = await addVisit(id, owner, '2025-08-14');

    expect(visits).toHaveLength(1);
  });

  it('orders visits newest first', async () => {
    const owner = await signedInUser();
    const { id } = await create(owner, aPlace());

    await addVisit(id, owner, '2024-05-01');
    await addVisit(id, owner, '2025-08-14');
    const visits = await addVisit(id, owner, '2023-01-02');

    expect(visits?.map((visit) => visit.visitedOn)).toEqual([
      '2025-08-14',
      '2024-05-01',
      '2023-01-02',
    ]);
  });

  it('lets a visitor remove only their own visit', async () => {
    const admin = await signedInUser({ role: 'admin' });
    const visitor = await signedInUser();
    const { id } = await create(admin, aPlace({ visibility: 'public' }));
    const [visit] = (await addVisit(id, visitor, '2025-08-14')) ?? [];

    // The admin's delete matches nothing, so the visitor still has their row.
    // Their own answer is empty because they have no visits of their own.
    expect(await removeVisit(id, visit!.id, admin)).toHaveLength(0);
    expect((await getById(id, visitor))!.visits).toHaveLength(1);

    expect(await removeVisit(id, visit!.id, visitor)).toHaveLength(0);
  });

  it('refuses a visit to an entry the visitor cannot see', async () => {
    const owner = await signedInUser();
    const other = await signedInUser();
    const { id } = await create(owner, aPlace());

    expect(await addVisit(id, other, '2025-08-14')).toBeNull();
  });

  it('rejects a date that is not a date', async () => {
    const owner = await signedInUser();
    const { id } = await create(owner, aPlace());

    await expect(addVisit(id, owner, 'last summer')).rejects.toThrow(
      PlacesValidationError,
    );
  });
});

describe('places: cascades', () => {
  it('takes details, photos, visits and links with the entry', async () => {
    const owner = await signedInUser();
    const { id } = await create(
      owner,
      aPlace({
        activity: { typeId: HIKE },
        photos: [{ url: 'https://example.com/a.jpg' }],
      }),
    );
    await addVisit(id, owner, '2025-08-14');

    await remove(id, owner);

    expect(await countRows('location_detail', 'entry_id', id)).toBe(0);
    expect(await countRows('activity_detail', 'entry_id', id)).toBe(0);
    expect(await countRows('entry_photo', 'entry_id', id)).toBe(0);
    expect(await countRows('entry_visit', 'entry_id', id)).toBe(0);
  });

  it('takes a user’s entries with the user', async () => {
    const owner = await signedInUser();
    const { id } = await create(owner, aPlace());

    await env.DB.prepare('DELETE FROM user WHERE id = ?').bind(owner.id).run();

    expect(await countRows('entry', 'id', id)).toBe(0);
  });
});

describe('places: validation', () => {
  it('requires a name', () => {
    expect(() =>
      normaliseInput({ name: '   ', location: { typeId: LAKE } }),
    ).toThrow(PlacesValidationError);
  });

  it('requires coordinates to come as a pair', () => {
    expect(() =>
      normaliseInput({ name: 'Half', lat: 42, location: { typeId: LAKE } }),
    ).toThrow(PlacesValidationError);
  });

  it('rejects coordinates off the planet', () => {
    expect(() =>
      normaliseInput({
        name: 'Nowhere',
        lat: 91,
        lng: 0,
        location: { typeId: LAKE },
      }),
    ).toThrow(PlacesValidationError);
  });

  it('rejects an inside-out bounding box', () => {
    expect(() =>
      normaliseInput({
        name: 'Backwards',
        extent: 'region',
        bbox: { minLat: 43, minLng: 3, maxLat: 42, maxLng: 2 },
        location: { typeId: LAKE },
      }),
    ).toThrow(PlacesValidationError);
  });

  it('derives the duration bucket from minutes, so the two cannot disagree', () => {
    const normalised = normaliseInput({
      name: 'Long day',
      activity: { typeId: HIKE, durationMinutes: 480, durationBucket: 'short' },
    });

    expect(normalised.activity?.durationBucket).toBe('full_day');
  });

  it('keeps a bucket given without minutes', () => {
    const normalised = normaliseInput({
      name: 'Vague',
      activity: { typeId: HIKE, durationBucket: 'multi_day' },
    });

    expect(normalised.activity?.durationBucket).toBe('multi_day');
    expect(normalised.activity?.durationMinutes).toBeNull();
  });

  it('keeps family friendliness tri-state', async () => {
    const owner = await signedInUser();
    const unknown = await create(owner, {
      name: 'Unknown',
      activity: { typeId: HIKE },
    });
    const no = await create(owner, {
      name: 'Not for kids',
      activity: { typeId: HIKE, familyFriendly: false },
    });

    expect((await getById(unknown.id, owner))?.activity?.familyFriendly).toBeNull();
    expect((await getById(no.id, owner))?.activity?.familyFriendly).toBe(false);
  });

  it('keeps a hybrid’s two sets of extras apart', async () => {
    const owner = await signedInUser();
    const { id } = await create(owner, {
      name: 'Lake with a swim',
      location: { typeId: LAKE, attributes: { parking: '5 EUR' } },
      activity: { typeId: HIKE, attributes: { water: '18C in August' } },
    });

    const place = await getById(id, owner);

    // Attributes sit beside the type, so the lake's facts and the swim's do
    // not land in one bag.
    expect(place?.location?.attributes).toEqual({ parking: '5 EUR' });
    expect(place?.activity?.attributes).toEqual({ water: '18C in August' });
  });

  it('survives an unreadable attributes blob', async () => {
    const owner = await signedInUser();
    const { id } = await create(owner, aPlace({ location: { typeId: LAKE } }));

    await env.DB.prepare('UPDATE location_detail SET attributes = ? WHERE entry_id = ?')
      .bind('not json', id)
      .run();

    // Extras are decoration; a corrupt blob should not take the page down.
    expect((await getById(id, owner))?.location?.attributes).toEqual({});
  });
});

describe('places: access helpers', () => {
  it('are the only place ownership is decided', () => {
    const place = { userId: 'owner', visibility: 'private' };

    expect(canView(place, { id: 'owner' })).toBe(true);
    expect(canView(place, { id: 'other', role: 'admin' })).toBe(false);
    expect(canView({ ...place, visibility: 'public' }, undefined)).toBe(true);
    expect(canEdit(place, { id: 'owner' })).toBe(true);
    expect(canEdit(place, { id: 'other', role: 'admin' })).toBe(false);
    expect(canEdit(place, undefined)).toBe(false);
  });
});

describe('places: types', () => {
  it('seeds both vocabularies and scopes them by kind', async () => {
    const locations = await listTypes('location');
    const activities = await listTypes('activity');

    expect(locations.map((type) => type.slug)).toContain('wild-camping-spot');
    expect(activities.map((type) => type.slug)).toContain('via-ferrata');
    expect(locations.every((type) => type.kind === 'location')).toBe(true);
  });

  it('leaves an icon off where no emoji is honest', async () => {
    const types = [...(await listTypes('location')), ...(await listTypes('activity'))];
    const byId = new Map(types.map((type) => [type.id, type]));

    // There is no emoji for a via ferrata, and the nearest one already means
    // climbing. Nothing may render an icon alone, so this must stay allowed.
    expect(byId.get('act_via_ferrata')?.icon).toBeNull();
    expect(byId.get('act_climbing')?.icon).not.toBeNull();
    // Colour and label, on the other hand, are always there to fall back on.
    expect(types.every((type) => type.colour && type.label)).toBe(true);
  });

  it('hides a retired type without orphaning what uses it', async () => {
    const owner = await signedInUser();
    const { id } = await create(owner, aPlace());

    await env.DB.prepare('UPDATE entry_type SET is_active = 0 WHERE id = ?')
      .bind(LAKE)
      .run();

    try {
      expect((await listTypes('location')).map((type) => type.id)).not.toContain(LAKE);
      expect((await getById(id, owner))?.location?.type.slug).toBe('lake');
    } finally {
      // The seed is not reset between tests, unlike the user tables.
      await env.DB.prepare('UPDATE entry_type SET is_active = 1 WHERE id = ?')
        .bind(LAKE)
        .run();
    }
  });
});

describe('places: shared vocabulary', () => {
  it('slugifies accents and punctuation', () => {
    expect(slugify('Estany de Banyoles')).toBe('estany-de-banyoles');
    expect(slugify('Peña Ubiña!')).toBe('pena-ubina');
    expect(slugify('!!!')).toBe('place');
  });

  it('round-trips a season mask', () => {
    expect(seasonsToMask(['summer', 'autumn'])).toBe(6);
    expect(maskToSeasons(6)).toEqual(['summer', 'autumn']);
    expect(maskToSeasons(0)).toEqual([]);
  });

  it('buckets durations at the boundaries', () => {
    expect(bucketForMinutes(60)).toBe('short');
    expect(bucketForMinutes(180)).toBe('half_day');
    expect(bucketForMinutes(360)).toBe('full_day');
    expect(bucketForMinutes(720)).toBe('multi_day');
  });

  it('parses a coordinate pair pasted from a map', () => {
    expect(parseCoordinates(' 42.1178, 2.7513 ')).toEqual({
      lat: 42.1178,
      lng: 2.7513,
    });
    expect(parseCoordinates('42.1178 2.7513')).toEqual({
      lat: 42.1178,
      lng: 2.7513,
    });
    expect(parseCoordinates('somewhere near the lake')).toBeNull();
    expect(parseCoordinates('91, 0')).toBeNull();
  });
});
