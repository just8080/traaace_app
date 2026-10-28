/**
 * Grid view filters: "unclassified only" or a single species. The two are exclusive, so turning
 * one on clears the other. Works on positions in the full photo list, so clicks, tagging and the
 * store's current index keep using the same numbers whether a filter is on or not.
 */

export interface GridFilter {
  unclassifiedOnly: boolean;
  /** Exact species name to show, or null for all species. */
  species: string | null;
}

export interface FilterableItem {
  species?: string;
  isClassified: boolean;
}

export interface SpeciesOption {
  species: string;
  count: number;
}

export const NO_FILTER: GridFilter = { unclassifiedOnly: false, species: null };

export function isFilterActive(filter: GridFilter): boolean {
  return filter.unclassifiedOnly || filter.species !== null;
}

/** Positions (in `items`) of the photos the filter lets through, in order. */
export function filterIndices(items: FilterableItem[], filter: GridFilter): number[] {
  const out: number[] = [];
  items.forEach((it, i) => {
    if (filter.unclassifiedOnly) {
      if (!it.isClassified) out.push(i);
    } else if (filter.species !== null) {
      if (it.isClassified && it.species === filter.species) out.push(i);
    } else {
      out.push(i);
    }
  });
  return out;
}

/** Species tagged in `items`, with how many photos each, sorted by name. */
export function speciesOptions(items: FilterableItem[]): SpeciesOption[] {
  const counts = new Map<string, number>();
  for (const it of items) {
    if (it.isClassified && it.species) counts.set(it.species, (counts.get(it.species) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([species, count]) => ({ species, count }))
    .sort((a, b) => a.species.localeCompare(b.species, undefined, { sensitivity: 'base' }));
}

/** Options whose name contains the typed text (any case); names starting with it come first. */
export function matchSpeciesOptions(options: SpeciesOption[], query: string): SpeciesOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  const matches = options.filter(o => o.species.toLowerCase().includes(q));
  const starts = matches.filter(o => o.species.toLowerCase().startsWith(q));
  return [...starts, ...matches.filter(o => !o.species.toLowerCase().startsWith(q))];
}

/** The photo `delta` steps from `current` within the filtered list, or null at either end. */
export function stepFiltered(indices: number[], current: number, delta: 1 | -1): number | null {
  if (delta > 0) return indices.find(i => i > current) ?? null;
  for (let k = indices.length - 1; k >= 0; k--) {
    if (indices[k] < current) return indices[k];
  }
  return null;
}

/**
 * Where to move when the current photo is outside the filtered list (for example after
 * auto-advance): the next photo in the list, else the nearest one before. Null if the list is empty.
 */
export function snapToFiltered(indices: number[], current: number): number | null {
  if (indices.length === 0) return null;
  if (indices.includes(current)) return current;
  return stepFiltered(indices, current, 1) ?? stepFiltered(indices, current, -1);
}

/** Grid page that shows `current`, or null if it is not in the filtered list. */
export function pageOf(indices: number[], current: number, pageSize: number): number | null {
  const pos = indices.indexOf(current);
  return pos < 0 ? null : Math.floor(pos / pageSize);
}
