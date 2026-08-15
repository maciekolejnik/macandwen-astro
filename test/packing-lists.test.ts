import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import {
  create,
  favouritedAmong,
  getById,
  listFavourites,
  listOwned,
  listPublic,
  remove,
  setFavourite,
  update,
  ITEM_MAX_LENGTH,
  MAX_ITEMS,
  TITLE_MAX_LENGTH,
} from '../src/lib/db/packing-lists';
import { signedInUser } from './helpers';

async function countRows(table: string, column: string, value: string) {
  const row = await env.DB.prepare(
    `SELECT count(*) AS n FROM ${table} WHERE ${column} = ?`,
  )
    .bind(value)
    .first<{ n: number }>();

  return row?.n ?? 0;
}

describe('packing lists', () => {
  it('stores items in the order they were given', async () => {
    const owner = await signedInUser();
    const id = await create(owner.id, {
      title: 'Weekend hike',
      isPublic: false,
      items: ['Boots', 'Map', 'Water'],
    });

    const list = await getById(id, owner.id);

    expect(list?.title).toBe('Weekend hike');
    expect(list?.items.map((item) => item.text)).toEqual([
      'Boots',
      'Map',
      'Water',
    ]);
    expect(list?.items.map((item) => item.position)).toEqual([0, 1, 2]);
    expect(list?.itemCount).toBe(3);
  });

  it('trims whitespace and drops blank items', async () => {
    const owner = await signedInUser();
    const id = await create(owner.id, {
      title: '  Beach  ',
      isPublic: false,
      items: ['  Towel ', '', '   ', 'Sunscreen'],
    });

    const list = await getById(id, owner.id);

    expect(list?.title).toBe('Beach');
    expect(list?.items.map((item) => item.text)).toEqual([
      'Towel',
      'Sunscreen',
    ]);
  });

  it('rejects input that is empty or over the limits', async () => {
    const owner = await signedInUser();
    const valid = { title: 'Trip', isPublic: false, items: [] };

    await expect(create(owner.id, { ...valid, title: '   ' })).rejects.toThrow();
    await expect(
      create(owner.id, { ...valid, title: 'x'.repeat(TITLE_MAX_LENGTH + 1) }),
    ).rejects.toThrow();
    await expect(
      create(owner.id, { ...valid, items: ['x'.repeat(ITEM_MAX_LENGTH + 1)] }),
    ).rejects.toThrow();
    await expect(
      create(owner.id, { ...valid, items: Array(MAX_ITEMS + 1).fill('x') }),
    ).rejects.toThrow();
  });

  it('hides a private list from everyone but its owner', async () => {
    const owner = await signedInUser();
    const stranger = await signedInUser();
    const id = await create(owner.id, {
      title: 'Secret',
      isPublic: false,
      items: ['Passport'],
    });

    expect(await getById(id, owner.id)).not.toBeNull();
    expect(await getById(id, stranger.id)).toBeNull();
    expect(await getById(id)).toBeNull();
  });

  it('shows a public list to signed-out visitors', async () => {
    const owner = await signedInUser();
    const id = await create(owner.id, {
      title: 'Festival',
      isPublic: true,
      items: ['Tent'],
    });

    const list = await getById(id);

    expect(list?.title).toBe('Festival');
    expect(list?.isOwn).toBe(false);
    expect(list?.isFavourite).toBe(false);
  });

  it('returns null for an unknown id', async () => {
    expect(await getById(crypto.randomUUID())).toBeNull();
  });

  it('lists both private and public lists for their owner', async () => {
    const owner = await signedInUser();
    await create(owner.id, { title: 'Private', isPublic: false, items: [] });
    await create(owner.id, { title: 'Public', isPublic: true, items: [] });

    const owned = await listOwned(owner.id);

    expect(owned.map((list) => list.title).sort()).toEqual([
      'Private',
      'Public',
    ]);
    expect(owned.every((list) => list.isOwn)).toBe(true);
  });

  it('excludes other people from an owner listing', async () => {
    const owner = await signedInUser();
    const stranger = await signedInUser();
    await create(owner.id, { title: 'Mine', isPublic: true, items: [] });

    expect(await listOwned(stranger.id)).toEqual([]);
  });

  it('ranks public lists by favourite count', async () => {
    const owner = await signedInUser();
    const fanOne = await signedInUser();
    const fanTwo = await signedInUser();

    const unpopular = await create(owner.id, {
      title: `Unpopular ${crypto.randomUUID()}`,
      isPublic: true,
      items: [],
    });
    const popular = await create(owner.id, {
      title: `Popular ${crypto.randomUUID()}`,
      isPublic: true,
      items: [],
    });

    await setFavourite(popular, fanOne.id, true);
    await setFavourite(popular, fanTwo.id, true);
    await setFavourite(unpopular, fanOne.id, true);

    const ranked = (await listPublic(fanOne.id)).filter((list) =>
      [popular, unpopular].includes(list.id),
    );

    expect(ranked.map((list) => list.id)).toEqual([popular, unpopular]);
    expect(ranked[0].favouriteCount).toBe(2);
    expect(ranked[0].isFavourite).toBe(true);
  });

  it('keeps private lists out of the public listing', async () => {
    const owner = await signedInUser();
    const id = await create(owner.id, {
      title: 'Hidden',
      isPublic: false,
      items: [],
    });

    const publicIds = (await listPublic(owner.id)).map((list) => list.id);

    expect(publicIds).not.toContain(id);
  });

  it('reports favourite state per viewer', async () => {
    const owner = await signedInUser();
    const fan = await signedInUser();
    const id = await create(owner.id, {
      title: 'Camping',
      isPublic: true,
      items: [],
    });

    await setFavourite(id, fan.id, true);

    expect((await getById(id, fan.id))?.isFavourite).toBe(true);
    expect((await getById(id, owner.id))?.isFavourite).toBe(false);
    expect((await getById(id))?.favouriteCount).toBe(1);
    expect(await favouritedAmong(fan.id, [id])).toEqual(new Set([id]));
    expect(await favouritedAmong(owner.id, [id])).toEqual(new Set());
    expect(await favouritedAmong(fan.id, [])).toEqual(new Set());
  });

  it('favouriting twice counts once, and unfavouriting is idempotent', async () => {
    const owner = await signedInUser();
    const fan = await signedInUser();
    const id = await create(owner.id, {
      title: 'Ski',
      isPublic: true,
      items: [],
    });

    await setFavourite(id, fan.id, true);
    expect(await setFavourite(id, fan.id, true)).toEqual({
      favourite: true,
      favouriteCount: 1,
    });

    await setFavourite(id, fan.id, false);
    expect(await setFavourite(id, fan.id, false)).toEqual({
      favourite: false,
      favouriteCount: 0,
    });
  });

  it('refuses to favourite a private or missing list', async () => {
    const owner = await signedInUser();
    const fan = await signedInUser();
    const id = await create(owner.id, {
      title: 'Private',
      isPublic: false,
      items: [],
    });

    expect(await setFavourite(id, fan.id, true)).toBeNull();
    expect(await setFavourite(crypto.randomUUID(), fan.id, true)).toBeNull();
  });

  it('lists only the viewer their own favourites', async () => {
    const owner = await signedInUser();
    const fan = await signedInUser();
    const other = await signedInUser();
    const id = await create(owner.id, {
      title: 'Sailing',
      isPublic: true,
      items: [],
    });

    await setFavourite(id, fan.id, true);

    expect((await listFavourites(fan.id)).map((list) => list.id)).toContain(id);
    expect((await listFavourites(other.id)).map((list) => list.id)).not.toContain(
      id,
    );
  });

  it('replaces items and visibility on update', async () => {
    const owner = await signedInUser();
    const id = await create(owner.id, {
      title: 'Draft',
      isPublic: false,
      items: ['Old'],
    });

    expect(
      await update(id, owner.id, {
        title: 'Final',
        isPublic: true,
        items: ['New', 'Newer'],
      }),
    ).toBe(true);

    const list = await getById(id);

    expect(list?.title).toBe('Final');
    expect(list?.isPublic).toBe(true);
    expect(list?.items.map((item) => item.text)).toEqual(['New', 'Newer']);
    expect(await countRows('packing_list_item', 'list_id', id)).toBe(2);
  });

  it('clears items when updated with an empty list', async () => {
    const owner = await signedInUser();
    const id = await create(owner.id, {
      title: 'Draft',
      isPublic: false,
      items: ['Old'],
    });

    await update(id, owner.id, { title: 'Draft', isPublic: false, items: [] });

    expect((await getById(id, owner.id))?.items).toEqual([]);
  });

  it('refuses to update or delete someone else\u2019s list', async () => {
    const owner = await signedInUser();
    const stranger = await signedInUser();
    const id = await create(owner.id, {
      title: 'Mine',
      isPublic: true,
      items: ['Keep'],
    });

    expect(
      await update(id, stranger.id, {
        title: 'Stolen',
        isPublic: false,
        items: [],
      }),
    ).toBe(false);
    expect(await remove(id, stranger.id)).toBe(false);

    const list = await getById(id, owner.id);
    expect(list?.title).toBe('Mine');
    expect(list?.items).toHaveLength(1);
  });

  it('deletes a list along with its items and favourites', async () => {
    const owner = await signedInUser();
    const fan = await signedInUser();
    const id = await create(owner.id, {
      title: 'Temporary',
      isPublic: true,
      items: ['Thing'],
    });
    await setFavourite(id, fan.id, true);

    expect(await remove(id, owner.id)).toBe(true);
    expect(await getById(id, owner.id)).toBeNull();
    expect(await countRows('packing_list_item', 'list_id', id)).toBe(0);
    expect(await countRows('packing_list_favourite', 'list_id', id)).toBe(0);
  });

  it('deletes a user\u2019s lists and favourites with the user', async () => {
    const owner = await signedInUser();
    const fan = await signedInUser();
    const id = await create(owner.id, {
      title: 'Goes away',
      isPublic: true,
      items: ['Thing'],
    });
    await setFavourite(id, fan.id, true);

    await env.DB.prepare('DELETE FROM user WHERE id = ?').bind(fan.id).run();
    expect(await countRows('packing_list_favourite', 'user_id', fan.id)).toBe(0);

    await env.DB.prepare('DELETE FROM user WHERE id = ?').bind(owner.id).run();
    expect(await countRows('packing_list', 'user_id', owner.id)).toBe(0);
    expect(await countRows('packing_list_item', 'list_id', id)).toBe(0);
  });
});
