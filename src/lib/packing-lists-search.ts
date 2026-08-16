/**
 * Filtering and search for the packing lists index.
 *
 * Deliberately free of any DOM or database reference: the page runs it while
 * rendering, so a shared link arrives already filtered and works without
 * JavaScript, and the browser runs the same code on every keystroke. One set of
 * rules, so the two can never disagree about what matches.
 */

export type Section = 'mine' | 'saved' | 'public';

export const SECTIONS: Section[] = ['mine', 'saved', 'public'];

export type Filters = {
  /** Which sections to show. Empty means all of them — see `parseFilters`. */
  show: Section[];
  query: string;
};

export type SearchTarget = {
  title: string;
  items: string[];
};

/**
 * Lower-cased and stripped of accents, so "Rückenprotektor" is found by typing
 * "rucken" on a keyboard that cannot produce the umlaut.
 */
export function normalise(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Reads filter state out of a URL. Nothing selected means everything is shown:
 * a filter that hides the whole page when the visitor unticks the last box is
 * an obstacle, and "show me nothing" is not a thing anybody wants.
 */
export function parseFilters(params: URLSearchParams): Filters {
  const show = params
    .getAll('show')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value): value is Section =>
      SECTIONS.includes(value as Section),
    );

  return {
    show: show.length > 0 ? show : [...SECTIONS],
    query: params.get('q')?.trim() ?? '',
  };
}

/** The inverse of `parseFilters`, for keeping the address bar in step. */
export function filtersToParams(filters: Filters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.query) params.set('q', filters.query);

  // All three selected is the default, so it need not be spelled out.
  if (filters.show.length > 0 && filters.show.length < SECTIONS.length) {
    for (const section of SECTIONS) {
      if (filters.show.includes(section)) params.append('show', section);
    }
  }

  return params;
}

/**
 * How well one search term matches one string, or `null` for no match.
 *
 * The ladder is ordered by how likely the visitor meant it: the whole string,
 * then its start, then the start of a word inside it, then anywhere inside it,
 * and only then a scattered subsequence — "slpbg" finding "sleeping bag".
 * Subsequence matching needs three characters, because on one or two nearly
 * everything matches and the results become noise.
 */
export function scoreTerm(term: string, target: string): number | null {
  if (!term) return null;
  if (target === term) return 100;
  if (target.startsWith(term)) return 80;

  const at = target.indexOf(term);
  if (at > 0) return target[at - 1] === ' ' ? 70 : 50;

  if (term.length < 3) return null;

  // Walk the target once, taking each term character as it appears. Gaps cost,
  // so a tight run of characters beats the same letters spread out.
  let cursor = 0;
  let gaps = 0;
  let last = -1;

  for (const character of term) {
    const found = target.indexOf(character, cursor);
    if (found === -1) return null;

    if (last !== -1) gaps += found - last - 1;
    last = found;
    cursor = found + 1;
  }

  return Math.max(5, 30 - gaps);
}

/**
 * Scores a list against a whole query, or `null` if it does not match.
 *
 * Every term has to match something, so typing more words narrows rather than
 * widens — the behaviour every search box has trained people to expect. A term
 * may match the title or any item, and the title counts for more, because a
 * list called "Ski trip" is a better answer to "ski" than one that merely
 * mentions ski socks.
 */
export function scoreList(query: string, target: SearchTarget): number | null {
  const terms = normalise(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;

  const title = normalise(target.title);
  const items = target.items.map(normalise);

  let total = 0;

  for (const term of terms) {
    const titleScore = scoreTerm(term, title);
    let best = titleScore === null ? null : titleScore * 2;

    for (const item of items) {
      const score = scoreTerm(term, item);
      if (score !== null && (best === null || score > best)) best = score;
    }

    if (best === null) return null;
    total += best;
  }

  return total;
}
