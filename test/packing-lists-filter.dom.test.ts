import { beforeEach, describe, expect, it } from 'vitest';
import { wireFilters } from '../src/lib/packing-lists-filter';
import { SECTIONS, type Section } from '../src/lib/packing-lists-search';

/**
 * The browser half of the filtering, which the server half already has tests
 * for in `packing-lists-view.test.ts`. Both run `scoreList`, so what is worth
 * checking here is the wiring around it: what gets hidden, what gets reordered,
 * and what ends up in the address bar.
 */

type Card = { title: string; items: string[] };

const ON = ['border-emerald-600', 'bg-emerald-600', 'text-white'];

/** The markup of `packing-lists/index.astro`, cut down to what the wiring reads. */
function render(sections: Partial<Record<Section, Card[]>>, search = '') {
  const chip = (key: Section) => `
    <label data-chip="${key}">
      <input type="checkbox" name="show" value="${key}" />
    </label>`;

  const card = (list: Card) => `
    <article data-list-card data-title="${list.title}"
             data-items="${list.items.join('&#10;')}"></article>`;

  const section = (key: Section) => `
    <section data-section="${key}">
      <div>${(sections[key] ?? []).map(card).join('')}</div>
    </section>`;

  document.body.innerHTML = `
    <form id="packing-filters">
      <input type="search" name="q" value="" />
      ${SECTIONS.map(chip).join('')}
    </form>
    <div id="your-lists">${section('mine')}${section('saved')}</div>
    ${section('public')}
    <p id="no-matches" hidden></p>`;

  history.replaceState(null, '', `/packing-lists${search}`);
}

const form = () => document.getElementById('packing-filters') as HTMLFormElement;
const queryBox = () =>
  form().querySelector<HTMLInputElement>('input[name="q"]')!;
const box = (key: Section) =>
  form().querySelector<HTMLInputElement>(`input[value="${key}"]`)!;
const sectionOf = (key: Section) =>
  document.querySelector<HTMLElement>(`[data-section="${key}"]`)!;

function visibleIn(key: Section) {
  return [...sectionOf(key).querySelectorAll<HTMLElement>('[data-list-card]')]
    .filter((card) => !card.hidden)
    .map((card) => card.dataset.title);
}

function orderIn(key: Section) {
  return [...sectionOf(key).querySelectorAll<HTMLElement>('[data-list-card]')].map(
    (card) => card.dataset.title,
  );
}

function type(value: string) {
  queryBox().value = value;
  form().dispatchEvent(new Event('input', { bubbles: true }));
}

function tick(key: Section, checked: boolean) {
  box(key).checked = checked;
  form().dispatchEvent(new Event('change', { bubbles: true }));
}

const lists = {
  mine: [
    { title: 'Ski trip', items: ['Goggles', 'Ski socks'] },
    { title: 'Beach', items: ['Towel'] },
  ],
  saved: [{ title: 'Camping', items: ['Sleeping bag'] }],
  public: [{ title: 'City break', items: ['Passport'] }],
};

beforeEach(() => {
  document.body.innerHTML = '';
  history.replaceState(null, '', '/packing-lists');
});

describe('wireFilters', () => {
  it('does nothing on a page without the filter form', () => {
    document.body.innerHTML = '<p>Some other page</p>';

    expect(() => wireFilters()).not.toThrow();
  });

  it('shows every list before anything is typed', () => {
    render(lists);
    wireFilters();

    expect(visibleIn('mine')).toEqual(['Ski trip', 'Beach']);
    expect(visibleIn('saved')).toEqual(['Camping']);
    expect(visibleIn('public')).toEqual(['City break']);
    expect(document.getElementById('no-matches')!.hidden).toBe(true);
  });

  it('hides the lists a query does not match, across every section', () => {
    render(lists);
    wireFilters();

    type('ski');

    expect(visibleIn('mine')).toEqual(['Ski trip']);
    expect(visibleIn('saved')).toEqual([]);
    expect(visibleIn('public')).toEqual([]);
  });

  it('matches an item as well as a title', () => {
    render(lists);
    wireFilters();

    type('passport');

    expect(visibleIn('public')).toEqual(['City break']);
    expect(visibleIn('mine')).toEqual([]);
  });

  it('reorders a section by relevance, and restores the order when cleared', () => {
    render({ public: [{ title: 'Beach', items: ['Ski wax'] }, ...lists.mine] });
    wireFilters();

    // "Ski trip" wins on the title; "Beach" matches only on an item.
    type('ski');
    expect(orderIn('public').slice(0, 2)).toEqual(['Ski trip', 'Beach']);

    type('');
    expect(orderIn('public')).toEqual(['Beach', 'Ski trip', 'Beach']);
  });

  it('hides a section whose lists all fail the query, but not an empty one', () => {
    render({ ...lists, public: [] });
    wireFilters();

    type('ski');

    expect(sectionOf('mine').hidden).toBe(false);
    expect(sectionOf('saved').hidden).toBe(true);
    // No cards at all is not "everything filtered out", so it stays put.
    expect(sectionOf('public').hidden).toBe(false);
  });

  it('announces when the filters leave nothing at all', () => {
    render(lists);
    wireFilters();
    const noMatches = document.getElementById('no-matches')!;

    type('nothingmatchesthis');
    expect(noMatches.hidden).toBe(false);

    type('ski');
    expect(noMatches.hidden).toBe(true);
  });

  it('says nothing about matches on a page with no lists to match', () => {
    render({ mine: [], saved: [], public: [] });
    wireFilters();

    type('ski');

    expect(document.getElementById('no-matches')!.hidden).toBe(true);
  });

  it('hides an unticked section without touching the others', () => {
    render(lists);
    wireFilters();

    tick('mine', true);
    tick('saved', true);

    expect(sectionOf('mine').hidden).toBe(false);
    expect(sectionOf('saved').hidden).toBe(false);
    expect(sectionOf('public').hidden).toBe(true);
  });

  it('treats nothing ticked as everything, as the server does', () => {
    render(lists);
    wireFilters();

    tick('mine', true);
    tick('mine', false);

    for (const key of SECTIONS) expect(sectionOf(key).hidden).toBe(false);
  });

  it('hides the personal box only when both its sections are hidden', () => {
    render(lists);
    wireFilters();
    const personal = document.getElementById('your-lists')!;

    tick('mine', true);
    expect(personal.hidden).toBe(false);

    tick('mine', false);
    tick('public', true);
    expect(personal.hidden).toBe(true);
  });

  it('marks the ticked chips and unmarks the rest', () => {
    render(lists);
    wireFilters();

    tick('mine', true);

    const chip = (key: Section) =>
      document.querySelector<HTMLElement>(`[data-chip="${key}"]`)!;

    expect(ON.every((name) => chip('mine').classList.contains(name))).toBe(true);
    expect(ON.some((name) => chip('public').classList.contains(name))).toBe(false);
    expect(chip('public').classList.contains('bg-white')).toBe(true);
  });

  it('writes the filters into the address bar without stacking history', () => {
    render(lists);
    wireFilters();
    const before = history.length;

    type('ski');
    tick('mine', true);

    const params = new URLSearchParams(location.search);
    expect(params.get('q')).toBe('ski');
    expect(params.getAll('show')).toEqual(['mine']);
    expect(history.length).toBe(before);
  });

  it('leaves a clean URL when the filters are back to their default', () => {
    render(lists, '?q=ski&show=mine');
    wireFilters();

    type('');
    tick('mine', false);

    expect(location.search).toBe('');
    expect(location.pathname).toBe('/packing-lists');
  });

  it('restores a query the browser kept on the way back', () => {
    // The page was rendered filtered, but the input arrives blank.
    render(lists, '?q=ski');
    wireFilters();

    expect(queryBox().value).toBe('ski');
    expect(visibleIn('mine')).toEqual(['Ski trip']);
  });

  it('leaves a query the browser did restore alone', () => {
    render(lists, '?q=ski');
    queryBox().value = 'beach';
    wireFilters();

    expect(queryBox().value).toBe('beach');
    expect(visibleIn('mine')).toEqual(['Beach']);
  });

  it('filters on submit rather than reloading the page', () => {
    render(lists);
    wireFilters();
    queryBox().value = 'ski';

    const submit = new Event('submit', { bubbles: true, cancelable: true });
    form().dispatchEvent(submit);

    expect(submit.defaultPrevented).toBe(true);
    expect(visibleIn('mine')).toEqual(['Ski trip']);
  });
});
