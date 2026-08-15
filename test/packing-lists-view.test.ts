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
    const publicIds = view.public.map((list) => list.id);

    expect(view.own).toEqual([]);
    expect(publicIds).toContain(pub);
    expect(publicIds).not.toContain(priv);
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
    expect(view.public.map((list) => list.id)).not.toContain(priv);
  });

  it('keeps the visitor\u2019s own public lists in the public ranking', async () => {
    const user = await signedInUser();
    const pub = await create(user.id, {
      title: 'Shared',
      isPublic: true,
      items: [],
    });

    const view = await loadIndex(user.id);

    expect(view.own.map((list) => list.id)).toContain(pub);
    expect(view.public.map((list) => list.id)).toContain(pub);
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
    expect(view.public.map((list) => list.id)).not.toContain(priv);
  });

  it('orders the public section by favourites and carries the counts', async () => {
    const owner = await signedInUser();
    const fan = await signedInUser();
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

    const view = await loadIndex(fan.id);
    const shown = view.public.filter((list) => [quiet, loved].includes(list.id));

    expect(shown.map((list) => list.id)).toEqual([loved, quiet]);
    expect(shown[0].favouriteCount).toBe(1);
    expect(shown[0].isFavourite).toBe(true);
    expect(shown[0].itemCount).toBe(2);
    expect(shown[1].isFavourite).toBe(false);
  });
});
