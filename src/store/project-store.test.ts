import { beforeEach, describe, expect, it } from 'vitest';
import { projectStore } from './project-store';

const media = (name: string, species?: string) => ({
  fileName: name,
  fullPath: `/p/${name}`,
  classifications: species ? [{ species, count: 1, comment: '' }] : [],
});

describe('projectStore.classifyMany', () => {
  beforeEach(() => {
    const store = projectStore as unknown as Record<string, unknown>;
    store.activeBatchName = 'b1';
    store.activeBatchMedia = { items: [media('a.jpg'), media('b.jpg', 'Possum'), media('c.jpg')] };
    store.batches = [{ name: 'b1', classifiedCount: 1, totalImages: 3, status: 'inprogress' }];
    store.hasShownCompletionPrompt = false;
  });

  const items = () => (projectStore.activeBatchMedia as unknown as { items: ReturnType<typeof media>[] }).items;

  it('tags untagged photos, keeps the user’s own tags and updates the batch progress', async () => {
    const n = await projectStore.classifyMany([
      { id: 'a.jpg', species: 'Kea', count: 2 },
      { id: 'b.jpg', species: 'Kea', count: 1 },
      { id: 'c.jpg', species: 'Empty', count: 1 },
    ]);
    expect(n).toBe(2);
    expect(items()[0].classifications[0]).toMatchObject({ species: 'Kea', count: 2, speciesInFrame: 2 });
    expect(items()[1].classifications[0].species).toBe('Possum');
    expect(projectStore.batches[0]).toMatchObject({ classifiedCount: 3, status: 'ready' });
    expect(projectStore.showCompletionPrompt).toBe(true);
  });

  it('does nothing for unknown files or an empty list', async () => {
    expect(await projectStore.classifyMany([])).toBe(0);
    expect(await projectStore.classifyMany([{ id: 'zzz.jpg', species: 'Kea', count: 1 }])).toBe(0);
    expect(projectStore.batches[0].classifiedCount).toBe(1);
  });

  it('never saves a count below one', async () => {
    await projectStore.classifyMany([{ id: 'a.jpg', species: 'Kea', count: 0 }]);
    expect(items()[0].classifications[0].count).toBe(1);
  });
});
