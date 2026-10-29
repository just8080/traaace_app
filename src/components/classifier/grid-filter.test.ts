import { describe, expect, it } from 'vitest';
import {
  NO_FILTER, filterIndices, isFilterActive, matchSpeciesOptions, pageOf, skipTaggedAfterAdvance, snapToFiltered, speciesOptions,
  stepFiltered,
} from './grid-filter';

const tagged = (species: string) => ({ species, isClassified: true });
const untagged = { isClassified: false };

const items = [
  tagged('Bellbird'), untagged, tagged('Feral Cat'), tagged('Empty'),
  untagged, tagged('Bellbird'), tagged('Deer'), untagged,
];

describe('filterIndices', () => {
  it('lets everything through with no filter', () => {
    expect(filterIndices(items, NO_FILTER)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(isFilterActive(NO_FILTER)).toBe(false);
  });

  it('keeps only unclassified photos', () => {
    expect(filterIndices(items, { unclassifiedOnly: true, species: null })).toEqual([1, 4, 7]);
  });

  it('keeps only one species, Empty included', () => {
    expect(filterIndices(items, { unclassifiedOnly: false, species: 'Bellbird' })).toEqual([0, 5]);
    expect(filterIndices(items, { unclassifiedOnly: false, species: 'Empty' })).toEqual([3]);
    expect(filterIndices(items, { unclassifiedOnly: false, species: 'Kiwi' })).toEqual([]);
  });
});

describe('speciesOptions', () => {
  it('lists tagged species with counts, sorted, skipping unclassified', () => {
    expect(speciesOptions(items)).toEqual([
      { species: 'Bellbird', count: 2 },
      { species: 'Deer', count: 1 },
      { species: 'Empty', count: 1 },
      { species: 'Feral Cat', count: 1 },
    ]);
  });
});

describe('matchSpeciesOptions', () => {
  const opts = speciesOptions([tagged('Feral Cat'), tagged('Cat'), tagged('Catbird'), tagged('Deer')]);

  it('returns everything for an empty search', () => {
    expect(matchSpeciesOptions(opts, '  ')).toHaveLength(4);
  });

  it('matches any part of the name, ignoring case, with prefix matches first', () => {
    expect(matchSpeciesOptions(opts, 'CAT').map(o => o.species)).toEqual(['Cat', 'Catbird', 'Feral Cat']);
  });
});

describe('navigation within the filtered list', () => {
  const visible = [1, 4, 7];

  it('steps to the next and previous filtered photo', () => {
    expect(stepFiltered(visible, 1, 1)).toBe(4);
    expect(stepFiltered(visible, 4, -1)).toBe(1);
    expect(stepFiltered(visible, 7, 1)).toBeNull();
    expect(stepFiltered(visible, 1, -1)).toBeNull();
    // From a photo outside the list too.
    expect(stepFiltered(visible, 5, 1)).toBe(7);
    expect(stepFiltered(visible, 5, -1)).toBe(4);
  });

  it('snaps forward to the next filtered photo, else back', () => {
    expect(snapToFiltered(visible, 4)).toBe(4);
    expect(snapToFiltered(visible, 2)).toBe(4);
    expect(snapToFiltered(visible, 0)).toBe(1);
    expect(snapToFiltered(visible, 8)).toBe(7);
    expect(snapToFiltered([], 3)).toBeNull();
  });

  it('finds the grid page by position in the filtered list', () => {
    const many = Array.from({ length: 60 }, (_, i) => i * 2);
    expect(pageOf(many, 0, 48)).toBe(0);
    expect(pageOf(many, 94, 48)).toBe(0);
    expect(pageOf(many, 96, 48)).toBe(1);
    expect(pageOf(many, 3, 48)).toBeNull();
  });
});

describe('skipTaggedAfterAdvance (Single view, Unclassified on)', () => {
  // Unclassified photos are at 1, 4 and 7.
  it('moves past tagged photos after auto-advance', () => {
    expect(skipTaggedAfterAdvance(items, 1, 2)).toBe(4);
    expect(skipTaggedAfterAdvance(items, 4, 5)).toBe(7);
  });

  it('stays when the next photo is unclassified, or none are left', () => {
    expect(skipTaggedAfterAdvance(items, 3, 4)).toBeNull();
    expect(skipTaggedAfterAdvance([tagged('Deer'), tagged('Deer')], 0, 1)).toBeNull();
  });

  it('ignores moves that are not one step forward', () => {
    expect(skipTaggedAfterAdvance(items, 0, 2)).toBeNull();
    expect(skipTaggedAfterAdvance(items, 3, 2)).toBeNull();
    expect(skipTaggedAfterAdvance(items, 2, 2)).toBeNull();
  });
});
