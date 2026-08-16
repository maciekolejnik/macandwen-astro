import {
  itemTextsFor,
  listFavourites,
  listOwned,
  listPublic,
  type PackingListSummary,
} from './db/packing-lists';
import {
  scoreList,
  type Filters,
  type Section,
} from './packing-lists-search';

/** A list as the index shows it: its summary plus the text to search inside. */
export type PackingListEntry = PackingListSummary & { items: string[] };

export type PackingListsIndexView = {
  /** The visitor's own lists, private and public alike. */
  own: PackingListEntry[];
  /** Public lists the visitor has saved. */
  saved: PackingListEntry[];
  /** Everything else that is public, ranked by how often it was saved. */
  browse: PackingListEntry[];
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
  const [own, saved, publicLists] = viewerId
    ? await Promise.all([
        listOwned(viewerId),
        listFavourites(viewerId),
        listPublic(viewerId),
      ])
    : [[], [], await listPublic()];

  const shownAbove = new Set([
    ...own.map((list) => list.id),
    ...saved.map((list) => list.id),
  ]);
  const browse = publicLists.filter((list) => !shownAbove.has(list.id));

  // One query for every list on the page, rather than one per card.
  const texts = await itemTextsFor([
    ...new Set([...own, ...saved, ...browse].map((list) => list.id)),
  ]);
  const withItems = (lists: PackingListSummary[]): PackingListEntry[] =>
    lists.map((list) => ({ ...list, items: texts.get(list.id) ?? [] }));

  return {
    own: withItems(own),
    saved: withItems(saved),
    browse: withItems(browse),
  };
}

export type FilteredEntry = {
  list: PackingListEntry;
  /**
   * Non-matching lists are kept and hidden rather than dropped, so the browser
   * can filter again on the next keystroke without asking the server.
   */
  visible: boolean;
};

export type FilteredSection = {
  key: Section;
  entries: FilteredEntry[];
  visibleCount: number;
  /**
   * Whether the section belongs on the page at all. An unticked chip hides it,
   * and so does a search nothing in it matches — a heading over an empty grid
   * looks broken. A section with no lists yet stays, because its prompt is how
   * the visitor learns what would go there.
   */
  visible: boolean;
};

export type FilteredIndexView = {
  sections: FilteredSection[];
  /** True when the visitor has lists but the current filters hide every one. */
  empty: boolean;
};

/**
 * Applies the filters to a loaded view. Pure, and shared with the browser: the
 * page renders the result so a shared link arrives already filtered, and the
 * client script runs the same function as the visitor types.
 *
 * Searching reorders each section by how well the list matches, because that is
 * what a search box is for. With no query the sections keep the order the
 * queries gave them — the visitor's by recency, the public ones by saves.
 */
export function applyFilters(
  view: PackingListsIndexView,
  filters: Filters,
): FilteredIndexView {
  const source: Record<Section, PackingListEntry[]> = {
    mine: view.own,
    saved: view.saved,
    public: view.browse,
  };

  const sections = (Object.keys(source) as Section[]).map((key) => {
    const shown = filters.show.includes(key);

    const scored = source[key].map((list, index) => ({
      list,
      index,
      score: filters.query ? scoreList(filters.query, list) : 0,
    }));

    scored.sort((a, b) =>
      filters.query
        ? (b.score ?? -1) - (a.score ?? -1) || a.index - b.index
        : a.index - b.index,
    );

    const entries = scored.map(({ list, score }) => ({
      list,
      visible: shown && score !== null,
    }));

    const visibleCount = entries.filter((entry) => entry.visible).length;

    return {
      key,
      entries,
      visibleCount,
      visible: shown && (entries.length === 0 || visibleCount > 0),
    };
  });

  const total = sections.reduce(
    (sum, section) => sum + section.entries.length,
    0,
  );
  const visible = sections.reduce(
    (sum, section) => sum + section.visibleCount,
    0,
  );

  return { sections, empty: total > 0 && visible === 0 };
}
