import { describe, expect, it } from 'vitest';
import { create, getBySlug } from '../src/lib/db/places';
import type { PlaceSummary } from '../src/lib/db/places';
import {
  FALLBACK_COLOUR,
  boundsOf,
  countUnmapped,
  isMappable,
  normaliseBounds,
  pinType,
  toPin,
  toPins,
} from '../src/lib/places-map';
import { signedInUser } from './helpers';

const LAKE = 'loc_lake';
const HIKE = 'act_hike';

function summary(overrides: Partial<PlaceSummary> = {}): PlaceSummary {
  return {
    id: 'a',
    slug: 'a-place',
    name: 'A place',
    userId: 'owner',
    lat: 42,
    lng: 2,
    extent: 'point',
    bbox: null,
    photoUrl: null,
    location: null,
    activity: null,
    ...overrides,
  } as PlaceSummary;
}

describe('which entries reach the map', () => {
  it('drops the ones with no coordinates rather than guessing at a pin', () => {
    const places = [summary(), summary({ id: 'b', lat: null, lng: null })];

    expect(toPins(places).map((pin) => pin.id)).toEqual(['a']);
    expect(countUnmapped(places)).toBe(1);
  });

  it('does not treat a bounding box as a point', () => {
    // A region can have a box and no representative point: its centre is
    // rarely the place you would point at, so nothing is pinned there.
    const place = summary({
      lat: null,
      lng: null,
      extent: 'region',
      bbox: { minLat: 41, minLng: 1, maxLat: 43, maxLng: 3 },
    });

    expect(isMappable(place)).toBe(false);
    expect(toPins([place])).toEqual([]);
  });
});

describe('what a pin says', () => {
  it('draws a hybrid pin from its activity, and a plain one from whatever it has', async () => {
    const owner = await signedInUser();
    const hybrid = await create(owner, {
      name: 'Hybrid pin',
      location: { typeId: LAKE },
      activity: { typeId: HIKE },
    });
    const plain = await create(owner, {
      name: 'Location pin',
      location: { typeId: LAKE },
    });

    expect(pinType((await getBySlug(hybrid.slug, owner))!)?.label).toBe('Hike');
    expect(pinType((await getBySlug(plain.slug, owner))!)?.label).toBe('Lake');
  });

  it('takes its colour, icon and label from the type that wins', async () => {
    const owner = await signedInUser();
    const created = await create(owner, {
      name: 'Hybrid',
      lat: 42.1,
      lng: 2.7,
      location: { typeId: LAKE },
      activity: { typeId: HIKE },
    });
    const place = (await getBySlug(created.slug, owner))!;

    const pin = toPin(place);

    // The activity wins, so the pin is the hike's green and its boot.
    expect(pin.typeLabel).toBe('Hike');
    expect(pin.colour).toBe('#166534');
    expect(pin.icon).toBe('🥾');
    expect(pin.href).toBe(`/places/${created.slug}`);
  });

  it('falls back to a plain colour when the type has none', () => {
    const pin = toPin(summary({ location: { type: {}, attributes: {} } } as never));

    expect(pin.colour).toBe(FALLBACK_COLOUR);
    expect(pin.icon).toBeNull();
    expect(pin.typeLabel).toBeNull();
  });

  it('draws a box only for an area or a region', () => {
    const bbox = { minLat: 41, minLng: 1, maxLat: 43, maxLng: 3 };

    expect(toPin(summary({ extent: 'point', bbox })).bbox).toBeNull();
    expect(toPin(summary({ extent: 'area', bbox })).bbox).toEqual(bbox);
  });

  it('marks the entry a detail page is about', () => {
    const pins = toPins([summary(), summary({ id: 'b' })], 'b');

    expect(pins.map((pin) => pin.focus)).toEqual([false, true]);
  });
});

describe('the view the map opens on', () => {
  it('is nothing at all when there is nothing to show', () => {
    expect(boundsOf([])).toBeNull();
  });

  it('holds every pin', () => {
    const pins = toPins([
      summary({ lat: 42, lng: 2 }),
      summary({ id: 'b', lat: 43, lng: 1 }),
    ]);

    expect(boundsOf(pins)).toEqual({
      minLat: 42,
      minLng: 1,
      maxLat: 43,
      maxLng: 2,
    });
  });

  it('holds a bounding box as well as its pin', () => {
    const pins = toPins([
      summary({
        lat: 42,
        lng: 2,
        extent: 'region',
        bbox: { minLat: 40, minLng: 0, maxLat: 44, maxLng: 4 },
      }),
    ]);

    expect(boundsOf(pins)).toEqual({
      minLat: 40,
      minLng: 0,
      maxLat: 44,
      maxLng: 4,
    });
  });
});

describe('a box drawn on the picker', () => {
  it('reads the same whichever corner was clicked first', () => {
    const a = { lat: 43, lng: 1 };
    const b = { lat: 41, lng: 3 };
    const expected = { minLat: 41, minLng: 1, maxLat: 43, maxLng: 3 };

    expect(normaliseBounds(a, b)).toEqual(expected);
    expect(normaliseBounds(b, a)).toEqual(expected);
  });

  it('keeps a click’s worth of precision, not a projection’s', () => {
    const bounds = normaliseBounds(
      { lat: 41.418015036080244, lng: -1.197509765625 },
      { lat: 42.819580715795915, lng: 1.47216796875 },
    );

    expect(bounds).toEqual({
      minLat: 41.41802,
      minLng: -1.19751,
      maxLat: 42.81958,
      maxLng: 1.47217,
    });
  });
});
