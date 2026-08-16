import { describe, expect, it } from 'vitest';
import {
  filtersToParams,
  normalise,
  parseFilters,
  scoreList,
  scoreTerm,
} from '../src/lib/packing-lists-search';

describe('normalise', () => {
  it('folds case and accents so an ASCII keyboard can find either', () => {
    expect(normalise('  Rückenprotektor ')).toBe('ruckenprotektor');
    expect(normalise('Crème')).toBe('creme');
  });
});

describe('parseFilters', () => {
  it('treats nothing selected as everything', () => {
    expect(parseFilters(new URLSearchParams()).show).toEqual([
      'mine',
      'saved',
      'public',
    ]);
  });

  it('accepts sections repeated or comma-joined, and ignores nonsense', () => {
    expect(
      parseFilters(new URLSearchParams('show=mine&show=public')).show,
    ).toEqual(['mine', 'public']);
    expect(parseFilters(new URLSearchParams('show=mine,saved')).show).toEqual([
      'mine',
      'saved',
    ]);
    expect(parseFilters(new URLSearchParams('show=nonsense')).show).toEqual([
      'mine',
      'saved',
      'public',
    ]);
  });

  it('trims the query', () => {
    expect(parseFilters(new URLSearchParams('q=%20ski%20')).query).toBe('ski');
  });

  it('round-trips through filtersToParams, leaving the default unwritten', () => {
    const params = filtersToParams({
      show: ['mine', 'saved', 'public'],
      query: 'ski',
    });

    expect(params.toString()).toBe('q=ski');
    expect(parseFilters(params)).toEqual({
      show: ['mine', 'saved', 'public'],
      query: 'ski',
    });

    const narrowed = filtersToParams({ show: ['saved'], query: '' });
    expect(narrowed.toString()).toBe('show=saved');
    expect(parseFilters(narrowed).show).toEqual(['saved']);
  });
});

describe('scoreTerm', () => {
  it('ranks a whole match above a prefix above a word start above the middle', () => {
    const whole = scoreTerm('ski', 'ski')!;
    const prefix = scoreTerm('ski', 'ski socks')!;
    const word = scoreTerm('ski', 'cross country ski poles')!;
    const middle = scoreTerm('ski', 'waterskiing')!;

    expect(whole).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(middle);
  });

  it('matches a scattered subsequence, but scores it below any substring', () => {
    const loose = scoreTerm('slpbg', 'sleeping bag')!;

    expect(loose).not.toBeNull();
    expect(loose).toBeLessThan(scoreTerm('sleep', 'sleeping bag')!);
  });

  it('prefers a tighter run of the same characters', () => {
    expect(scoreTerm('slee', 'sleeping bag')!).toBeGreaterThan(
      scoreTerm('sbag', 'sleeping bag')!,
    );
  });

  it('refuses to guess from one or two characters', () => {
    expect(scoreTerm('sb', 'sleeping bag')).toBeNull();
    expect(scoreTerm('xyz', 'sleeping bag')).toBeNull();
  });
});

describe('scoreList', () => {
  const list = { title: 'Ski trip', items: ['Ski socks', 'Goggles', 'Balm'] };

  it('matches an empty query against everything', () => {
    expect(scoreList('', list)).toBe(0);
    expect(scoreList('   ', list)).toBe(0);
  });

  it('finds a list by its title and by an item', () => {
    expect(scoreList('ski', list)).not.toBeNull();
    expect(scoreList('goggles', list)).not.toBeNull();
    expect(scoreList('snorkel', list)).toBeNull();
  });

  it('weighs the title above the items', () => {
    const titled = { title: 'Ski trip', items: ['Socks'] };
    const mentioned = { title: 'City break', items: ['Ski socks'] };

    expect(scoreList('ski', titled)!).toBeGreaterThan(
      scoreList('ski', mentioned)!,
    );
  });

  it('requires every term to match, so more words narrow the results', () => {
    expect(scoreList('ski goggles', list)).not.toBeNull();
    expect(scoreList('ski snorkel', list)).toBeNull();
  });

  it('ignores accents in the list as well as the query', () => {
    const accented = { title: 'Crème and sun', items: ['Crème solaire'] };

    expect(scoreList('creme', accented)).not.toBeNull();
    expect(scoreList('crème', { title: 'Creme', items: [] })).not.toBeNull();
  });
});
