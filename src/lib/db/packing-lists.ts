import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { getDb } from './client';
import {
  ITEM_MAX_LENGTH,
  MAX_ITEMS,
  TITLE_MAX_LENGTH,
} from '../packing-list-limits';
import {
  packingList,
  packingListFavourite,
  packingListItem,
  user,
} from './schema';

export type PackingListSummary = {
  id: string;
  title: string;
  isPublic: boolean;
  userId: string;
  ownerName: string;
  createdAt: Date;
  updatedAt: Date;
  itemCount: number;
  favouriteCount: number;
  isFavourite: boolean;
  isOwn: boolean;
};

export type PackingListDetail = PackingListSummary & {
  items: { id: string; text: string; position: number }[];
};

export type PackingListInput = {
  title: string;
  isPublic: boolean;
  items: string[];
};

// Defined in their own module so the browser can import them without Drizzle.
export {
  ITEM_MAX_LENGTH,
  MAX_ITEMS,
  TITLE_MAX_LENGTH,
} from '../packing-list-limits';

const favouriteCount = sql<number>`(
  select count(*) from ${packingListFavourite}
  where ${packingListFavourite.listId} = ${packingList.id}
)`;

const itemCount = sql<number>`(
  select count(*) from ${packingListItem}
  where ${packingListItem.listId} = ${packingList.id}
)`;

/**
 * `viewerId` is threaded through every read so a signed-in visitor gets their
 * own favourite state in the same query, instead of a second round trip.
 */
function isFavouriteOf(viewerId: string | undefined) {
  if (!viewerId) return sql<number>`0`;

  return sql<number>`(
    select count(*) from ${packingListFavourite}
    where ${packingListFavourite.listId} = ${packingList.id}
      and ${packingListFavourite.userId} = ${viewerId}
  )`;
}

function summarySelection(viewerId: string | undefined) {
  return {
    id: packingList.id,
    title: packingList.title,
    isPublic: packingList.isPublic,
    userId: packingList.userId,
    ownerName: user.name,
    createdAt: packingList.createdAt,
    updatedAt: packingList.updatedAt,
    itemCount,
    favouriteCount,
    isFavourite: isFavouriteOf(viewerId),
  };
}

type SummaryRow = {
  id: string;
  title: string;
  isPublic: boolean;
  userId: string;
  ownerName: string;
  createdAt: Date;
  updatedAt: Date;
  itemCount: number;
  favouriteCount: number;
  isFavourite: number;
};

function toSummary(
  row: SummaryRow,
  viewerId: string | undefined,
): PackingListSummary {
  return {
    ...row,
    itemCount: Number(row.itemCount),
    favouriteCount: Number(row.favouriteCount),
    isFavourite: Number(row.isFavourite) > 0,
    isOwn: row.userId === viewerId,
  };
}

/** Every list owned by `userId`, private and public alike, newest first. */
export async function listOwned(userId: string): Promise<PackingListSummary[]> {
  const rows = await getDb()
    .select(summarySelection(userId))
    .from(packingList)
    .innerJoin(user, eq(user.id, packingList.userId))
    .where(eq(packingList.userId, userId))
    .orderBy(desc(packingList.updatedAt));

  return rows.map((row) => toSummary(row, userId));
}

/**
 * Public lists ranked by favourites, newest first among ties. The viewer's own
 * public lists are included: they are visible to everyone else, so hiding them
 * here would misrepresent the ranking.
 */
export async function listPublic(
  viewerId?: string,
): Promise<PackingListSummary[]> {
  const rows = await getDb()
    .select(summarySelection(viewerId))
    .from(packingList)
    .innerJoin(user, eq(user.id, packingList.userId))
    .where(eq(packingList.isPublic, true))
    .orderBy(desc(favouriteCount), desc(packingList.createdAt));

  return rows.map((row) => toSummary(row, viewerId));
}

/** Public lists the viewer has favourited, in the same ranking as `listPublic`. */
export async function listFavourites(
  viewerId: string,
): Promise<PackingListSummary[]> {
  const rows = await getDb()
    .select(summarySelection(viewerId))
    .from(packingList)
    .innerJoin(user, eq(user.id, packingList.userId))
    .innerJoin(
      packingListFavourite,
      and(
        eq(packingListFavourite.listId, packingList.id),
        eq(packingListFavourite.userId, viewerId),
      ),
    )
    .where(eq(packingList.isPublic, true))
    .orderBy(desc(favouriteCount), desc(packingList.createdAt));

  return rows.map((row) => toSummary(row, viewerId));
}

/**
 * Returns `null` for a missing list *and* for a private list the viewer does
 * not own, so callers cannot distinguish the two and probe for existence.
 */
export async function getById(
  id: string,
  viewerId?: string,
): Promise<PackingListDetail | null> {
  const [row] = await getDb()
    .select(summarySelection(viewerId))
    .from(packingList)
    .innerJoin(user, eq(user.id, packingList.userId))
    .where(eq(packingList.id, id))
    .limit(1);

  if (!row) return null;

  const summary = toSummary(row, viewerId);
  if (!summary.isPublic && !summary.isOwn) return null;

  const items = await getDb()
    .select({
      id: packingListItem.id,
      text: packingListItem.text,
      position: packingListItem.position,
    })
    .from(packingListItem)
    .where(eq(packingListItem.listId, id))
    .orderBy(asc(packingListItem.position));

  return { ...summary, items };
}

/**
 * An `in (...)` binds one variable per id, and SQLite caps a statement at 100
 * on D1, so any query over a page's worth of lists has to be split. The id
 * lists here come from whatever the site has grown to, not from a caller's
 * choice, so the ceiling would otherwise be reached by simply having enough
 * lists. Kept below the cap to leave room for the query's other bindings.
 */
const IDS_PER_QUERY = 90;

function chunked<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }

  return chunks;
}

/**
 * The item texts of several lists at once, keyed by list id.
 *
 * The index needs them to search inside lists, and one query for the whole page
 * beats one per card. Access is the caller's problem: this is only ever handed
 * ids that a listing already decided the viewer may see.
 */
export async function itemTextsFor(
  ids: string[],
): Promise<Map<string, string[]>> {
  const texts = new Map<string, string[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return texts;

  const batches = await Promise.all(
    chunked(ids, IDS_PER_QUERY).map((chunk) =>
      getDb()
        .select({
          listId: packingListItem.listId,
          text: packingListItem.text,
        })
        .from(packingListItem)
        .where(inArray(packingListItem.listId, chunk))
        .orderBy(asc(packingListItem.listId), asc(packingListItem.position)),
    ),
  );

  for (const rows of batches) {
    for (const row of rows) texts.get(row.listId)?.push(row.text);
  }

  return texts;
}

/**
 * Distinguishable from a genuine failure so callers can answer 400 rather than
 * 500, and so the message is safe to show a visitor — every one is written for
 * them to read.
 */
export class PackingListValidationError extends Error {
  readonly name = 'PackingListValidationError';
}

function invalid(message: string): never {
  throw new PackingListValidationError(message);
}

export function normaliseInput(input: PackingListInput) {
  const title = input.title.trim();
  const items = input.items
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (!title) invalid('A packing list needs a title');
  if (title.length > TITLE_MAX_LENGTH) {
    invalid(`Title must be ${TITLE_MAX_LENGTH} characters or fewer`);
  }
  if (items.length > MAX_ITEMS) {
    invalid(`A packing list can hold at most ${MAX_ITEMS} items`);
  }
  if (items.some((item) => item.length > ITEM_MAX_LENGTH)) {
    invalid(`Items must be ${ITEM_MAX_LENGTH} characters or fewer`);
  }

  return { title, isPublic: input.isPublic, items };
}

function itemRows(listId: string, items: string[]) {
  return items.map((text, position) => ({
    id: crypto.randomUUID(),
    listId,
    text,
    position,
  }));
}

/**
 * SQLite caps a statement at 100 bound variables on D1, and a multi-row insert
 * binds one per column per row — four here — so a single `values()` call breaks
 * somewhere past twenty items. The rows are split into statements that stay
 * under the cap; a `batch` runs them atomically, so a long list is still all or
 * nothing.
 */
const ITEMS_PER_INSERT = 25;

function insertItemsStatements(
  db: ReturnType<typeof getDb>,
  listId: string,
  items: string[],
) {
  const rows = itemRows(listId, items);
  const statements = [];

  for (let i = 0; i < rows.length; i += ITEMS_PER_INSERT) {
    statements.push(
      db.insert(packingListItem).values(rows.slice(i, i + ITEMS_PER_INSERT)),
    );
  }

  return statements;
}

export async function create(
  userId: string,
  input: PackingListInput,
): Promise<string> {
  const { title, isPublic, items } = normaliseInput(input);
  const id = crypto.randomUUID();

  const db = getDb();
  const insertList = db
    .insert(packingList)
    .values({ id, userId, title, isPublic });

  // D1 has no interactive transactions; `batch` is the atomic equivalent.
  if (items.length) {
    await db.batch([insertList, ...insertItemsStatements(db, id, items)]);
  } else {
    await insertList;
  }

  return id;
}

/**
 * Replaces the whole list, items included: the editor submits the full set, so
 * diffing rows would add complexity without changing the result.
 * Returns `false` when the list is missing or owned by someone else.
 */
export async function update(
  id: string,
  userId: string,
  input: PackingListInput,
): Promise<boolean> {
  const { title, isPublic, items } = normaliseInput(input);

  const db = getDb();
  const [owned] = await db
    .select({ id: packingList.id })
    .from(packingList)
    .where(and(eq(packingList.id, id), eq(packingList.userId, userId)))
    .limit(1);

  if (!owned) return false;

  const updateList = db
    .update(packingList)
    .set({ title, isPublic, updatedAt: new Date() })
    .where(and(eq(packingList.id, id), eq(packingList.userId, userId)));
  const clearItems = db
    .delete(packingListItem)
    .where(eq(packingListItem.listId, id));

  if (items.length) {
    await db.batch([
      updateList,
      clearItems,
      ...insertItemsStatements(db, id, items),
    ]);
  } else {
    await db.batch([updateList, clearItems]);
  }

  return true;
}

/** Returns `false` when the list is missing or owned by someone else. */
export async function remove(id: string, userId: string): Promise<boolean> {
  const result = await getDb()
    .delete(packingList)
    .where(and(eq(packingList.id, id), eq(packingList.userId, userId)))
    .returning({ id: packingList.id });

  return result.length > 0;
}

/**
 * Only public lists can be saved — a private list is invisible to anyone but
 * its owner, so a save on one could only come from a guessed id — and not by
 * their own owner, who has them under "Your lists" already and would otherwise
 * be able to lift their own lists up the public ranking.
 *
 * Returns `null` when the list cannot be saved.
 */
export async function setFavourite(
  listId: string,
  userId: string,
  favourite: boolean,
): Promise<{ favourite: boolean; favouriteCount: number } | null> {
  const [target] = await getDb()
    .select({ id: packingList.id })
    .from(packingList)
    .where(
      and(
        eq(packingList.id, listId),
        eq(packingList.isPublic, true),
        ne(packingList.userId, userId),
      ),
    )
    .limit(1);

  if (!target) return null;

  if (favourite) {
    await getDb()
      .insert(packingListFavourite)
      .values({ listId, userId })
      .onConflictDoNothing();
  } else {
    await getDb()
      .delete(packingListFavourite)
      .where(
        and(
          eq(packingListFavourite.listId, listId),
          eq(packingListFavourite.userId, userId),
        ),
      );
  }

  const [{ value }] = await getDb()
    .select({ value: count() })
    .from(packingListFavourite)
    .where(eq(packingListFavourite.listId, listId));

  return { favourite, favouriteCount: Number(value) };
}

/** Which of `listIds` the viewer has favourited, for batched UI rendering. */
export async function favouritedAmong(
  viewerId: string,
  listIds: string[],
): Promise<Set<string>> {
  if (listIds.length === 0) return new Set();

  const batches = await Promise.all(
    chunked(listIds, IDS_PER_QUERY).map((chunk) =>
      getDb()
        .select({ listId: packingListFavourite.listId })
        .from(packingListFavourite)
        .where(
          and(
            eq(packingListFavourite.userId, viewerId),
            inArray(packingListFavourite.listId, chunk),
          ),
        ),
    ),
  );

  return new Set(batches.flat().map((row) => row.listId));
}
