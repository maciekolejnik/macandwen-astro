import { describe, expect, it } from 'vitest';
import { create, setFavourite } from '../src/lib/db/packing-lists';
import { applyFilters, loadIndex } from '../src/lib/packing-lists-view';
import { signedInUser, texts } from './helpers';

describe('packing lists index view', () => {
  it('shows a signed-out visitor public lists only', async () => {
    const owner = await signedInUser();
    const priv = await create(owner.id, {
      title: 'Private',
      isPublic: false,
      items: texts(),
    });
    const pub = await create(owner.id, {
      title: 'Public',
      isPublic: true,
      items: texts(),
    });

    const view = await loadIndex();
    const browseIds = view.browse.map((list) => list.id);

    expect(view.own).toEqual([]);
    expect(view.saved).toEqual([]);
    expect(browseIds).toContain(pub);
    expect(browseIds).not.toContain(priv);
  });

  it('shows a signed-in visitor their own lists, private included', async () => {
    const user = await signedInUser();
    const priv = await create(user.id, {
      title: 'Private',
      isPublic: false,
      items: texts(),
    });

    const view = await loadIndex(user.id);

    expect(view.own.map((list) => list.id)).toContain(priv);
    expect(view.browse.map((list) => list.id)).not.toContain(priv);
  });

  it('keeps the visitor\u2019s own public lists out of the browse section', async () => {
    const user = await signedInUser();
    const pub = await create(user.id, {
      title: 'Shared',
      isPublic: true,
      items: texts(),
    });

    const view = await loadIndex(user.id);

    expect(view.own.map((list) => list.id)).toContain(pub);
    expect(view.browse.map((list) => list.id)).not.toContain(pub);
  });

  it('moves a saved list into its own section and out of browse', async () => {
    const owner = await signedInUser();
    const fan = await signedInUser();
    const list = await create(owner.id, {
      title: 'Shared',
      isPublic: true,
      items: texts('One'),
    });
    await setFavourite(list, fan.id, true);

    const view = await loadIndex(fan.id);

    expect(view.saved.map((entry) => entry.id)).toEqual([list]);
    expect(view.browse.map((entry) => entry.id)).not.toContain(list);
    expect(view.saved[0].favouriteCount).toBe(1);
    expect(view.saved[0].isFavourite).toBe(true);
  });

  it('never leaks another user\u2019s private list', async () => {
    const owner = await signedInUser();
    const stranger = await signedInUser();
    const priv = await create(owner.id, {
      title: 'Secret',
      isPublic: false,
      items: texts(),
    });

    const view = await loadIndex(stranger.id);

    expect(view.own).toEqual([]);
    expect(view.browse.map((list) => list.id)).not.toContain(priv);
  });

  it('orders the browse section by saves and carries the counts', async () => {
    const owner = await signedInUser();
    const fan = await signedInUser();
    const visitor = await signedInUser();
    const quiet = await create(owner.id, {
      title: 'Quiet',
      isPublic: true,
      items: texts('One'),
    });
    const loved = await create(owner.id, {
      title: 'Loved',
      isPublic: true,
      items: texts('One', 'Two'),
    });
    await setFavourite(loved, fan.id, true);

    const view = await loadIndex(visitor.id);
    const shown = view.browse.filter((list) => [quiet, loved].includes(list.id));

    expect(shown.map((list) => list.id)).toEqual([loved, quiet]);
    expect(shown[0].favouriteCount).toBe(1);
    expect(shown[0].isFavourite).toBe(false);
    expect(shown[0].itemCount).toBe(2);
  });
});

describe('index view items', () => {
  it('carries each list\u2019s item texts, in order, for searching', async () => {
    const user = await signedInUser();
    await create(user.id, {
      title: 'Ski trip',
      isPublic: false,
      items: texts('Skis', 'Goggles', 'Balm'),
    });

    const view = await loadIndex(user.id);

    expect(view.own[0].items).toEqual(['Skis', 'Goggles', 'Balm']);
  });

  it('gives a list with no items an empty array rather than leaving it out', async () => {
    const user = await signedInUser();
    await create(user.id, { title: 'Someday', isPublic: false, items: texts() });

    const view = await loadIndex(user.id);

    expect(view.own[0].items).toEqual([]);
  });
});

describe('applyFilters', () => {
  const entry = (id: string, title: string, items: string[] = []) =>
    ({ id, title, items }) as never;

  const view = {
    own: [entry('a', 'Ski trip', ['Goggles']), entry('b', 'Gym bag')],
    saved: [entry('c', 'Camping', ['Tent'])],
    browse: [entry('d', 'Beach day', ['Towel']), entry('e', 'City break')],
  };

  const section = (result: ReturnType<typeof applyFilters>, key: string) =>
    result.sections.find((candidate) => candidate.key === key)!;

  const visibleIds = (result: ReturnType<typeof applyFilters>, key: string) =>
    section(result, key)
      .entries.filter((item) => item.visible)
      .map((item) => item.list.id);

  it('shows everything when nothing is filtered', () => {
    const result = applyFilters(view, {
      show: ['mine', 'saved', 'public'],
      query: '',
    });

    expect(visibleIds(result, 'mine')).toEqual(['a', 'b']);
    expect(visibleIds(result, 'saved')).toEqual(['c']);
    expect(visibleIds(result, 'public')).toEqual(['d', 'e']);
    expect(result.empty).toBe(false);
  });

  it('hides an unselected section without dropping its lists', () => {
    const result = applyFilters(view, { show: ['saved'], query: '' });

    expect(section(result, 'mine').visible).toBe(false);
    expect(section(result, 'mine').entries).toHaveLength(2);
    expect(visibleIds(result, 'mine')).toEqual([]);
    expect(section(result, 'saved').visible).toBe(true);
  });

  it('searches titles and items across every section', () => {
    const result = applyFilters(view, {
      show: ['mine', 'saved', 'public'],
      query: 'tent',
    });

    expect(visibleIds(result, 'saved')).toEqual(['c']);
    expect(visibleIds(result, 'mine')).toEqual([]);
    expect(section(result, 'mine').visible).toBe(false);
    expect(result.empty).toBe(false);
  });

  it('orders a searched section by how well each list matches', () => {
    const searched = {
      own: [
        entry('mention', 'Weekend', ['Ski socks']),
        entry('titled', 'Ski trip'),
      ],
      saved: [],
      browse: [],
    };

    const result = applyFilters(searched, {
      show: ['mine', 'saved', 'public'],
      query: 'ski',
    });

    expect(visibleIds(result, 'mine')).toEqual(['titled', 'mention']);
  });

  it('keeps the given order when there is no query', () => {
    const result = applyFilters(view, {
      show: ['mine', 'saved', 'public'],
      query: '',
    });

    expect(section(result, 'public').entries.map((item) => item.list.id)).toEqual([
      'd',
      'e',
    ]);
  });

  it('reports when the filters hide every list there is', () => {
    const result = applyFilters(view, {
      show: ['mine', 'saved', 'public'],
      query: 'snorkel',
    });

    expect(result.empty).toBe(true);
  });

  it('does not call an empty account empty-handed', () => {
    const result = applyFilters(
      { own: [], saved: [], browse: [] },
      { show: ['mine', 'saved', 'public'], query: 'ski' },
    );

    // Nothing is hidden, so the sections keep their invitations to start one.
    expect(result.empty).toBe(false);
    expect(section(result, 'mine').visible).toBe(true);
  });
});
