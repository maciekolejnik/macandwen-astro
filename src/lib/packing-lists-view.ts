import {
  listOwned,
  listPublic,
  type PackingListSummary,
} from './db/packing-lists';

export type PackingListsIndexView = {
  own: PackingListSummary[];
  public: PackingListSummary[];
};

/**
 * Assembles what the index page shows, kept out of the page itself so the rules
 * about who sees what can be tested without rendering anything.
 *
 * A signed-out visitor sees only public lists. A signed-in one also sees their
 * own, private ones included; their public lists appear in both sections, since
 * the public one is a ranking and omitting them would misreport it.
 */
export async function loadIndex(
  viewerId?: string,
): Promise<PackingListsIndexView> {
  if (!viewerId) {
    return { own: [], public: await listPublic() };
  }

  const [own, publicLists] = await Promise.all([
    listOwned(viewerId),
    listPublic(viewerId),
  ]);

  return { own, public: publicLists };
}
