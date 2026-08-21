import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import {
  create,
  getById,
  update,
  remove,
  MAX_OPTIONS,
  OPTION_LABEL_MAX_LENGTH,
} from '../src/lib/db/packing-lists';
import { signedInUser, texts } from './helpers';

async function countRows(table: string, column: string, value: string) {
  const row = await env.DB.prepare(
    `SELECT count(*) AS n FROM ${table} WHERE ${column} = ?`,
  )
    .bind(value)
    .first<{ n: number }>();

  return row?.n ?? 0;
}

/** A list whose options and taggings are worth asserting about. */
async function campingList(ownerId: string) {
  const id = await create(ownerId, {
    title: 'Camping',
    isPublic: false,
    options: [
      { id: 'cooking-tmp', label: 'Cooking', defaultOn: true },
      { id: 'wild-tmp', label: 'Wild camping', defaultOn: false },
    ],
    items: [
      { text: 'Tent' },
      { text: 'Stove', optionIds: ['cooking-tmp'] },
      { text: 'Trowel', optionIds: ['wild-tmp'] },
      { text: 'Water carrier', optionIds: ['cooking-tmp', 'wild-tmp'] },
    ],
  });

  const list = (await getById(id, ownerId))!;
  const optionId = (label: string) =>
    list.options.find((option) => option.label === label)!.id;

  return { id, list, optionId };
}

describe('packing list options', () => {
  it('stores options in order and tags items with them', async () => {
    const owner = await signedInUser();
    const { list, optionId } = await campingList(owner.id);

    expect(list.options.map((option) => option.label)).toEqual([
      'Cooking',
      'Wild camping',
    ]);
    expect(list.options.map((option) => option.position)).toEqual([0, 1]);
    expect(list.options.map((option) => option.defaultOn)).toEqual([true, false]);

    const tags = new Map(list.items.map((item) => [item.text, item.optionIds]));

    expect(tags.get('Tent')).toEqual([]);
    expect(tags.get('Stove')).toEqual([optionId('Cooking')]);
    expect(tags.get('Water carrier')?.sort()).toEqual(
      [optionId('Cooking'), optionId('Wild camping')].sort(),
    );
  });

  it('gives an option a server id, not the one the browser sent', async () => {
    const owner = await signedInUser();
    const { list } = await campingList(owner.id);

    // A client-chosen id could otherwise collide with somebody else's row.
    expect(list.options.map((option) => option.id)).not.toContain('cooking-tmp');
  });

  it('keeps an option id across an update, so saved toggles survive', async () => {
    const owner = await signedInUser();
    const { id, list, optionId } = await campingList(owner.id);
    const cooking = optionId('Cooking');

    await update(id, owner.id, {
      title: 'Camping',
      isPublic: false,
      options: [
        { id: cooking, label: 'Cooking on site', defaultOn: false },
        { label: 'Bikes', defaultOn: false },
      ],
      items: [{ text: 'Stove', optionIds: [cooking] }],
    });

    const updated = (await getById(id, owner.id))!;

    expect(updated.options.map((option) => option.label)).toEqual([
      'Cooking on site',
      'Bikes',
    ]);
    expect(updated.options[0]!.id).toBe(cooking);
    expect(updated.options[0]!.defaultOn).toBe(false);
    // The items were replaced, but the tagging points at the same option.
    expect(updated.items[0]!.optionIds).toEqual([cooking]);
    expect(list.options).toHaveLength(2);
  });

  it('deletes an option the editor no longer sends, and its taggings', async () => {
    const owner = await signedInUser();
    const { id, optionId } = await campingList(owner.id);
    const cooking = optionId('Cooking');

    await update(id, owner.id, {
      title: 'Camping',
      isPublic: false,
      options: [{ id: cooking, label: 'Cooking', defaultOn: true }],
      items: [{ text: 'Trowel', optionIds: [optionId('Wild camping')] }],
    });

    const updated = (await getById(id, owner.id))!;

    expect(updated.options).toHaveLength(1);
    // The tagging named an option that has gone, so the item is always packed.
    expect(updated.items[0]!.optionIds).toEqual([]);
    expect(await countRows('packing_list_option', 'list_id', id)).toBe(1);
  });

  it('drops a tagging that names no option of this list', async () => {
    const owner = await signedInUser();
    const id = await create(owner.id, {
      title: 'Stale form',
      isPublic: false,
      options: [{ id: 'known', label: 'Cooking', defaultOn: false }],
      items: [{ text: 'Stove', optionIds: ['known', crypto.randomUUID()] }],
    });

    const list = (await getById(id, owner.id))!;

    expect(list.items[0]!.optionIds).toEqual([list.options[0]!.id]);
  });

  it('trims labels, drops blank options and rejects duplicates', async () => {
    const owner = await signedInUser();
    const id = await create(owner.id, {
      title: 'Trip',
      isPublic: false,
      options: [
        { label: '  Cooking  ', defaultOn: false },
        { label: '   ', defaultOn: false },
      ],
      items: texts(),
    });

    const list = (await getById(id, owner.id))!;
    expect(list.options.map((option) => option.label)).toEqual(['Cooking']);

    await expect(
      create(owner.id, {
        title: 'Trip',
        isPublic: false,
        options: [
          { label: 'Cooking', defaultOn: false },
          { label: 'cooking', defaultOn: false },
        ],
        items: texts(),
      }),
    ).rejects.toThrow();
  });

  it('rejects too many options and labels that are too long', async () => {
    const owner = await signedInUser();
    const valid = { title: 'Trip', isPublic: false, items: texts() };

    await expect(
      create(owner.id, {
        ...valid,
        options: Array.from({ length: MAX_OPTIONS + 1 }, (_, index) => ({
          label: `Option ${index}`,
          defaultOn: false,
        })),
      }),
    ).rejects.toThrow();

    await expect(
      create(owner.id, {
        ...valid,
        options: [
          { label: 'x'.repeat(OPTION_LABEL_MAX_LENGTH + 1), defaultOn: false },
        ],
      }),
    ).rejects.toThrow();
  });

  it('removes options and taggings when the list goes', async () => {
    const owner = await signedInUser();
    const { id, list } = await campingList(owner.id);

    expect(
      await countRows('packing_list_item_option', 'item_id', list.items[1]!.id),
    ).toBe(1);

    await remove(id, owner.id);

    expect(await countRows('packing_list_option', 'list_id', id)).toBe(0);
    expect(
      await countRows('packing_list_item_option', 'item_id', list.items[1]!.id),
    ).toBe(0);
  });

  it('leaves a list without options exactly as it was', async () => {
    const owner = await signedInUser();
    const id = await create(owner.id, {
      title: 'Day hike',
      isPublic: false,
      items: texts('Boots', 'Map'),
    });

    const list = (await getById(id, owner.id))!;

    expect(list.options).toEqual([]);
    expect(list.items.map((item) => item.optionIds)).toEqual([[], []]);
  });
});
