import { describe, expect, it } from 'vitest';
import { parsePackingListBody } from '../src/lib/packing-list-payload';

/**
 * The endpoints hand this whatever JSON arrived, so the cases below are the
 * shapes a hostile or mistaken client can send, not the ones the editor does.
 */
describe('parsePackingListBody', () => {
  const valid = { title: 'Trip', isPublic: false, items: [{ text: 'Boots' }] };
  /** What the parser fills in for what the body left out. */
  const parsed = {
    ...valid,
    items: [{ text: 'Boots', optionIds: [] }],
    options: [],
  };

  it('accepts a well-formed body unchanged', () => {
    expect(parsePackingListBody(valid)).toEqual({ input: parsed });
  });

  it('accepts an empty item array', () => {
    expect(parsePackingListBody({ ...valid, items: [] })).toEqual({
      input: { ...parsed, items: [] },
    });
  });

  it('accepts a body with no options, which is most of them', () => {
    expect(parsePackingListBody(valid)).toEqual({
      input: { ...parsed, options: [] },
    });
  });

  it('accepts options and the items tagged with them', () => {
    const body = {
      title: 'Camping',
      isPublic: false,
      options: [{ id: 'o1', label: 'Cooking', defaultOn: true }],
      items: [{ text: 'Stove', optionIds: ['o1'] }],
    };

    expect(parsePackingListBody(body)).toEqual({ input: body });
  });

  it('defaults an option that does not say whether it starts on', () => {
    expect(
      parsePackingListBody({ ...valid, options: [{ label: 'Cooking' }] }),
    ).toEqual({
      input: {
        ...parsed,
        options: [{ id: undefined, label: 'Cooking', defaultOn: false }],
      },
    });
  });

  it('leaves the content rules to normaliseInput', () => {
    // Blank and over-long values are a shape-check pass: they are rejected
    // later, in one place, so every caller gets the same answer.
    const untidy = {
      title: '   ',
      isPublic: true,
      items: [{ text: '' }, { text: 'x'.repeat(500) }],
      options: [{ label: '  ', defaultOn: false }],
    };

    expect(parsePackingListBody(untidy)).toEqual({
      input: {
        ...untidy,
        items: [
          { text: '', optionIds: [] },
          { text: 'x'.repeat(500), optionIds: [] },
        ],
        options: [{ id: undefined, label: '  ', defaultOn: false }],
      },
    });
  });

  it('rejects a title that is missing or not a string', () => {
    for (const title of [undefined, null, 42, true, [], {}]) {
      expect(parsePackingListBody({ ...valid, title })).toEqual({
        message: '`title` must be a string',
      });
    }
  });

  it('rejects an isPublic that is missing or not a boolean', () => {
    for (const isPublic of [undefined, null, 'true', 0, 1, []]) {
      expect(parsePackingListBody({ ...valid, isPublic })).toEqual({
        message: '`isPublic` must be a boolean',
      });
    }
  });

  it('rejects items that are missing, not an array, or not all objects', () => {
    const message = '`items` must be an array of objects';

    for (const items of [undefined, null, 'Boots', {}, 3]) {
      expect(parsePackingListBody({ ...valid, items })).toEqual({ message });
    }
    for (const items of [[1], ['Boots'], [null], [['Boots']], [undefined]]) {
      expect(parsePackingListBody({ ...valid, items })).toEqual({ message });
    }
  });

  it('rejects an item whose text or tags are the wrong type', () => {
    for (const item of [{}, { text: 7 }, { text: null }]) {
      expect(parsePackingListBody({ ...valid, items: [item] })).toEqual({
        message: 'Each item needs a `text` string',
      });
    }

    for (const optionIds of ['o1', 3, [7], [null]]) {
      expect(
        parsePackingListBody({ ...valid, items: [{ text: 'Boots', optionIds }] }),
      ).toEqual({ message: 'Each item `optionIds` must be an array of strings' });
    }
  });

  it('rejects options that are not objects with a label', () => {
    for (const options of ['Cooking', 3, [1], ['Cooking'], [null]]) {
      expect(parsePackingListBody({ ...valid, options })).toEqual({
        message: '`options` must be an array of objects',
      });
    }

    expect(parsePackingListBody({ ...valid, options: [{}] })).toEqual({
      message: 'Each option needs a `label` string',
    });
    expect(
      parsePackingListBody({ ...valid, options: [{ id: 7, label: 'Cooking' }] }),
    ).toEqual({ message: 'Each option `id` must be a string' });
    expect(
      parsePackingListBody({
        ...valid,
        options: [{ label: 'Cooking', defaultOn: 'yes' }],
      }),
    ).toEqual({ message: 'Each option `defaultOn` must be a boolean' });
  });

  it('checks the fields in a fixed order, so one bad body gives one answer', () => {
    expect(
      parsePackingListBody({ title: 1, isPublic: 'no', items: 'Boots' }),
    ).toEqual({ message: '`title` must be a string' });
    expect(
      parsePackingListBody({ ...valid, isPublic: 'no', items: 'Boots' }),
    ).toEqual({ message: '`isPublic` must be a boolean' });
    expect(
      parsePackingListBody({ ...valid, options: 'Cooking', items: 'Boots' }),
    ).toEqual({ message: '`options` must be an array of objects' });
  });

  it('ignores fields it was not asked about', () => {
    expect(parsePackingListBody({ ...valid, id: 'spoofed', userId: 'other' })).toEqual(
      { input: parsed },
    );
  });
});
