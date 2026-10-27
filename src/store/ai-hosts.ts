import { ipc, isTauriEnvironment } from '../services/tauri-bridge';
import { quickStore } from './quick-store';
import { projectStore } from './project-store';
import type { AiSuggestion } from '../ipc-types';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface AiHostItem {
  id: string;
  path: string;
  filename: string;
  classified: boolean;
}

export interface AiTag {
  id: string;
  species: string;
  count: number;
  confidence: ConfidenceLevel;
}

/** What the AI panel needs from the workspace it sits in, so Quick and Project share one panel. */
export interface AiHost {
  /** `quick`, or `project:<batch>`; suggestions never carry over between scopes. */
  scope(): string;
  items(): AiHostItem[];
  activeId(): string | null;
  classifyActive(species: string, confidence: ConfidenceLevel, count: number): void;
  /** Tags photos the user has not tagged yet; returns how many were tagged. */
  applyTags(tags: AiTag[]): number | Promise<number>;
  knownSpecies(): string[];
  subscribe(listener: () => void): () => void;
  /** Project mode keeps suggestions in the database; Quick mode only in memory. */
  load?(): Promise<AiSuggestion[]>;
  save?(batch: AiSuggestion[]): Promise<void>;
  clearSaved?(): Promise<void>;
}

export const quickAiHost: AiHost = {
  scope: () => 'quick',
  items: () => quickStore.items.map(i => ({ id: i.id, path: i.path, filename: i.filename, classified: i.isClassified })),
  activeId: () => quickStore.activeItem?.id ?? null,
  classifyActive: (species, confidence, count) => quickStore.classifyActive(species, confidence, undefined, count),
  applyTags: tags => quickStore.applyTags(tags),
  knownSpecies: () => Array.from(new Set(quickStore.hotkeys.map(h => h.species).filter(Boolean))),
  subscribe: listener => quickStore.subscribe(listener),
};

export const projectAiHost: AiHost = {
  scope: () => `project:${projectStore.activeBatchName ?? ''}`,
  items: () =>
    (projectStore.activeBatchMedia?.items ?? []).map(i => ({
      id: i.fileName,
      path: i.fullPath,
      filename: i.fileName,
      classified: Boolean(i.classifications?.[0]?.species),
    })),
  activeId: () => projectStore.activeMediaItem?.fileName ?? null,
  classifyActive: (species, _confidence, count) => void projectStore.saveActiveClassification(species, undefined, count),
  applyTags: tags => projectStore.classifyMany(tags),
  knownSpecies: () => Array.from(new Set(projectStore.keymaps.map(k => k.species).filter(Boolean))),
  subscribe: listener => projectStore.subscribe(listener),
  load: async () => {
    const batch = projectStore.activeBatchName;
    if (!batch || !isTauriEnvironment()) return [];
    const rows = await ipc.getAiSuggestions(batch);
    return rows.flatMap(row => {
      try {
        return [JSON.parse(row.data) as AiSuggestion];
      } catch {
        return [];
      }
    });
  },
  save: async batch => {
    const name = projectStore.activeBatchName;
    if (!name || !isTauriEnvironment()) return;
    await ipc.saveAiSuggestions(name, batch.map(s => ({ fileName: s.id, data: JSON.stringify(s) })));
  },
  clearSaved: async () => {
    const name = projectStore.activeBatchName;
    if (name && isTauriEnvironment()) await ipc.clearAiSuggestions(name);
  },
};
