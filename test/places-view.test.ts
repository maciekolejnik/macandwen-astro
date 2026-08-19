import { describe, expect, it } from 'vitest';
import { create } from '../src/lib/db/places';
import {
  factsFor,
  formatCoordinates,
  formatDistance,
  formatMinutes,
  loadIndex,
  seasonLabel,
  splitSections,
  typeBadges,
} from '../src/lib/places-view';
import { seasonsToMask } from '../src/lib/places-constants';
import { signedInUser } from './helpers';

const LAKE = 'loc_lake';
const HIKE = 'act_hike';

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a',
    userId: 'owner',
    seasons: 0,
    extent: 'point',
    location: null,
    activity: null,
    ...overrides,
  } as Parameters<typeof factsFor>[0];
}

describe('places index view', () => {
  it('separates the visitor’s own entries from everyone else’s', async () => {
    const admin = await signedInUser({ role: 'admin' });
    const owner = await signedInUser();
    await create(admin, {
      name: 'Shared lake',
      visibility: 'public',
      location: { typeId: LAKE },
    });
    await create(owner, { name: 'My lake', location: { typeId: LAKE } });

    const view = await loadIndex(owner);

    expect(view.own.map((place) => place.name)).toEqual(['My lake']);
    expect(view.browse.map((place) => place.name)).toEqual(['Shared lake']);
  });

  it('never shows the same entry in both sections', async () => {
    const admin = await signedInUser({ role: 'admin' });
    await create(admin, {
      name: 'Mine and public',
      visibility: 'public',
      location: { typeId: LAKE },
    });

    const view = await loadIndex(admin);

    // An entry that is both the visitor's and public belongs above, not twice:
    // a page showing one entry in two places reads as padding.
    expect(view.own).toHaveLength(1);
    expect(view.browse).toHaveLength(0);
  });

  it('gives a signed-out visitor one section', () => {
    const places = [summary({ userId: 'someone' })];

    expect(splitSections(places, undefined)).toEqual({ own: [], browse: places });
  });
});

describe('places display rules', () => {
  it('badges a hybrid with both of its types', async () => {
    const owner = await signedInUser();
    await create(owner, {
      name: 'Swim spot',
      location: { typeId: LAKE },
      activity: { typeId: HIKE },
    });

    const { own } = await loadIndex(owner);

    expect(typeBadges(own[0]!).map((type) => type.label)).toEqual(['Lake', 'Hike']);
  });

  it('leaves out facts nobody filled in', () => {
    expect(factsFor(summary({ activity: { type: {}, difficulty: null } }))).toEqual(
      [],
    );
  });

  it('shows "no" for family friendliness, but says nothing when unmarked', () => {
    const marked = factsFor(
      summary({ activity: { type: {}, familyFriendly: false } }),
    );
    const unmarked = factsFor(
      summary({ activity: { type: {}, familyFriendly: null } }),
    );

    expect(marked).toEqual([{ label: 'With small children', value: 'No' }]);
    expect(unmarked).toEqual([]);
  });

  it('adds the exact duration only when there is one', () => {
    const vague = factsFor(
      summary({ activity: { type: {}, durationBucket: 'half_day' } }),
    );
    const precise = factsFor(
      summary({
        activity: { type: {}, durationBucket: 'half_day', durationMinutes: 240 },
      }),
    );

    expect(vague[0]?.value).toBe('Half a day');
    expect(precise[0]?.value).toBe('Half a day (4 h)');
  });

  it('says nothing about seasons when any time will do', () => {
    expect(seasonLabel(0)).toBeNull();
    expect(seasonLabel(seasonsToMask(['spring', 'summer', 'autumn', 'winter']))).toBeNull();
    expect(seasonLabel(seasonsToMask(['summer']))).toBe('Best in summer');
    expect(seasonLabel(seasonsToMask(['spring', 'autumn']))).toBe(
      'Best in spring and autumn',
    );
    expect(seasonLabel(seasonsToMask(['spring', 'summer', 'autumn']))).toBe(
      'Best in spring, summer and autumn',
    );
  });

  it('formats durations, distances and coordinates', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(120)).toBe('2 h');
    expect(formatMinutes(150)).toBe('2 h 30 min');
    expect(formatDistance(800)).toBe('800 m');
    expect(formatDistance(12400)).toBe('12.4 km');
    expect(formatCoordinates(42.1178, 2.7513)).toBe('42.11780, 2.75130');
    expect(formatCoordinates(null, null)).toBeNull();
  });
});
