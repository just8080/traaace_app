import { beforeEach, describe, expect, it } from 'vitest';
import type { MediaItem } from '../types';
import { quickStore } from './quick-store';

const photo = (id: string, isClassified = false, species?: string): MediaItem => ({
  id, path: `/p/${id}.jpg`, filename: `${id}.jpg`, timestamp: '', isClassified, species,
});

describe('quickStore.applyTags', () => {
  beforeEach(() => {
    quickStore.items = [photo('a'), photo('b', true, 'Possum'), photo('c')];
  });

  it('tags unclassified photos and leaves the ones the user already did', () => {
    const applied = quickStore.applyTags([
      { id: 'a', species: 'Kea', count: 2, confidence: 'high' },
      { id: 'b', species: 'Kea', count: 1, confidence: 'high' },
    ]);
    expect(applied).toBe(1);
    expect(quickStore.items[0]).toMatchObject({ species: 'Kea', count: 2, confidence: 'high', isClassified: true });
    expect(quickStore.items[1].species).toBe('Possum');
    expect(quickStore.items[2].isClassified).toBe(false);
  });

  it('can overwrite when asked', () => {
    expect(quickStore.applyTags([{ id: 'b', species: 'Kea', count: 1, confidence: 'low' }], true)).toBe(1);
    expect(quickStore.items[1].species).toBe('Kea');
  });

  it('ignores ids that are not in the session', () => {
    expect(quickStore.applyTags([{ id: 'zzz', species: 'Kea', count: 1, confidence: 'low' }])).toBe(0);
  });
});
