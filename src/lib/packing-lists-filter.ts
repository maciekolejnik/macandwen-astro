import {
  filtersToParams,
  parseFilters,
  scoreList,
  SECTIONS,
  type Filters,
  type Section,
} from './packing-lists-search';

/**
 * Makes the filter form live. Runs in the browser only.
 *
 * The page already arrives filtered — the server ran the same `scoreList` while
 * rendering — so this changes nothing until the visitor types. Every card is in
 * the document, matching or not, which is why filtering can be instant: there
 * is nothing to fetch, and no round trip between a keystroke and the answer.
 *
 * Chip states are read from the checkboxes rather than kept in a variable, so
 * the form stays the one source of truth and a browser restoring form state on
 * back-navigation cannot disagree with the page.
 */

const ON = ['border-emerald-600', 'bg-emerald-600', 'text-white'];
const OFF = ['border-stone-300', 'bg-white', 'text-stone-600', 'hover:bg-stone-100'];

export function wireFilters() {
  const form = document.getElementById('packing-filters');
  if (!(form instanceof HTMLFormElement)) return;

  const input = form.querySelector<HTMLInputElement>('input[name="q"]');
  const boxes = [
    ...form.querySelectorAll<HTMLInputElement>('input[name="show"]'),
  ];
  const noMatches = document.getElementById('no-matches');
  const personalBox = document.getElementById('your-lists');

  const sections = new Map<Section, HTMLElement>();
  for (const key of SECTIONS) {
    const element = document.querySelector<HTMLElement>(
      `[data-section="${key}"]`,
    );
    if (element) sections.set(key, element);
  }

  // Taken once, before anything is moved. Reading the position out of the DOM
  // on each pass would mean the first relevance sort overwrote the order the
  // server rendered, leaving nothing to go back to when the box is cleared.
  const rendered = new WeakMap<HTMLElement, number>();
  for (const section of sections.values()) {
    const cards = section.querySelectorAll<HTMLElement>('[data-list-card]');
    cards.forEach((card, index) => rendered.set(card, index));
  }

  const readFilters = (): Filters => {
    const ticked = boxes
      .filter((box) => box.checked)
      .map((box) => box.value as Section);

    return {
      // Same rule as the server: nothing ticked shows everything.
      show: ticked.length > 0 ? ticked : [...SECTIONS],
      query: input?.value.trim() ?? '',
    };
  };

  const apply = () => {
    const filters = readFilters();
    let visibleTotal = 0;
    let total = 0;

    for (const [key, section] of sections) {
      const grid = section.querySelector<HTMLElement>('[data-list-card]')
        ?.parentElement;
      const cards = [
        ...section.querySelectorAll<HTMLElement>('[data-list-card]'),
      ];
      const shown = filters.show.includes(key);
      let visible = 0;

      const scored = cards.map((card, index) => {
        const score = filters.query
          ? scoreList(filters.query, {
              title: card.dataset.title ?? '',
              items: (card.dataset.items ?? '').split('\n').filter(Boolean),
            })
          : 0;

        card.hidden = !shown || score === null;
        if (!card.hidden) visible += 1;

        return { card, index: rendered.get(card) ?? index, score };
      });

      // Reordering by relevance while searching, back to the server's order
      // when the box is cleared.
      scored.sort((a, b) =>
        filters.query
          ? (b.score ?? -1) - (a.score ?? -1) || a.index - b.index
          : a.index - b.index,
      );
      for (const { card } of scored) grid?.appendChild(card);

      section.hidden = !shown || (cards.length > 0 && visible === 0);
      visibleTotal += visible;
      total += cards.length;
    }

    if (personalBox) {
      personalBox.hidden = ['mine', 'saved'].every(
        (key) => sections.get(key as Section)?.hidden ?? true,
      );
    }

    if (noMatches) noMatches.hidden = !(total > 0 && visibleTotal === 0);

    for (const box of boxes) {
      const chip = box.closest<HTMLElement>('[data-chip]');
      chip?.classList.remove(...ON, ...OFF);
      chip?.classList.add(...(box.checked ? ON : OFF));
    }

    // Replaced rather than pushed: a history entry per keystroke would make the
    // back button useless, and the link still carries the filter when shared.
    const params = filtersToParams(filters);
    const query = params.toString();
    history.replaceState(
      null,
      '',
      query ? `${location.pathname}?${query}` : location.pathname,
    );
  };

  form.addEventListener('submit', (event) => {
    // Everything is already on the page, so there is nothing to reload.
    event.preventDefault();
    apply();
  });
  form.addEventListener('input', apply);
  form.addEventListener('change', apply);

  // A browser restoring a typed query on back-navigation would otherwise leave
  // the page showing the state it was rendered with.
  const restored = parseFilters(new URLSearchParams(location.search));
  if (input && !input.value && restored.query) input.value = restored.query;
  apply();
}
