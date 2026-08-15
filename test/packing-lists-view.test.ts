import { describe, expect, it } from 'vitest';
import { create, setFavourite } from '../src/lib/db/packing-lists';
import { loadIndex } from '../src/lib/packing-lists-view';
import { signedInUser } from './helpers';

describe('packing lists index view', () => {
  it('shows a signed-out visitor public lists only', async () => {
    const owner = await signedInUser();
    const priv = await create(owner.id, {
      title: 'Private',
      isPublic: false,
      items: [],
    });
    const pub = await create(owner.id, {
      title: 'Public',
      isPublic: true,
      items: [],
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
      items: [],
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
      items: [],
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
      items: ['One'],
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
      items: [],
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
      items: ['One'],
    });
    const loved = await create(owner.id, {
      title: 'Loved',
      isPublic: true,
      items: ['One', 'Two'],
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
