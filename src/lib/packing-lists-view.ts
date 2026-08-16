import {
  listFavourites,
  listOwned,
  listPublic,
  type PackingListSummary,
} from './db/packing-lists';

export type PackingListsIndexView = {
  /** The visitor's own lists, private and public alike. */
  own: PackingListSummary[];
  /** Public lists the visitor has saved. */
  saved: PackingListSummary[];
  /** Everything else that is public, ranked by how often it was saved. */
  browse: PackingListSummary[];
};

/**
 * Assembles what the index page shows, kept out of the page itself so the rules
 * about who sees what can be tested without rendering anything.
 *
 * A signed-out visitor sees only the browse section. A signed-in one gets their
 * own lists and their saved ones above it, and neither is repeated below: a
 * page showing the same list twice reads as padding, and the count on each card
 * already says how popular a list is without needing a place in the ranking.
 */
export async function loadIndex(
  viewerId?: string,
): Promise<PackingListsIndexView> {
  if (!viewerId) {
    return { own: [], saved: [], browse: await listPublic() };
  }

  const [own, saved, publicLists] = await Promise.all([
    listOwned(viewerId),
    listFavourites(viewerId),
    listPublic(viewerId),
  ]);

  const shownAbove = new Set([
    ...own.map((list) => list.id),
    ...saved.map((list) => list.id),
  ]);

  return {
    own,
    saved,
    browse: publicLists.filter((list) => !shownAbove.has(list.id)),
  };
}
