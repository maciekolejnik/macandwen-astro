import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { getDb } from './client';
import {
  ITEM_MAX_LENGTH,
  MAX_ITEMS,
  MAX_OPTIONS,
  OPTION_LABEL_MAX_LENGTH,
  TITLE_MAX_LENGTH,
} from '../packing-list-limits';
import {
  packingList,
  packingListFavourite,
  packingListItem,
  packingListItemOption,
  packingListOption,
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
  items: {
    id: string;
    text: string;
    position: number;
    /** The options this item belongs to; empty means "always packed". */
    optionIds: string[];
  }[];
  options: {
    id: string;
    label: string;
    position: number;
    defaultOn: boolean;
  }[];
};

/**
 * An option keeps its id across an update, unlike an item: the editor sends
 * back the id it was rendered with, and a newly added option arrives without
 * one. Items are replaced wholesale on every save, so if options were too,
 * every visitor's toggles would reset on a typo fix.
 */
export type PackingListOptionInput = {
  id?: string;
  label: string;
  defaultOn: boolean;
};

export type PackingListItemInput = {
  text: string;
  /** Omitted, like most items, means the item is always packed. */
  optionIds?: string[];
};

type BatchStatement = Parameters<ReturnType<typeof getDb>['batch']>[0][number];

export type PackingListInput = {
  title: string;
  isPublic: boolean;
  items: PackingListItemInput[];
  options?: PackingListOptionInput[];
};

// Defined in their own module so the browser can import them without Drizzle.
export {
  ITEM_MAX_LENGTH,
  MAX_ITEMS,
  MAX_OPTIONS,
  OPTION_LABEL_MAX_LENGTH,
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

  // Three cheap reads rather than one join: a join would repeat every item row
  // once per tagging, and the taggings are the rarer thing.
  const [items, options, taggings] = await Promise.all([
    getDb()
      .select({
        id: packingListItem.id,
        text: packingListItem.text,
        position: packingListItem.position,
      })
      .from(packingListItem)
      .where(eq(packingListItem.listId, id))
      .orderBy(asc(packingListItem.position)),
    getDb()
      .select({
        id: packingListOption.id,
        label: packingListOption.label,
        position: packingListOption.position,
        defaultOn: packingListOption.defaultOn,
      })
      .from(packingListOption)
      .where(eq(packingListOption.listId, id))
      .orderBy(asc(packingListOption.position)),
    getDb()
      .select({
        itemId: packingListItemOption.itemId,
        optionId: packingListItemOption.optionId,
      })
      .from(packingListItemOption)
      .innerJoin(
        packingListItem,
        eq(packingListItem.id, packingListItemOption.itemId),
      )
      .where(eq(packingListItem.listId, id)),
  ]);

  const byItem = new Map<string, string[]>();
  for (const tagging of taggings) {
    const existing = byItem.get(tagging.itemId);
    if (existing) existing.push(tagging.optionId);
    else byItem.set(tagging.itemId, [tagging.optionId]);
  }

  return {
    ...summary,
    options,
    items: items.map((item) => ({
      ...item,
      optionIds: byItem.get(item.id) ?? [],
    })),
  };
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

  const options = (input.options ?? [])
    .map((option) => ({
      id: option.id,
      label: option.label.trim(),
      defaultOn: option.defaultOn,
    }))
    .filter((option) => option.label.length > 0);

  if (!title) invalid('A packing list needs a title');
  if (title.length > TITLE_MAX_LENGTH) {
    invalid(`Title must be ${TITLE_MAX_LENGTH} characters or fewer`);
  }
  if (options.length > MAX_OPTIONS) {
    invalid(`A packing list can have at most ${MAX_OPTIONS} options`);
  }
  if (options.some((option) => option.label.length > OPTION_LABEL_MAX_LENGTH)) {
    invalid(`Options must be ${OPTION_LABEL_MAX_LENGTH} characters or fewer`);
  }

  // Two options with the same name are indistinguishable on the toggle row, so
  // whichever the visitor taps is a coin flip.
  const labels = new Set<string>();
  for (const option of options) {
    const key = option.label.toLocaleLowerCase();
    if (labels.has(key)) invalid(`Two options are both called "${option.label}"`);
    labels.add(key);
  }

  // An item may only be tagged with an option of its own list. Anything else is
  // a stale form, and dropping it beats refusing the whole save.
  const optionIds = new Set(
    options.map((option) => option.id).filter((id): id is string => !!id),
  );

  const items = input.items
    .map((item) => ({
      text: item.text.trim(),
      optionIds: [...new Set(item.optionIds ?? [])].filter((id) =>
        optionIds.has(id),
      ),
    }))
    .filter((item) => item.text.length > 0);

  if (items.length > MAX_ITEMS) {
    invalid(`A packing list can hold at most ${MAX_ITEMS} items`);
  }
  if (items.some((item) => item.text.length > ITEM_MAX_LENGTH)) {
    invalid(`Items must be ${ITEM_MAX_LENGTH} characters or fewer`);
  }

  return { title, isPublic: input.isPublic, items, options };
}

type NormalisedInput = ReturnType<typeof normaliseInput>;

/**
 * Turns the ids the editor sent into the ids the database will hold.
 *
 * Ids that name an option this list already has are kept, so its toggles — and
 * every visitor's saved answers, which are keyed by option id — survive an
 * edit. Anything else is a new option, and gets a fresh server-generated id
 * rather than the one it arrived with: a client-chosen id could otherwise
 * collide with a row belonging to somebody else's list.
 */
function resolveOptions(
  listId: string,
  options: NormalisedInput['options'],
  existingIds: ReadonlySet<string>,
) {
  const idFor = new Map<string, string>();

  const rows = options.map((option, position) => {
    const id =
      option.id && existingIds.has(option.id) ? option.id : crypto.randomUUID();

    if (option.id) idFor.set(option.id, id);

    return { id, listId, label: option.label, position, defaultOn: option.defaultOn };
  });

  return { rows, idFor };
}

function itemRows(
  listId: string,
  items: NormalisedInput['items'],
  idFor: ReadonlyMap<string, string>,
) {
  const rows = items.map((item, position) => ({
    id: crypto.randomUUID(),
    listId,
    text: item.text,
    position,
  }));

  const taggings = items.flatMap((item, index) =>
    item.optionIds
      .map((sentId) => idFor.get(sentId))
      .filter((optionId): optionId is string => !!optionId)
      .map((optionId) => ({ itemId: rows[index]!.id, optionId })),
  );

  return { rows, taggings };
}

/**
 * SQLite caps a statement at 100 bound variables on D1, and a multi-row insert
 * binds one per column per row, so a single `values()` call breaks on a long
 * enough list. Rows are split into statements that stay under the cap; a
 * `batch` runs them atomically, so a long list is still all or nothing.
 *
 * The chunk size is per table, since the tables have different widths: items
 * bind four columns a row, options five, and a tagging two.
 */
function insertInChunks<Row>(
  insert: (rows: Row[]) => BatchStatement,
  rows: Row[],
  perStatement: number,
) {
  const statements: BatchStatement[] = [];

  for (let i = 0; i < rows.length; i += perStatement) {
    statements.push(insert(rows.slice(i, i + perStatement)));
  }

  return statements;
}

const ITEMS_PER_INSERT = 25;
const OPTIONS_PER_INSERT = 20;
const TAGGINGS_PER_INSERT = 50;

/** Every write of a list's items, its options and the links between them. */
function contentStatements(
  db: ReturnType<typeof getDb>,
  optionRows: ReturnType<typeof resolveOptions>['rows'],
  itemInserts: ReturnType<typeof itemRows>['rows'],
  taggings: ReturnType<typeof itemRows>['taggings'],
) {
  return [
    ...insertInChunks(
      (rows) => db.insert(packingListOption).values(rows),
      optionRows,
      OPTIONS_PER_INSERT,
    ),
    ...insertInChunks(
      (rows) => db.insert(packingListItem).values(rows),
      itemInserts,
      ITEMS_PER_INSERT,
    ),
    ...insertInChunks(
      (rows) => db.insert(packingListItemOption).values(rows),
      taggings,
      TAGGINGS_PER_INSERT,
    ),
  ];
}

export async function create(
  userId: string,
  input: PackingListInput,
): Promise<string> {
  const { title, isPublic, items, options } = normaliseInput(input);
  const id = crypto.randomUUID();

  const db = getDb();
  // Nothing exists yet, so every option is a new one.
  const { rows: optionRows, idFor } = resolveOptions(id, options, new Set());
  const { rows: itemInserts, taggings } = itemRows(id, items, idFor);

  // D1 has no interactive transactions; `batch` is the atomic equivalent.
  await runBatch([
    db.insert(packingList).values({ id, userId, title, isPublic }),
    ...contentStatements(db, optionRows, itemInserts, taggings),
  ]);

  return id;
}

/**
 * `db.batch` types its first statement separately from the rest, which is
 * awkward for a write whose shape depends on what was submitted; the list
 * insert or update is always there, so the cast is safe.
 */
async function runBatch(statements: BatchStatement[]) {
  await getDb().batch(
    statements as unknown as [BatchStatement, ...BatchStatement[]],
  );
}

/**
 * Replaces the whole list, items included: the editor submits the full set, so
 * diffing rows would add complexity without changing the result. Options are
 * the exception — one the editor sent back keeps its id, because a visitor's
 * saved toggles are keyed by it and would otherwise reset on every edit.
 *
 * Returns `false` when the list is missing or owned by someone else.
 */
export async function update(
  id: string,
  userId: string,
  input: PackingListInput,
): Promise<boolean> {
  const { title, isPublic, items, options } = normaliseInput(input);

  const db = getDb();
  const [owned] = await db
    .select({ id: packingList.id })
    .from(packingList)
    .where(and(eq(packingList.id, id), eq(packingList.userId, userId)))
    .limit(1);

  if (!owned) return false;

  const existing = await db
    .select({ id: packingListOption.id })
    .from(packingListOption)
    .where(eq(packingListOption.listId, id));

  const existingIds = new Set(existing.map((option) => option.id));
  const { rows: optionRows, idFor } = resolveOptions(id, options, existingIds);
  const kept = new Set(optionRows.map((option) => option.id));
  const { rows: itemInserts, taggings } = itemRows(id, items, idFor);

  const statements: BatchStatement[] = [
    db
      .update(packingList)
      .set({ title, isPublic, updatedAt: new Date() })
      .where(and(eq(packingList.id, id), eq(packingList.userId, userId))),
    // Taggings go with their items through the cascade.
    db.delete(packingListItem).where(eq(packingListItem.listId, id)),
  ];

  const dropped = [...existingIds].filter((optionId) => !kept.has(optionId));
  if (dropped.length) {
    statements.push(
      db
        .delete(packingListOption)
        .where(
          and(
            eq(packingListOption.listId, id),
            inArray(packingListOption.id, dropped),
          ),
        ),
    );
  }

  // An option the editor sent back is updated in place rather than replaced, so
  // the taggings and the toggles saved against its id survive.
  for (const option of optionRows.filter((row) => existingIds.has(row.id))) {
    statements.push(
      db
        .update(packingListOption)
        .set({
          label: option.label,
          position: option.position,
          defaultOn: option.defaultOn,
        })
        .where(eq(packingListOption.id, option.id)),
    );
  }

  statements.push(
    ...contentStatements(
      db,
      optionRows.filter((row) => !existingIds.has(row.id)),
      itemInserts,
      taggings,
    ),
  );

  await runBatch(statements);

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
