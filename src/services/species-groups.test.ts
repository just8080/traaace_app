import { describe, expect, it } from 'vitest';
import { hotkeyCounts, isBird, normalizeSpecies } from './species-groups';

const KEYS = ['Possum', 'Stoat', 'Hedgehog', 'Rat', 'Mouse', 'Feral Cat', 'Bird', 'Dog / Human', 'Other'];

describe('hotkey counts', () => {
  it('counts a tag under its own key, ignoring case and macrons', () => {
    const counts = hotkeyCounts(KEYS, { Possum: 3, stoat: 2 });
    expect(counts.Possum).toBe(3);
    expect(counts.Stoat).toBe(2);
  });

  it('counts birds without their own key under Bird, everything else under Other', () => {
    const counts = hotkeyCounts(KEYS, { Bellbird: 5, Tūī: 1, Kererū: 2, Wallaby: 1, Deer: 2 });
    expect(counts.Bird).toBe(8);
    expect(counts.Other).toBe(3);
  });

  it('puts birds under Other when there is no Bird key', () => {
    const counts = hotkeyCounts(['Possum', 'Others'], { Bellbird: 4 });
    expect(counts.Others).toBe(4);
  });

  it('never groups Empty, and drops tags when there is nowhere to count them', () => {
    const counts = hotkeyCounts(['Possum'], { Empty: 9, Bellbird: 2 });
    expect(counts).toEqual({ Possum: 0 });
  });
});

describe('species names', () => {
  it('knows the AI birds by common, te reo and scientific names', () => {
    expect(['Bellbird', 'Korimako', 'Anthornis melanura', 'kereru', 'Kererū', 'Morepork'].every(isBird)).toBe(true);
    expect(['Stoat', 'Cat', 'Possum', 'Human'].some(isBird)).toBe(false);
  });

  it('normalizes macrons and spacing', () => {
    expect(normalizeSpecies('Kererū / NZ Pigeon')).toBe('kererunzpigeon');
  });
});
