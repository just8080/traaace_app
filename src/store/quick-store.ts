import type { MediaItem, HotkeySlot } from '../types';
import { scanFolderMedia } from '../services/tauri-bridge';
import { DelayedAdvance, getAdvanceDelay } from './advance-delay';
import { aiStore } from './ai-store';

export type QuickStoreListener = () => void;

export const getDefaultHotkeys = (): HotkeySlot[] => [
  { key: '1', species: 'Possum', color: '#e55353' },
  { key: '2', species: 'Stoat', color: '#f6993f' },
  { key: '3', species: 'Hedgehog', color: '#ffed4a' },
  { key: '4', species: 'Rat', color: '#38c172' },
  { key: '5', species: 'Mouse', color: '#4dc0b5' },
  { key: '6', species: 'Feral Cat', color: '#3490dc' },
  { key: '7', species: 'Bird', color: '#6574cd' },
  { key: '8', species: 'Dog / Human', color: '#9561e2' },
  { key: '9', species: 'Other', color: '#f66d9b' },
  { key: 'Space', species: 'Empty', color: '#6c757d' },
];

export const DEFAULT_HOTKEYS: readonly HotkeySlot[] = Object.freeze(
  getDefaultHotkeys().map(slot => Object.freeze({ ...slot }))
);

export const getDefaultComments = (): string[] => [
  'Juvenile',
  'Multiple animals',
  'Poor Quality / Blurry',
  'False trigger',
  'Near Trap',
  'Off Center',
  'Injured animal',
  'Day',
  'Night',
];

export const DEFAULT_PRESET_COMMENTS: readonly string[] = Object.freeze([...getDefaultComments()]);

class QuickStore {
  folderPath: string | null = null;
  folderName: string = '';
  siteName: string = '';
  items: MediaItem[] = [];
  currentIndex = 0;
  viewMode: 'single' | 'grid' = 'single';
  hotkeys: HotkeySlot[] = this.loadInitialHotkeys();
  presetComments: string[] = this.loadInitialComments();
  selectedItemIds: Set<string> = new Set();
  isLoading = false;
  statusMessage = '';
  isSessionStarted = false;

  setSiteName(site: string): void {
    this.siteName = site.trim();
    this.notify();
  }

  startSession(): void {
    if (this.folderPath && this.items.length > 0) {
      this.isSessionStarted = true;
      this.notify();
    }
  }

  private loadInitialComments(): string[] {
    try {
      const saved = localStorage.getItem('traaace_quick_comments');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to load quick comments from localStorage:', e);
    }
    return getDefaultComments();
  }

  private loadInitialHotkeys(): HotkeySlot[] {
    try {
      const saved = localStorage.getItem('traaace_quick_hotkeys');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Failed to load quick hotkeys from localStorage:', e);
    }
    return getDefaultHotkeys();
  }

  private listeners: Set<QuickStoreListener> = new Set();

  subscribe(listener: QuickStoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach(fn => fn());
  }

  get activeItem(): MediaItem | null {
    if (this.items.length === 0 || this.currentIndex < 0 || this.currentIndex >= this.items.length) {
      return null;
    }
    return this.items[this.currentIndex];
  }

  get classifiedCount(): number {
    return this.items.filter(i => i.isClassified).length;
  }

  get isDirty(): boolean {
    return this.items.some(i => i.isClassified);
  }

  async loadFolder(path: string): Promise<void> {
    this.delayedAdvance.cancel();
    this.isLoading = true;
    this.statusMessage = 'Scanning folder for images...';
    this.notify();

    try {
      const isFile = /\.(jpg|jpeg|png|webp|gif|mp4|mov|avi|csv)$/i.test(path);
      const targetDir = isFile ? path.replace(/[/\\][^/\\]+$/, '') : path;
      const items = await scanFolderMedia(targetDir, true);

      const oldFolderName = this.folderName;
      this.folderPath = targetDir;
      this.folderName = targetDir.split(/[/\\]/).filter(Boolean).pop() || 'Folder';

      // Default siteName to folder name if blank or if it previously mirrored the old folder name
      if (!this.siteName || this.siteName.trim() === '' || this.siteName === oldFolderName) {
        this.siteName = this.folderName.split('-')[0] || this.folderName;
      }

      this.items = items;
      aiStore.clear();
      this.currentIndex = 0;
      this.viewMode = 'single';
      this.selectedItemIds.clear();
      this.isSessionStarted = false;
      this.statusMessage = items.length > 0 ? `Found ${items.length} images.` : 'No images found in folder.';
    } catch (err) {
      console.error('Failed to load folder:', err);
      this.statusMessage = `Error scanning folder: ${err}`;
    } finally {
      this.isLoading = false;
      this.notify();
    }
  }

  autoAdvance = true;
  showCompletionPrompt = false;
  private readonly delayedAdvance = new DelayedAdvance();

  setAutoAdvance(val: boolean): void {
    this.autoAdvance = val;
    this.notify();
  }

  classifyActive(
    species: string,
    confidence: 'high' | 'medium' | 'low' = 'high',
    comment?: string,
    count: number = 1,
    advance?: boolean
  ): void {
    const item = this.activeItem;
    if (!item) return;

    const isLast = this.currentIndex === this.items.length - 1;
    this.delayedAdvance.cancel();
    item.species = species;
    item.confidence = confidence;
    item.count = count;
    if (comment !== undefined) {
      item.comment = comment;
    }
    item.isClassified = true;

    const shouldAdvance = advance !== undefined ? advance : this.autoAdvance;
    const delay = getAdvanceDelay();
    if (shouldAdvance && this.currentIndex < this.items.length - 1) {
      if (delay > 0) {
        // Stay on this photo so further hotkeys (species, count, comment) still apply to it.
        const from = this.currentIndex;
        this.delayedAdvance.schedule(() => {
          if (this.currentIndex === from) {
            this.currentIndex += 1;
            this.notify();
          }
        }, delay);
      } else {
        this.currentIndex += 1;
      }
    } else if (isLast && this.classifiedCount === this.items.length) {
      // Reached the last photo and everything is classified!
      this.showCompletionPrompt = true;
    }
    this.notify();
  }

  updateCurrentCount(count: number): void {
    const item = this.activeItem;
    if (item) {
      item.count = count;
      this.delayedAdvance.touch();
      this.notify();
    }
  }

  dismissCompletionPrompt(): void {
    this.showCompletionPrompt = false;
    this.notify();
  }

  setActiveComment(comment: string): void {
    const item = this.activeItem;
    if (item) {
      item.comment = comment;
      this.delayedAdvance.touch();
      this.notify();
    }
  }

  appendActiveComment(text: string): void {
    const item = this.activeItem;
    if (item) {
      if (item.comment && item.comment.trim()) {
        if (!item.comment.includes(text)) {
          item.comment = `${item.comment}, ${text}`;
        }
      } else {
        item.comment = text;
      }
      this.delayedAdvance.touch();
      this.notify();
    }
  }

  classifySelected(species: string): void {
    if (this.selectedItemIds.size === 0) {
      this.classifyActive(species);
      return;
    }

    this.items.forEach(item => {
      if (this.selectedItemIds.has(item.id)) {
        item.species = species;
        item.isClassified = true;
      }
    });
    this.selectedItemIds.clear();
    this.notify();
  }

  /**
   * Tags several photos at once (AI suggestions the user accepted). Photos already classified are left
   * alone unless `overwrite` is set. Returns how many were tagged.
   */
  applyTags(
    tags: { id: string; species: string; count: number; confidence: 'high' | 'medium' | 'low' }[],
    overwrite = false
  ): number {
    const byId = new Map(tags.map(t => [t.id, t]));
    let applied = 0;
    this.items.forEach(item => {
      const tag = byId.get(item.id);
      if (!tag || (item.isClassified && !overwrite)) return;
      item.species = tag.species;
      item.count = tag.count;
      item.confidence = tag.confidence;
      item.isClassified = true;
      applied += 1;
    });
    if (applied > 0) this.notify();
    return applied;
  }

  updateItemDate(itemId: string, newDateIso: string, applyToRemaining: boolean): void {
    const targetIdx = this.items.findIndex(i => i.id === itemId);
    if (targetIdx === -1) return;

    const oldDate = new Date(this.items[targetIdx].timestamp).getTime();
    const newDate = new Date(newDateIso).getTime();
    const diffMs = newDate - oldDate;

    this.items[targetIdx].timestamp = newDateIso;

    if (applyToRemaining && !isNaN(diffMs)) {
      for (let i = targetIdx + 1; i < this.items.length; i++) {
        const itemOldTime = new Date(this.items[i].timestamp).getTime();
        if (!isNaN(itemOldTime)) {
          this.items[i].timestamp = new Date(itemOldTime + diffMs).toISOString();
        }
      }
    }

    this.notify();
  }

  setHotkeys(slots: HotkeySlot[]): void {
    this.hotkeys = slots.map(s => ({ ...s }));
    this.notify();
  }

  updateHotkey(index: number, species: string, notify = false): void {
    if (index >= 0 && index < this.hotkeys.length) {
      this.hotkeys[index] = { ...this.hotkeys[index], species };
      try {
        localStorage.setItem('traaace_quick_hotkeys', JSON.stringify(this.hotkeys));
      } catch (e) {
        console.warn('Failed to save hotkeys to localStorage:', e);
      }
      if (notify) {
        this.notify();
      }
    }
  }

  resetHotkeys(): void {
    this.hotkeys = getDefaultHotkeys();
    try {
      localStorage.removeItem('traaace_quick_hotkeys');
    } catch (e) {
      console.warn('Failed to reset hotkeys in localStorage:', e);
    }
    this.notify();
  }

  addPresetComment(comment: string): void {
    const trimmed = comment.trim();
    if (trimmed && !this.presetComments.includes(trimmed)) {
      this.presetComments.push(trimmed);
      this.saveComments();
      this.notify();
    }
  }

  updatePresetComment(index: number, comment: string, notify = false): void {
    if (index >= 0 && index < this.presetComments.length) {
      this.presetComments[index] = comment;
      this.saveComments();
      if (notify) {
        this.notify();
      }
    }
  }

  removePresetComment(index: number): void {
    if (index >= 0 && index < this.presetComments.length) {
      this.presetComments.splice(index, 1);
      this.saveComments();
      this.notify();
    }
  }

  resetPresetComments(): void {
    this.presetComments = getDefaultComments();
    try {
      localStorage.removeItem('traaace_quick_comments');
    } catch (e) {
      console.warn('Failed to reset comments in localStorage:', e);
    }
    this.notify();
  }

  private saveComments(): void {
    try {
      localStorage.setItem('traaace_quick_comments', JSON.stringify(this.presetComments));
    } catch (e) {
      console.warn('Failed to save comments to localStorage:', e);
    }
  }

  setViewMode(mode: 'single' | 'grid'): void {
    this.viewMode = mode;
    this.notify();
  }

  nextImage(): void {
    this.delayedAdvance.cancel();
    if (this.currentIndex < this.items.length - 1) {
      this.currentIndex += 1;
      this.notify();
    }
  }

  prevImage(): void {
    this.delayedAdvance.cancel();
    if (this.currentIndex > 0) {
      this.currentIndex -= 1;
      this.notify();
    }
  }

  goToIndex(idx: number): void {
    this.delayedAdvance.cancel();
    if (idx >= 0 && idx < this.items.length) {
      this.currentIndex = idx;
      this.notify();
    }
  }

  toggleSelection(id: string): void {
    if (this.selectedItemIds.has(id)) {
      this.selectedItemIds.delete(id);
    } else {
      this.selectedItemIds.add(id);
    }
    this.notify();
  }

  selectAll(): void {
    this.selectedItemIds = new Set(this.items.map(i => i.id));
    this.notify();
  }

  clearSelection(): void {
    this.selectedItemIds.clear();
    this.notify();
  }

  clearSession(): void {
    this.delayedAdvance.cancel();
    this.folderPath = null;
    this.folderName = '';
    this.siteName = '';
    this.items = [];
    aiStore.clear();
    this.currentIndex = 0;
    this.viewMode = 'single';
    this.selectedItemIds.clear();
    this.showCompletionPrompt = false;
    this.isSessionStarted = false;
    this.notify();
  }
}

export const quickStore = new QuickStore();
