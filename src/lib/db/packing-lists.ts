import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from './client';
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

/** Longer values are a mistake or an abuse, not a packing list. */
export const TITLE_MAX_LENGTH = 120;
export const ITEM_MAX_LENGTH = 200;
export const MAX_ITEMS = 500;

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

export function normaliseInput(input: PackingListInput) {
  const title = input.title.trim();
  const items = input.items
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (!title) throw new Error('A packing list needs a title');
  if (title.length > TITLE_MAX_LENGTH) {
    throw new Error(`Title must be ${TITLE_MAX_LENGTH} characters or fewer`);
  }
  if (items.length > MAX_ITEMS) {
    throw new Error(`A packing list can hold at most ${MAX_ITEMS} items`);
  }
  if (items.some((item) => item.length > ITEM_MAX_LENGTH)) {
    throw new Error(`Items must be ${ITEM_MAX_LENGTH} characters or fewer`);
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
    await db.batch([insertList, db.insert(packingListItem).values(itemRows(id, items))]);
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
      db.insert(packingListItem).values(itemRows(id, items)),
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
 * Only public lists can be favourited — a private list is invisible to anyone
 * but its owner, so a favourite on one could only come from a guessed id.
 * Returns `null` when the list cannot be favourited.
 */
export async function setFavourite(
  listId: string,
  userId: string,
  favourite: boolean,
): Promise<{ favourite: boolean; favouriteCount: number } | null> {
  const [target] = await getDb()
    .select({ id: packingList.id })
    .from(packingList)
    .where(and(eq(packingList.id, listId), eq(packingList.isPublic, true)))
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

  const rows = await getDb()
    .select({ listId: packingListFavourite.listId })
    .from(packingListFavourite)
    .where(
      and(
        eq(packingListFavourite.userId, viewerId),
        inArray(packingListFavourite.listId, listIds),
      ),
    );

  return new Set(rows.map((row) => row.listId));
}
