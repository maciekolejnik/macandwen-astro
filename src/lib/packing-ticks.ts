/**
 * Tick state for a packing list: which items the visitor has checked off.
 *
 * Deliberately *not* in the database. A packing list is a template; ticking it
 * is one occasion of using it, which belongs to a trip rather than to the list.
 * Until trips exist, ticks are per-device scratch state — kept in localStorage
 * so they survive a refresh, and expiring on their own so a list does not open
 * three weeks later still half-packed.
 *
 * Written against the `Storage` interface rather than reaching for
 * `localStorage` directly, so the rules below can be tested.
 */

/**
 * How long ticks survive *without being looked at*. The window slides: opening
 * a list renews it, so a fortnight-long trip keeps its ticks for as long as it
 * is being packed, while a list opened once and abandoned still clears itself.
 *
 * That is why this is not a setting. A fixed lifetime measured from when the
 * ticks were made is wrong at every value — too short for a long trip, too long
 * for a forgotten one — and asking someone to predict their trip length before
 * ticking a box is a worse answer than simply noticing they came back.
 */
export const TICK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const PREFIX = 'packing-ticks:';

type StoredTicks = {
  /** When the ticks were last changed, for expiry. */
  savedAt: number;
  /** Item ids, so ticks for items that have since been removed simply vanish. */
  items: string[];
};

function keyFor(listId: string) {
  return `${PREFIX}${listId}`;
}

function isStoredTicks(value: unknown): value is StoredTicks {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<StoredTicks>;

  return (
    typeof candidate.savedAt === 'number' &&
    Array.isArray(candidate.items) &&
    candidate.items.every((item) => typeof item === 'string')
  );
}

/**
 * Ticks for `listId`, limited to `itemIds` and dropped once past the TTL.
 *
 * Reading renews the entry, which is what makes the window slide. Anything
 * unreadable is treated as absent: this is scratch state, so a corrupt or
 * hand-edited entry should quietly reset rather than break the page.
 */
export function loadTicks(
  storage: Storage,
  listId: string,
  itemIds: string[],
  now = Date.now(),
): Set<string> {
  let parsed: unknown;

  try {
    const raw = storage.getItem(keyFor(listId));
    if (!raw) return new Set();
    parsed = JSON.parse(raw);
  } catch {
    return new Set();
  }

  if (!isStoredTicks(parsed) || now - parsed.savedAt > TICK_TTL_MS) {
    storage.removeItem(keyFor(listId));
    return new Set();
  }

  const known = new Set(itemIds);
  const ticked = new Set(parsed.items.filter((id) => known.has(id)));

  // Renew on read, so a list in active use keeps its ticks. Writing back the
  // filtered set also drops ticks for items the list no longer has.
  saveTicks(storage, listId, ticked, now);

  return ticked;
}

/** Saves ticks, removing the entry entirely once nothing is ticked. */
export function saveTicks(
  storage: Storage,
  listId: string,
  ticked: Iterable<string>,
  now = Date.now(),
): void {
  const items = [...ticked];

  try {
    if (items.length === 0) {
      storage.removeItem(keyFor(listId));
      return;
    }

    const payload: StoredTicks = { savedAt: now, items };
    storage.setItem(keyFor(listId), JSON.stringify(payload));
  } catch {
    // A full or blocked storage must not stop the box from being ticked; the
    // checkbox still works, it just will not outlive the page.
  }
}

/**
 * Drops expired entries for every list, not only the one being viewed, so
 * abandoned lists cannot accumulate in a visitor's browser indefinitely.
 */
export function pruneExpiredTicks(storage: Storage, now = Date.now()): void {
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

    if (!isStoredTicks(parsed) || now - parsed.savedAt > TICK_TTL_MS) {
      stale.push(key);
    }
  }

  for (const key of stale) storage.removeItem(key);
}
