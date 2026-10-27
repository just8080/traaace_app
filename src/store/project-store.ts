import { showToast } from '../services/ui-scale';
import { ipc, isTauriEnvironment, generateThumbnailsBackground } from '../services/tauri-bridge';
import { DelayedAdvance, getAdvanceDelay } from './advance-delay';
import type { BatchSummary, BatchMediaResponse, MediaItem, Classification, KeymapRecord, FileClassifications } from '../ipc-types';

export type { KeymapRecord };

export type ProjectTab = 'batches' | 'classify' | 'insights' | 'keymap' | 'settings' | 'help';

export type ProjectBatchSummary = BatchSummary;
export type ProjectMediaItem = MediaItem;
export type ProjectBatchMediaResponse = BatchMediaResponse;

export interface CommentRecord {
  id: number;
  comment: string;
  builtin: boolean;
}

export const DEFAULT_COMMENTS: CommentRecord[] = [
  { id: 1, comment: 'False trigger', builtin: true },
  { id: 2, comment: 'Multiple animals', builtin: true },
  { id: 3, comment: 'Poor quality / blurry', builtin: true },
  { id: 4, comment: 'Juvenile / young in frame', builtin: true },
  { id: 5, comment: 'Injured animal', builtin: true },
  { id: 6, comment: 'Camera moved / obstruction', builtin: true },
];

export interface AnalyticsData {
  total_images: number;
  classified_images: number;
  exported_images: number;
  species_counts: Record<string, number>;
  hourly_activity?: Record<string, number>;
  site_counts?: Record<string, number>;
  total_species_count: number;
}

export type ProjectStoreListener = () => void;

class ProjectStore {
  activeTab: ProjectTab = 'batches';
  workingFolder: string | null = null;
  exportFolder: string | null = null;
  batches: ProjectBatchSummary[] = [];
  selectedBatchNames: Set<string> = new Set();

  // Classify Studio state
  activeBatchName: string | null = null;
  activeBatchMedia: ProjectBatchMediaResponse | null = null;
  currentIndex = 0;
  viewMode: 'single' | 'grid' = 'single';
  autoAdvance = true;
  showCompletionPrompt = false;
  hasShownCompletionPrompt = false;
  private readonly delayedAdvance = new DelayedAdvance();

  dismissCompletionPrompt(): void {
    this.showCompletionPrompt = false;
    this.notify();
  }

  // Keymaps & Comments
  keymaps: KeymapRecord[] = [];
  comments: CommentRecord[] = [...DEFAULT_COMMENTS];

  // Analytics
  analyticsData: AnalyticsData | null = null;

  isLoading = false;
  statusMessage = '';

  private listeners: Set<ProjectStoreListener> = new Set();

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    if (isTauriEnvironment()) {
      try {
        const settings = await ipc.getSettings();
        this.workingFolder = settings.workingFolder || null;
        this.exportFolder = settings.exportFolder || null;
        this.autoAdvance = settings.autoAdvance;
        this.notify();
        await this.loadBatches();
        await this.loadKeymaps();
        await this.loadComments();
      } catch (err) {
        console.error('ProjectStore init error:', err);
      }
    }
  }

  async setAutoAdvance(val: boolean): Promise<void> {
    this.autoAdvance = val;
    if (isTauriEnvironment()) {
      try {
        await ipc.saveSettings({ autoAdvance: val });
      } catch (err) {
        console.error('Failed to save autoAdvance setting:', err);
      }
    }
    this.notify();
  }

  subscribe(listener: ProjectStoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach(fn => fn());
  }

  setActiveTab(tab: ProjectTab): void {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    if (tab === 'batches') {
      this.loadBatches().catch(err => console.error('Failed to reload batches:', err));
    }
    this.notify();
  }

  async setWorkingFolder(path: string | null): Promise<void> {
    this.workingFolder = path;
    this.notify();
    if (isTauriEnvironment()) {
      await ipc.saveSettings({
        workingFolder: path || '',
        exportFolder: this.exportFolder || '',
      });
      await this.loadBatches();
    }
  }

  async setExportFolder(path: string | null): Promise<void> {
    this.exportFolder = path;
    if (isTauriEnvironment()) {
      await ipc.saveSettings({
        workingFolder: this.workingFolder || '',
        exportFolder: path || '',
      });
    }
    this.notify();
  }

  async deleteBatches(batchNames: string[], deleteLocalFiles = false): Promise<void> {
    if (isTauriEnvironment()) {
      try {
        for (const name of batchNames) {
          if (deleteLocalFiles) {
            try {
              await ipc.deleteBatchLocalImages(name);
            } catch (fileErr) {
              console.warn(`Could not delete local images for ${name}:`, fileErr);
            }
          }
          await ipc.deleteBatch(name);
          this.selectedBatchNames.delete(name);
          if (this.activeBatchName === name) {
            this.activeBatchName = null;
            this.activeBatchMedia = null;
            if (this.activeTab === 'classify') {
              this.activeTab = 'batches';
            }
          }
        }
        await this.loadBatches();
      } catch (err) {
        console.error('Failed to delete batches:', err);
        throw err;
      }
    } else {
      for (const name of batchNames) {
        this.batches = this.batches.filter(b => b.name !== name);
        this.selectedBatchNames.delete(name);
      }
      this.notify();
    }
  }

  async deleteBatch(batchName: string, deleteLocalFiles = false): Promise<void> {
    await this.deleteBatches([batchName], deleteLocalFiles);
  }

  async loadBatches(): Promise<void> {
    this.isLoading = true;
    this.notify();
    try {
      if (isTauriEnvironment()) {
        const rawBatches = await ipc.getBatches();
        this.batches = rawBatches.map(b => ({
          ...b,
          site: b.site || b.name,
          status: b.status || 'ready',
        }));
      }
    } catch (err) {
      console.error('Failed to load batches:', err);
    } finally {
      this.isLoading = false;
      this.notify();
    }
  }

  async updateBatchSite(batchName: string, newSite: string): Promise<boolean> {
    const cleanSite = newSite.trim();
    if (!cleanSite) return false;

    // 1. Immediately update in memory so UI reflects change instantly (0ms)
    const batch = this.batches.find(b => b.name === batchName);
    if (batch) {
      batch.site = cleanSite;
    }
    if (this.activeBatchName === batchName && this.activeBatchMedia) {
      this.activeBatchMedia.siteName = cleanSite;
    }
    this.notify();

    // 2. Persist to SQLite and _site.txt
    if (isTauriEnvironment()) {
      try {
        await ipc.updateBatchSite(batchName, cleanSite);
        return true;
      } catch (err) {
        console.error('Failed to update batch site in database:', err);
        return false;
      }
    }
    return true;
  }

  async openBatchForClassification(batchName: string): Promise<void> {
    this.showCompletionPrompt = false;
    this.isLoading = true;
    this.notify();

    try {
      if (isTauriEnvironment()) {
        const media = await ipc.getBatchMedia(batchName);
        this.activeBatchName = batchName;
        this.activeBatchMedia = media;
        this.currentIndex = 0;

        // Pre-generate 300px thumbnails in background
        generateThumbnailsBackground(media.items.map(i => i.fullPath));

        // Auto-advance to first unclassified item
        const firstUnclassified = media.items.findIndex(it => !it.classifications || it.classifications.length === 0);
        if (firstUnclassified !== -1) {
          this.currentIndex = firstUnclassified;
          this.hasShownCompletionPrompt = false;
        } else {
          // All images are already classified in this batch
          this.hasShownCompletionPrompt = media.items.length > 0;
        }

        await this.loadKeymaps();
        this.viewMode = 'single';
        this.activeTab = 'classify';
      }
    } catch (err) {
      console.error('Failed to open batch for classification:', err);
      showToast(`Could not open batch "${batchName}": ${err}`);
    } finally {
      this.isLoading = false;
      this.notify();
    }
  }

  get activeMediaItem(): ProjectMediaItem | null {
    if (!this.activeBatchMedia || this.activeBatchMedia.items.length === 0) return null;
    if (this.currentIndex < 0 || this.currentIndex >= this.activeBatchMedia.items.length) return null;
    return this.activeBatchMedia.items[this.currentIndex];
  }

  async saveActiveClassification(species: string, comment?: string, count?: number, advance?: boolean): Promise<void> {
    const item = this.activeMediaItem;
    const batchName = this.activeBatchName;
    if (!item || !batchName) return;

    const existingClass = item.classifications && item.classifications[0];
    const chosenComment = comment !== undefined ? comment : (existingClass?.comment || '');
    const chosenCount = count !== undefined ? Math.max(1, count) : (existingClass?.count || 1);

    const classification: Classification = {
      species,
      count: chosenCount,
      comment: chosenComment,
      speciesInFrame: chosenCount,
    };
    const classifications = [classification];

    // 1. Update in-memory state immediately
    item.classifications = classifications;

    // 2. Auto advance if advance requested or autoAdvance is enabled, after the configured delay so
    //    further edits (species, count, comment) can still be applied to this photo.
    const shouldAdvance = advance !== undefined ? advance : this.autoAdvance;
    if (shouldAdvance) {
      this.delayedAdvance.cancel();
      if (this.activeBatchMedia && this.currentIndex < this.activeBatchMedia.items.length - 1) {
        const delay = getAdvanceDelay();
        if (delay > 0) {
          const from = this.currentIndex;
          this.delayedAdvance.schedule(() => {
            if (this.currentIndex === from && this.activeBatchName === batchName) {
              this.currentIndex += 1;
              this.notify();
            }
          }, delay);
        } else {
          this.currentIndex += 1;
        }
      }
    } else {
      this.delayedAdvance.touch();
    }

    // 3. Immediately sync batch progress in this.batches so Project Library is live
    this.syncBatchProgress(batchName);

    // 4. Notify listeners immediately for instant 0ms UI response
    this.notify();

    // 5. Save asynchronously to SQLite in background
    if (isTauriEnvironment()) {
      ipc.saveClassification(batchName, item.fileName, classifications).catch(err => {
        console.error('Failed to save classification to SQLite:', err);
      });
    }
  }

  /** Updates the batch's classified count and status in the library, and raises the "all done" prompt once. */
  private syncBatchProgress(batchName: string): void {
    if (!this.activeBatchMedia) return;
    const items = this.activeBatchMedia.items;
    const total = items.length;
    const classifiedCount = items.filter(
      it => it.classifications && it.classifications.length > 0 && Boolean(it.classifications[0].species)
    ).length;

    const batch = this.batches.find(b => b.name === batchName);
    if (batch) {
      batch.classifiedCount = classifiedCount;
      batch.totalImages = total;
      if (total > 0 && classifiedCount >= total) {
        batch.status = 'ready';
      } else if (classifiedCount > 0) {
        batch.status = 'inprogress';
      }
    }

    // Check if all items are now classified -> notify user
    if (total > 0 && classifiedCount >= total && !this.hasShownCompletionPrompt) {
      this.showCompletionPrompt = true;
      this.hasShownCompletionPrompt = true;
    }
  }

  /**
   * Tags many photos at once (accepted AI suggestions), keyed by file name. Photos that already have a species are
   * left alone. Saved in one database transaction. Returns how many photos were tagged.
   */
  async classifyMany(tags: { id: string; species: string; count: number }[]): Promise<number> {
    const media = this.activeBatchMedia;
    const batchName = this.activeBatchName;
    if (!media || !batchName) return 0;

    const byName = new Map(tags.map(t => [t.id, t]));
    const changed: FileClassifications[] = [];
    for (const item of media.items) {
      const tag = byName.get(item.fileName);
      if (!tag || item.classifications?.[0]?.species) continue;
      const count = Math.max(1, tag.count);
      const classifications = [{ species: tag.species, count, comment: '', speciesInFrame: count }];
      item.classifications = classifications;
      changed.push({ fileName: item.fileName, classifications });
    }
    if (changed.length === 0) return 0;

    this.syncBatchProgress(batchName);
    this.notify();

    if (isTauriEnvironment()) {
      try {
        await ipc.saveClassificationsBulk(batchName, changed);
      } catch (err) {
        console.error('Failed to save classifications to SQLite:', err);
        showToast(`Could not save the tags: ${err}`);
      }
    }
    return changed.length;
  }

  async updateCurrentCount(count: number): Promise<void> {
    const item = this.activeMediaItem;
    if (!item) return;
    const existingClass = item.classifications && item.classifications[0];
    const species = existingClass?.species || 'Empty';
    const comment = existingClass?.comment || '';
    await this.saveActiveClassification(species, comment, count, false);
  }

  async updateItemDate(fileName: string, newDateIso: string, applyToRemaining: boolean): Promise<void> {
    if (!this.activeBatchMedia || !this.activeBatchMedia.items) return;
    const items = this.activeBatchMedia.items;
    const targetIdx = items.findIndex(i => i.fileName === fileName);
    if (targetIdx === -1) return;

    const oldDateStr = items[targetIdx].timestamp || new Date().toISOString();
    const oldTime = new Date(oldDateStr).getTime();
    const newTime = new Date(newDateIso).getTime();
    const diffMs = newTime - oldTime;

    items[targetIdx].timestamp = newDateIso;
    if (isTauriEnvironment() && items[targetIdx].fullPath) {
      ipc.updateFileTimestamp(items[targetIdx].fullPath, newDateIso)
        .catch(err => console.warn('Could not update file timestamp:', err));
    }

    if (applyToRemaining && !isNaN(diffMs)) {
      for (let i = targetIdx + 1; i < items.length; i++) {
        const itemOldStr = items[i].timestamp || new Date().toISOString();
        const itemOldTime = new Date(itemOldStr).getTime();
        if (!isNaN(itemOldTime)) {
          const shiftedIso = new Date(itemOldTime + diffMs).toISOString();
          items[i].timestamp = shiftedIso;
          if (isTauriEnvironment() && items[i].fullPath) {
            ipc.updateFileTimestamp(items[i].fullPath, shiftedIso)
              .catch(err => console.warn('Could not update shifted timestamp:', err));
          }
        }
      }
    }

    this.notify();
  }

  async loadKeymaps(): Promise<void> {
    if (isTauriEnvironment()) {
      try {
        this.keymaps = await ipc.getAllKeymap();
      } catch (err) {
        console.error('Failed to load keymaps:', err);
      }
      this.notify();
    }
  }

  async saveKeymap(item: KeymapRecord): Promise<void> {
    if (isTauriEnvironment()) {
      try {
        this.keymaps = await ipc.saveKeymapItem(item);
      } catch (err) {
        console.error('Failed to save keymap:', err);
        throw err;
      }
      this.notify();
    }
  }

  async deleteKeymap(keystrokes: string): Promise<void> {
    if (isTauriEnvironment()) {
      try {
        this.keymaps = await ipc.deleteKeymapItem(keystrokes);
      } catch (err) {
        console.error('Failed to delete keymap:', err);
        throw err;
      }
      this.notify();
    }
  }

  async reorderKeymaps(keys: string[]): Promise<void> {
    if (isTauriEnvironment()) {
      try {
        this.keymaps = await ipc.reorderKeymap(keys);
      } catch (err) {
        console.error('Failed to reorder keymaps:', err);
        throw err;
      }
      this.notify();
    }
  }

  async resetKeymaps(): Promise<void> {
    if (isTauriEnvironment()) {
      try {
        this.keymaps = await ipc.resetDefaultKeymaps();
      } catch (err) {
        console.error('Failed to reset keymaps:', err);
        throw err;
      }
      this.notify();
    }
  }

  async loadComments(): Promise<void> {
    if (isTauriEnvironment()) {
      try {
        const raw = await ipc.getComments();
        if (raw && raw.length > 0) {
          this.comments = raw.map((c, idx) => ({ id: idx, comment: c, builtin: true }));
        } else {
          this.comments = [...DEFAULT_COMMENTS];
        }
      } catch (err) {
        console.error('Failed to load comments from SQLite:', err);
        if (this.comments.length === 0) {
          this.comments = [...DEFAULT_COMMENTS];
        }
      }
      this.notify();
    }
  }

  async addComment(comment: string): Promise<void> {
    const trimmed = comment.trim();
    if (!trimmed) return;
    if (isTauriEnvironment()) {
      try {
        const raw = await ipc.addComment(trimmed);
        if (raw && raw.length > 0) {
          this.comments = raw.map((c, idx) => ({ id: idx, comment: c, builtin: false }));
        }
      } catch (err) {
        console.error('Failed to add comment:', err);
        this.comments.push({ id: this.comments.length + 1, comment: trimmed, builtin: false });
      }
      this.notify();
    } else {
      this.comments.push({ id: this.comments.length + 1, comment: trimmed, builtin: false });
      this.notify();
    }
  }

  async deleteComment(comment: string): Promise<void> {
    if (isTauriEnvironment()) {
      try {
        const raw = await ipc.deleteComment(comment);
        this.comments = (raw || []).map((c, idx) => ({ id: idx, comment: c, builtin: false }));
      } catch (err) {
        console.error('Failed to delete comment:', err);
        this.comments = this.comments.filter(c => c.comment !== comment);
      }
      this.notify();
    } else {
      this.comments = this.comments.filter(c => c.comment !== comment);
      this.notify();
    }
  }

  async resetComments(): Promise<void> {
    if (isTauriEnvironment()) {
      try {
        const raw = await ipc.resetDefaultComments();
        if (raw && raw.length > 0) {
          this.comments = raw.map((c, idx) => ({ id: idx, comment: c, builtin: true }));
        } else {
          this.comments = [...DEFAULT_COMMENTS];
        }
      } catch (err) {
        console.error('Failed to reset comments:', err);
        this.comments = [...DEFAULT_COMMENTS];
      }
      this.notify();
    } else {
      this.comments = [...DEFAULT_COMMENTS];
      this.notify();
    }
  }

  async loadAnalytics(): Promise<void> {
    if (isTauriEnvironment()) {
      try {
        const res = await ipc.getAnalyticsData();
        const observations = res?.observations || [];

        const total_images = this.batches.reduce((sum, b) => sum + (b.totalImages || 0), 0);
        const classified_images = this.batches.reduce((sum, b) => sum + (b.classifiedCount || 0), 0);
        const exported_images = this.batches.reduce((sum, b) => sum + (b.exportedCount || 0), 0);
        const species_counts: Record<string, number> = {};

        observations.forEach(obs => {
          const sp = obs.species || 'Unclassified';
          species_counts[sp] = (species_counts[sp] || 0) + (obs.count || 1);
        });

        this.analyticsData = {
          total_images: total_images || observations.length,
          classified_images: classified_images || observations.length,
          exported_images,
          species_counts,
          total_species_count: Object.keys(species_counts).length,
        };
      } catch (err) {
        console.error('Failed to load analytics:', err);
      }
      this.notify();
    }
  }

  nextMedia(): void {
    this.delayedAdvance.cancel();
    if (this.activeBatchMedia && this.currentIndex < this.activeBatchMedia.items.length - 1) {
      this.currentIndex += 1;
      this.notify();
    }
  }

  prevMedia(): void {
    this.delayedAdvance.cancel();
    if (this.currentIndex > 0) {
      this.currentIndex -= 1;
      this.notify();
    }
  }

  goToIndex(idx: number): void {
    this.delayedAdvance.cancel();
    if (this.activeBatchMedia && idx >= 0 && idx < this.activeBatchMedia.items.length) {
      this.currentIndex = idx;
      this.notify();
    }
  }
}

export const projectStore = new ProjectStore();
