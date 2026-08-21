/**
 * Which options a visitor has turned on for a list, per device.
 *
 * The same kind of state as ticks — one occasion of using a template, not part
 * of the template — and kept the same way: in `localStorage`, with a window
 * that slides on every read, so a list in daily use keeps its answers and one
 * opened once forgets them.
 *
 * Its own module rather than a field inside `packing-ticks.ts`, because the two
 * answer different questions and a corrupt entry for one should not reset the
 * other.
 *
 * Written against `Storage` rather than reaching for `localStorage`, so the
 * rules below can be tested.
 */

/** As for ticks: long enough for a trip, short enough to forget one. */
export const OPTION_STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const PREFIX = 'packing-options:';

type StoredOptions = {
  savedAt: number;
  /**
   * Explicit per option, so an option added to the list since this was written
   * falls back to its own default instead of silently starting off.
   */
  active: Record<string, boolean>;
};

function keyFor(listId: string) {
  return `${PREFIX}${listId}`;
}

function isStoredOptions(value: unknown): value is StoredOptions {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<StoredOptions>;

  return (
    typeof candidate.savedAt === 'number' &&
    !!candidate.active &&
    typeof candidate.active === 'object' &&
    !Array.isArray(candidate.active) &&
    Object.values(candidate.active).every((on) => typeof on === 'boolean')
  );
}

/**
 * The stored answers for `listId`, or `null` when there are none — which the
 * caller reads as "use each option's default".
 *
 * Reading renews the entry, which is what makes the window slide. Anything
 * unreadable counts as absent: this is scratch state, so a corrupt entry should
 * quietly reset rather than break the page.
 */
export function loadOptionState(
  storage: Storage,
  listId: string,
  now = Date.now(),
): Record<string, boolean> | null {
  let parsed: unknown;

  try {
    const raw = storage.getItem(keyFor(listId));
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isStoredOptions(parsed) || now - parsed.savedAt > OPTION_STATE_TTL_MS) {
    storage.removeItem(keyFor(listId));
    return null;
  }

  saveOptionState(storage, listId, parsed.active, now);

  return parsed.active;
}

/** Saves the answers, removing the entry entirely once there are none. */
export function saveOptionState(
  storage: Storage,
  listId: string,
  active: Record<string, boolean>,
  now = Date.now(),
): void {
  try {
    if (Object.keys(active).length === 0) {
      storage.removeItem(keyFor(listId));
      return;
    }

    const payload: StoredOptions = { savedAt: now, active };
    storage.setItem(keyFor(listId), JSON.stringify(payload));
  } catch {
    // A full or blocked storage must not stop a toggle working; it just will
    // not outlive the page.
  }
}

/**
 * Drops expired entries for every list, not only the one being viewed, so
 * abandoned lists cannot accumulate in a visitor's browser.
 */
export function pruneExpiredOptionState(
  storage: Storage,
  now = Date.now(),
): void {
  const stale: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(PREFIX)) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(storage.getItem(key) ?? '');
    } catch {
      stale.push(key);
      continue;
    }

    if (!isStoredOptions(parsed) || now - parsed.savedAt > OPTION_STATE_TTL_MS) {
      stale.push(key);
    }
  }

  for (const key of stale) storage.removeItem(key);
}
