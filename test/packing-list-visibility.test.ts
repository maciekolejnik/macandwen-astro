import { describe, expect, it } from 'vitest';
import {
  defaultActiveOptions,
  isItemVisible,
  resolveActiveOptions,
  type PackingListOption,
} from '../src/lib/packing-list-options';

const option = (
  id: string,
  defaultOn = false,
): PackingListOption => ({ id, label: id, position: 0, defaultOn });

describe('option visibility', () => {
  it('always shows an untagged item', () => {
    expect(isItemVisible([], new Set())).toBe(true);
    expect(isItemVisible([], new Set(['cooking']))).toBe(true);
  });

  it('shows a tagged item when its option is on', () => {
    expect(isItemVisible(['cooking'], new Set(['cooking']))).toBe(true);
    expect(isItemVisible(['cooking'], new Set(['wild']))).toBe(false);
    expect(isItemVisible(['cooking'], new Set())).toBe(false);
  });

  it('shows an item tagged twice when either option is on', () => {
    const tags = ['cooking', 'wild'];

    expect(isItemVisible(tags, new Set(['wild']))).toBe(true);
    expect(isItemVisible(tags, new Set(['cooking', 'wild']))).toBe(true);
    expect(isItemVisible(tags, new Set(['bikes']))).toBe(false);
  });
});

describe('resolving stored answers', () => {
  const options = [option('cooking', true), option('wild')];

  it('falls back to the defaults with nothing stored', () => {
    expect([...defaultActiveOptions(options)]).toEqual(['cooking']);
    expect([...resolveActiveOptions(options, null)]).toEqual(['cooking']);
  });

  it('prefers what the visitor chose', () => {
    const active = resolveActiveOptions(options, { cooking: false, wild: true });

    expect([...active]).toEqual(['wild']);
  });

  it('starts an option added since from its own default', () => {
    const active = resolveActiveOptions(options, { wild: true });

    expect([...active].sort()).toEqual(['cooking', 'wild']);
  });

  it('ignores an answer for an option the list no longer has', () => {
    const active = resolveActiveOptions(options, {
      cooking: true,
      wild: false,
      gone: true,
    });

    expect([...active]).toEqual(['cooking']);
  });
});
