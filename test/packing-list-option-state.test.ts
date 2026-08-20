import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadOptionState,
  OPTION_STATE_TTL_MS,
  pruneExpiredOptionState,
  saveOptionState,
} from '../src/lib/packing-list-option-state';

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

let storage: FakeStorage;

beforeEach(() => {
  storage = new FakeStorage();
});

describe('packing list option state', () => {
  it('round-trips the answers', () => {
    saveOptionState(storage, LIST, { cooking: true, wild: false });

    expect(loadOptionState(storage, LIST)).toEqual({
      cooking: true,
      wild: false,
    });
  });

  it('answers null when nothing is stored, so defaults apply', () => {
    expect(loadOptionState(storage, LIST)).toBeNull();
  });

  it('keeps lists apart', () => {
    saveOptionState(storage, LIST, { cooking: true });

    expect(loadOptionState(storage, 'other-list')).toBeNull();
  });

  it('renews the entry on read, so a list in use keeps its answers', () => {
    const now = Date.now();
    saveOptionState(storage, LIST, { cooking: true }, now);

    const revisit = now + OPTION_STATE_TTL_MS - 1;
    expect(loadOptionState(storage, LIST, revisit)).toEqual({ cooking: true });
    expect(
      loadOptionState(storage, LIST, revisit + OPTION_STATE_TTL_MS - 1),
    ).toEqual({ cooking: true });
  });

  it('forgets a list left alone past the window', () => {
    const now = Date.now();
    saveOptionState(storage, LIST, { cooking: true }, now);

    expect(
      loadOptionState(storage, LIST, now + OPTION_STATE_TTL_MS + 1),
    ).toBeNull();
    expect(storage.length).toBe(0);
  });

  it('removes the entry once there is nothing to remember', () => {
    saveOptionState(storage, LIST, { cooking: true });
    saveOptionState(storage, LIST, {});

    expect(storage.length).toBe(0);
  });

  it('treats an unreadable entry as absent', () => {
    storage.setItem('packing-options:list-1', 'not json');
    expect(loadOptionState(storage, LIST)).toBeNull();

    storage.setItem('packing-options:list-1', JSON.stringify({ active: 3 }));
    expect(loadOptionState(storage, LIST)).toBeNull();
  });

  it('lets a toggle work even when storage is full', () => {
    storage.full = true;

    expect(() =>
      saveOptionState(storage, LIST, { cooking: true }),
    ).not.toThrow();
  });

  it('prunes expired entries for every list, not only the one open', () => {
    const now = Date.now();
    saveOptionState(storage, 'old', { cooking: true }, now);
    saveOptionState(storage, 'fresh', { cooking: true }, now + OPTION_STATE_TTL_MS);
    storage.setItem('unrelated', 'left alone');

    pruneExpiredOptionState(storage, now + OPTION_STATE_TTL_MS + 1);

    expect(loadOptionState(storage, 'old')).toBeNull();
    expect(loadOptionState(storage, 'fresh')).not.toBeNull();
    expect(storage.getItem('unrelated')).toBe('left alone');
  });
});
