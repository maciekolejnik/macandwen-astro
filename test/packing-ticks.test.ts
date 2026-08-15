import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadTicks,
  pruneExpiredTicks,
  saveTicks,
  TICK_TTL_MS,
} from '../src/lib/packing-ticks';

/** Enough of the `Storage` interface for the module, plus a way to break it. */
class FakeStorage implements Storage {
  private entries = new Map<string, string>();
  full = false;

  get length() {
    return this.entries.size;
  }

  key(index: number) {
    return [...this.entries.keys()][index] ?? null;
  }

  getItem(key: string) {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.full) throw new Error('QuotaExceededError');
    this.entries.set(key, value);
  }

  removeItem(key: string) {
    this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }
}

const LIST = 'list-1';
const ITEMS = ['item-a', 'item-b', 'item-c'];

let storage: FakeStorage;

beforeEach(() => {
  storage = new FakeStorage();
});

describe('packing ticks', () => {
  it('round-trips ticked items', () => {
    saveTicks(storage, LIST, ['item-a', 'item-c']);

    expect(loadTicks(storage, LIST, ITEMS)).toEqual(
      new Set(['item-a', 'item-c']),
    );
  });

  it('keeps lists apart', () => {
    saveTicks(storage, LIST, ['item-a']);

    expect(loadTicks(storage, 'other-list', ITEMS)).toEqual(new Set());
  });

  it('forgets ticks once the day is up', () => {
    const now = Date.now();
    saveTicks(storage, LIST, ['item-a'], now);

    expect(loadTicks(storage, LIST, ITEMS, now + TICK_TTL_MS - 1)).toEqual(
      new Set(['item-a']),
    );
    expect(loadTicks(storage, LIST, ITEMS, now + TICK_TTL_MS + 1)).toEqual(
      new Set(),
    );
  });

  it('drops the entry when it expires, rather than reading it again', () => {
    const now = Date.now();
    saveTicks(storage, LIST, ['item-a'], now);

    loadTicks(storage, LIST, ITEMS, now + TICK_TTL_MS + 1);

    expect(storage.length).toBe(0);
  });

  it('ignores ticks for items the list no longer has', () => {
    saveTicks(storage, LIST, ['item-a', 'item-gone']);

    expect(loadTicks(storage, LIST, ITEMS)).toEqual(new Set(['item-a']));
  });

  it('clears the entry when the last tick is removed', () => {
    saveTicks(storage, LIST, ['item-a']);
    saveTicks(storage, LIST, []);

    expect(storage.length).toBe(0);
    expect(loadTicks(storage, LIST, ITEMS)).toEqual(new Set());
  });

  it('treats unreadable state as no ticks', () => {
    for (const raw of ['not json', '{}', '[]', '{"savedAt":"soon","items":[]}']) {
      storage.setItem(`packing-ticks:${LIST}`, raw);

      expect(loadTicks(storage, LIST, ITEMS), raw).toEqual(new Set());
    }
  });

  it('survives storage that refuses to write', () => {
    storage.full = true;

    expect(() => saveTicks(storage, LIST, ['item-a'])).not.toThrow();
  });

  it('prunes expired entries for every list', () => {
    const now = Date.now();
    saveTicks(storage, 'fresh', ['item-a'], now);
    saveTicks(storage, 'stale', ['item-a'], now - TICK_TTL_MS - 1);
    storage.setItem('packing-ticks:broken', 'not json');
    storage.setItem('unrelated', 'left alone');

    pruneExpiredTicks(storage, now);

    expect(storage.getItem('packing-ticks:fresh')).not.toBeNull();
    expect(storage.getItem('packing-ticks:stale')).toBeNull();
    expect(storage.getItem('packing-ticks:broken')).toBeNull();
    expect(storage.getItem('unrelated')).toBe('left alone');
  });
});
