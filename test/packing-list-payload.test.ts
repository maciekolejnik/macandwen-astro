import { describe, expect, it } from 'vitest';
import { parsePackingListBody } from '../src/lib/packing-list-payload';

/**
 * The endpoints hand this whatever JSON arrived, so the cases below are the
 * shapes a hostile or mistaken client can send, not the ones the editor does.
 */
describe('parsePackingListBody', () => {
  const valid = { title: 'Trip', isPublic: false, items: ['Boots'] };

  it('accepts a well-formed body unchanged', () => {
    expect(parsePackingListBody(valid)).toEqual({ input: valid });
  });

  it('accepts an empty item array', () => {
    expect(parsePackingListBody({ ...valid, items: [] })).toEqual({
      input: { ...valid, items: [] },
    });
  });

  it('leaves the content rules to normaliseInput', () => {
    // Blank and over-long values are a shape-check pass: they are rejected
    // later, in one place, so every caller gets the same answer.
    const untidy = { title: '   ', isPublic: true, items: ['', 'x'.repeat(500)] };

    expect(parsePackingListBody(untidy)).toEqual({ input: untidy });
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

  it('rejects items that are missing, not an array, or not all strings', () => {
    const message = '`items` must be an array of strings';

    for (const items of [undefined, null, 'Boots', {}, 3]) {
      expect(parsePackingListBody({ ...valid, items })).toEqual({ message });
    }
    for (const items of [[1], ['Boots', null], [{}], [['Boots']], [undefined]]) {
      expect(parsePackingListBody({ ...valid, items })).toEqual({ message });
    }
  });

  it('checks the fields in a fixed order, so one bad body gives one answer', () => {
    expect(
      parsePackingListBody({ title: 1, isPublic: 'no', items: 'Boots' }),
    ).toEqual({ message: '`title` must be a string' });
    expect(
      parsePackingListBody({ ...valid, isPublic: 'no', items: 'Boots' }),
    ).toEqual({ message: '`isPublic` must be a boolean' });
  });

  it('ignores fields it was not asked about', () => {
    expect(parsePackingListBody({ ...valid, id: 'spoofed', userId: 'other' })).toEqual(
      { input: valid },
    );
  });
});
