import { hotkeyCounts } from '../services/species-groups';
import { quickStore } from '../store/quick-store';
import { projectStore } from '../store/project-store';
import { readMediaDataUri } from '../services/tauri-bridge';
import { icon } from '../services/icons';
import { html, escapeHtml, isVideoFile } from '../utils';
import { ZoomPanController } from './classifier/zoom-pan';
import { GridThumbnails } from './classifier/grid-thumbnails';
import {
  NO_FILTER, filterIndices, isFilterActive, matchSpeciesOptions, pageOf, snapToFiltered, speciesOptions, stepFiltered,
  type GridFilter,
} from './classifier/grid-filter';
import { CommentDropdown } from './classifier/comment-dropdown';
import { KeyboardController } from './classifier/keyboard';
import { SidebarResizer } from './classifier/sidebar-resizer';
import { VideoControls, viewerMediaHtml, viewerMediaKind } from './classifier/video-controls';
import { enableDragScroll } from '../services/drag-scroll';
import { getAdvanceDelay, setAdvanceDelay, MAX_ADVANCE_DELAY_MS } from '../store/advance-delay';
import './ai-panel';
import './date-editor-modal';
import type { DateEditorModal } from './date-editor-modal';
import './site-editor-modal';
import type { SiteEditorModal } from './site-editor-modal';

export type ClassifierMode = 'quick' | 'project';

export interface UnifiedPhotoItem {
  id: string;
  fileName: string;
  fullPath: string;
  timestamp: string;
  species?: string;
  comment?: string;
  count: number;
  isClassified: boolean;
}

export class ClassifierView extends HTMLElement {
  private mode: ClassifierMode = 'quick';
  private unsubscribe: (() => void) | null = null;
  /** Aborted on disconnect; every window-level listener is registered with its signal. */
  private windowAbort: AbortController | null = null;

  // Image zoom and pan state
  private readonly zoomPan = new ZoomPanController(this);
  private readonly sidebarResizer = new SidebarResizer(this);
  private readonly videoControls = new VideoControls(this);
  private toolbarScrollCleanups: Array<() => void> = [];
  private currentImageSrc = '';
  private currentPath = '';

  // Comment dropdown state
  private readonly commentDropdown = new CommentDropdown(this, {
    getCurrentComment: () => this.getActiveItem()?.comment || '',
    getPresets: () => this.getPresetComments(),
    save: (comment) => this.saveCurrentComment(comment),
  });

  // Structure built flag to avoid DOM teardown on photo transitions
  private isStructureBuilt = false;
  private lastViewMode: 'single' | 'grid' = 'single';
  private readonly gridThumbnails = new GridThumbnails();
  private gridPage = 0;
  private readonly pageSize = 48;

  // Grid filters. They are remembered while switching between Single and Grid view, and reset
  // when a new folder or batch is opened.
  private gridFilter: GridFilter = NO_FILTER;
  /**
   * Photos the filtered grid shows. Kept fixed while you work so a photo you just tagged doesn't
   * vanish from under you; refreshed when the filter changes or the grid is opened again.
   */
  private filteredIndices: number[] | null = null;
  /** The photo list the filters were set for; a different list means a new folder or batch. */
  private filterSource: unknown = null;
  private speciesMenuHighlight = 0;

  private readonly keyboard = new KeyboardController(this, {
    hasItems: () => this.getUnifiedItems().length > 0,
    getKeymaps: () => this.getEffectiveKeymaps(),
    getCurrentComment: () => this.getCurrentInputComment(),
    classify: (species, comment, count) => this.classifyCurrent(species, comment, count),
    nextPhoto: () => this.nextPhoto(),
    prevPhoto: () => this.prevPhoto(),
    stepAnimalCount: (delta) => this.stepAnimalCount(delta),
    toggleViewMode: () => this.setViewMode(this.getViewMode() === 'single' ? 'grid' : 'single'),
    focusCustomSpecies: () => {
      const input = this.querySelector<HTMLInputElement>('#inputCustomSpecies');
      input?.focus();
      input?.select();
    },
  }, this.commentDropdown);

  static get observedAttributes() {
    return ['mode'];
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if (name === 'mode' && oldValue !== newValue) {
      this.mode = (newValue as ClassifierMode) || 'quick';
      this.isStructureBuilt = false;
      this.resubscribe();
      this.render();
    }
  }

  connectedCallback(): void {
    this.mode = (this.getAttribute('mode') as ClassifierMode) || 'quick';
    this.windowAbort?.abort();
    this.windowAbort = new AbortController();
    this.resubscribe();
    this.keyboard.attach(this.windowAbort?.signal);
    this.setupWindowClickCloser();
    this.zoomPan.attachWindowListeners(this.windowAbort?.signal);
    this.sidebarResizer.attachWindowListeners(this.windowAbort?.signal);
    this.render();
  }

  disconnectedCallback(): void {
    this.keyboard.clear();
    this.videoControls.release();
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.windowAbort?.abort();
    this.windowAbort = null;
    this.gridThumbnails.dispose();
    this.toolbarScrollCleanups.forEach(fn => fn());
    this.toolbarScrollCleanups = [];
  }

  private resubscribe(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    if (this.mode === 'quick') {
      this.unsubscribe = quickStore.subscribe(() => this.handleStoreUpdate());
    } else {
      this.unsubscribe = projectStore.subscribe(() => this.handleStoreUpdate());
    }
  }

  // ============================================================
  // Unified Data Accessors
  // ============================================================
  private getUnifiedItems(): UnifiedPhotoItem[] {
    if (this.mode === 'quick') {
      return quickStore.items.map(i => ({
        id: i.id,
        fileName: i.filename,
        fullPath: i.path,
        timestamp: i.timestamp,
        species: i.species,
        comment: i.comment,
        count: i.count || 1,
        isClassified: i.isClassified,
      }));
    } else {
      const items = projectStore.activeBatchMedia?.items || [];
      return items.map(i => {
        const first = i.classifications && i.classifications[0];
        return {
          id: i.fileName,
          fileName: i.fileName,
          fullPath: i.fullPath,
          timestamp: i.timestamp ?? '',
          species: first?.species,
          comment: first?.comment,
          count: first?.count || 1,
          isClassified: Boolean(first?.species),
        };
      });
    }
  }

  private getCurrentIndex(): number {
    return this.mode === 'quick' ? quickStore.currentIndex : projectStore.currentIndex;
  }

  private getActiveItem(): UnifiedPhotoItem | null {
    const items = this.getUnifiedItems();
    const idx = this.getCurrentIndex();
    if (idx < 0 || idx >= items.length) return null;
    return items[idx];
  }

  // ============================================================
  // Grid Filters
  // ============================================================
  private isGridFiltered(): boolean {
    return this.getViewMode() === 'grid' && isFilterActive(this.gridFilter);
  }

  /** Positions (in the full photo list) of the photos the grid shows. */
  private getVisibleIndices(items: UnifiedPhotoItem[]): number[] {
    const source = this.mode === 'quick' ? quickStore.items : projectStore.activeBatchMedia?.items;
    if (source !== this.filterSource) {
      this.filterSource = source;
      this.gridFilter = NO_FILTER;
      this.filteredIndices = null;
    }
    if (!isFilterActive(this.gridFilter)) return items.map((_, i) => i);
    if (!this.filteredIndices) this.filteredIndices = filterIndices(items, this.gridFilter);
    return this.filteredIndices.filter(i => i < items.length);
  }

  /** False when a grid filter hides the current photo, so hotkeys can't tag a photo you can't see. */
  private hasTaggablePhoto(): boolean {
    const items = this.getUnifiedItems();
    if (items.length === 0) return false;
    if (!this.isGridFiltered()) return true;
    return this.getVisibleIndices(items).includes(this.getCurrentIndex());
  }

  private setGridFilter(filter: GridFilter): void {
    this.gridFilter = filter;
    this.filteredIndices = null;
    const items = this.getUnifiedItems();
    const visible = this.getVisibleIndices(items);
    const idx = this.getCurrentIndex();
    this.isStructureBuilt = false;
    if (isFilterActive(filter)) {
      // Start on page 1, keeping the current photo selected if it is there.
      this.gridPage = 0;
      if (visible.length > 0 && pageOf(visible, idx, this.pageSize) !== 0) {
        this.goToPhoto(visible[0]);
      }
    } else {
      // Filter cleared: back to the page with the current photo.
      this.gridPage = Math.floor(idx / this.pageSize);
    }
    this.render();
  }

  private getTitle(): string {
    if (this.mode === 'quick') {
      return quickStore.folderName || 'Quick Session';
    }
    return projectStore.activeBatchName || 'Project Batch';
  }

  private getSiteName(): string {
    if (this.mode === 'quick') {
      return quickStore.siteName || quickStore.folderName || 'Set Location';
    }
    const activeBatchName = projectStore.activeBatchName;
    const batch = projectStore.batches.find(b => b.name === activeBatchName);
    return projectStore.activeBatchMedia?.siteName || batch?.site || 'Set Location';
  }

  private getViewMode(): 'single' | 'grid' {
    return this.mode === 'quick' ? quickStore.viewMode : projectStore.viewMode;
  }

  private setViewMode(vm: 'single' | 'grid'): void {
    this.isStructureBuilt = false;
    this.lastViewMode = vm;
    let snapTo: number | null = null;
    if (vm === 'grid') {
      // Reopening the grid refreshes the filtered list (photos tagged since then drop out).
      this.filteredIndices = null;
      const idx = this.getCurrentIndex();
      const visible = this.getVisibleIndices(this.getUnifiedItems());
      snapTo = snapToFiltered(visible, idx);
      this.gridPage = pageOf(visible, snapTo ?? idx, this.pageSize) ?? 0;
    }
    if (this.mode === 'quick') {
      quickStore.setViewMode(vm);
    } else {
      projectStore.viewMode = vm;
      this.render();
    }
    if (snapTo !== null && snapTo !== this.getCurrentIndex()) this.goToPhoto(snapTo);
  }

  private advanceDelayPercent(ms: number): number {
    return Math.round((ms / MAX_ADVANCE_DELAY_MS) * 100);
  }

  private formatAdvanceDelay(ms: number): string {
    return ms <= 0 ? 'Instant' : `${(ms / 1000).toFixed(1)}s`;
  }

  /** Keeps the delay slider's label, value and enabled state in step with the settings. */
  private syncAdvanceDelayControl(): void {
    const enabled = this.getAutoAdvance();
    const slider = this.querySelector<HTMLInputElement>('#rngAdvanceDelay');
    const label = this.querySelector<HTMLElement>('#lblAdvanceDelay');
    const row = this.querySelector<HTMLElement>('#advanceDelayRow');
    const ms = getAdvanceDelay();
    if (slider) {
      if (document.activeElement !== slider) slider.value = String(ms);
      slider.style.setProperty('--pct', `${this.advanceDelayPercent(ms)}%`);
      slider.disabled = !enabled;
    }
    if (label) label.textContent = this.formatAdvanceDelay(ms);
    if (row) row.style.opacity = enabled ? '' : '0.5';
  }

  private getAutoAdvance(): boolean {
    return this.mode === 'quick' ? quickStore.autoAdvance : projectStore.autoAdvance;
  }

  private setAutoAdvance(val: boolean): void {
    if (this.mode === 'quick') {
      quickStore.setAutoAdvance(val);
    } else {
      projectStore.setAutoAdvance(val);
    }
  }

  private getPresetComments(): string[] {
    if (this.mode === 'quick') {
      return quickStore.presetComments;
    }
    return projectStore.comments.map(c => (typeof c === 'string' ? c : c.comment || ''));
  }

  // ============================================================
  // Classification Actions
  // ============================================================
  private classifyCurrent(species: string, comment?: string, count?: number, advance?: boolean): void {
    this.keyboard.clear();
    if (!this.hasTaggablePhoto()) return;
    const finalComment = comment !== undefined ? comment : this.getCurrentInputComment();
    const finalCount = count !== undefined ? count : this.getCurrentInputCount();

    if (this.mode === 'quick') {
      quickStore.classifyActive(species, 'high', finalComment, finalCount, advance);
    } else {
      projectStore.saveActiveClassification(species, finalComment, finalCount, advance);
    }
  }

  private saveCurrentComment(comment: string): void {
    if (this.mode === 'quick') {
      quickStore.setActiveComment(comment);
    } else {
      const active = this.getActiveItem();
      const currentSpecies = active?.species || 'Empty';
      const count = this.getCurrentInputCount();
      projectStore.saveActiveClassification(currentSpecies, comment, count, false);
    }

    // Sync input in sidebar
    const input = this.querySelector<HTMLInputElement>('#inputSidebarComment');
    if (input) input.value = comment;

    const clearBtn = this.querySelector<HTMLElement>('#btnClearComment');
    if (clearBtn) clearBtn.style.display = comment ? 'block' : 'none';

    const badge = this.querySelector<HTMLElement>('#toolbarCommentBadge');
    const label = this.querySelector<HTMLElement>('#activeCommentLabel');
    if (badge && label) {
      if (comment) {
        label.textContent = comment;
        badge.style.display = 'inline-flex';
      } else {
        badge.style.display = 'none';
      }
    }

    const hint = this.querySelector<HTMLElement>('#commentStatusHint');
    if (hint) {
      hint.innerHTML = comment ? `${icon('check')} Saved` : 'Cleared';
      hint.style.color = 'var(--color-brand)';
      setTimeout(() => { if (hint) hint.innerHTML = ''; }, 2000);
    }
  }

  private updateCurrentAnimalCount(count: number): void {
    const safeCount = Math.max(1, count);
    if (this.mode === 'quick') {
      quickStore.updateCurrentCount(safeCount);
    } else {
      projectStore.updateCurrentCount(safeCount);
    }

    const input = this.querySelector<HTMLInputElement>('#inputAnimalCount');
    if (input) input.value = String(safeCount);

    const badge = this.querySelector<HTMLElement>('#activeCountBadge');
    if (badge) {
      if (safeCount > 1) {
        badge.innerHTML = `${icon('paw')} ×${safeCount}`;
        badge.style.display = 'inline-flex';
      } else {
        badge.style.display = 'none';
      }
    }
  }

  private stepAnimalCount(delta: number): void {
    const current = this.getCurrentInputCount();
    const next = Math.max(1, current + delta);
    this.updateCurrentAnimalCount(next);
  }

  private nextPhoto(): void {
    if (this.isGridFiltered()) {
      this.stepGridFiltered(1);
      return;
    }
    this.keyboard.clear();
    this.zoomPan.reset();
    if (this.mode === 'quick') {
      quickStore.nextImage();
    } else {
      projectStore.nextMedia();
    }
  }

  private prevPhoto(): void {
    if (this.isGridFiltered()) {
      this.stepGridFiltered(-1);
      return;
    }
    this.keyboard.clear();
    this.zoomPan.reset();
    if (this.mode === 'quick') {
      quickStore.prevImage();
    } else {
      projectStore.prevMedia();
    }
  }

  /** Next / previous photo within the filtered grid. */
  private stepGridFiltered(delta: 1 | -1): void {
    const target = stepFiltered(this.getVisibleIndices(this.getUnifiedItems()), this.getCurrentIndex(), delta);
    if (target !== null) this.goToPhoto(target);
    else this.keyboard.clear();
  }

  private goToPhoto(idx: number): void {
    this.keyboard.clear();
    this.zoomPan.reset();
    if (this.mode === 'quick') {
      quickStore.goToIndex(idx);
    } else {
      projectStore.goToIndex(idx);
    }
  }

  private getCurrentInputCount(): number {
    const input = this.querySelector<HTMLInputElement>('#inputAnimalCount');
    if (input) {
      return Math.max(1, parseInt(input.value, 10) || 1);
    }
    const active = this.getActiveItem();
    return active?.count || 1;
  }

  private getCurrentInputComment(): string {
    const input = this.querySelector<HTMLInputElement>('#inputSidebarComment');
    if (input) {
      return input.value.trim();
    }
    const active = this.getActiveItem();
    return active?.comment || '';
  }

  private getEffectiveKeymaps(): Array<{ keystrokes: string; species: string }> {
    if (this.mode === 'quick') {
      return quickStore.hotkeys.map(h => ({
        keystrokes: h.key,
        species: h.species,
      }));
    } else {
      let visible = projectStore.keymaps.filter(k => !k.hidden);
      if (visible.length === 0) {
        return quickStore.hotkeys.map(h => ({
          keystrokes: h.key,
          species: h.species,
        }));
      }
      return visible.map(k => ({
        keystrokes: k.keystrokes,
        species: k.species,
      }));
    }
  }

  private setupWindowClickCloser(): void {
    window.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('#gridSpeciesFilter')) this.closeSpeciesMenu();
      if (!this.commentDropdown.isOpen) return;
      if (!target.closest('#commentComboboxWrap') && !target.closest('#toolbarCommentBadge')) {
        this.commentDropdown.close();
      }
    }, { signal: this.windowAbort?.signal });
  }

  // ============================================================
  // DOM Render & Update Cycle
  // ============================================================
  /**
   * Shows `src` in the viewer. The element is swapped when the kind changes (photo, video, or a
   * video format that cannot be previewed); otherwise only its source is updated. Any playing
   * video is released first so its decoder and buffers are freed.
   */
  private applyViewerMedia(fileName: string, src: string): void {
    const container = this.querySelector<HTMLElement>('#viewerImgContainer');
    if (!container) return;

    this.videoControls.release();
    const kind = viewerMediaKind(fileName);
    const current = container.querySelector<HTMLElement>('#mainViewerImg');

    if (current && current.dataset.kind === 'image' && kind === 'image') {
      const img = current as HTMLImageElement;
      img.src = src;
      img.alt = fileName;
      return;
    }

    // Swap: drop the old media and any video controls, then insert the new markup at the front.
    current?.remove();
    container.querySelector('#videoUi')?.remove();
    container.insertAdjacentHTML('afterbegin', viewerMediaHtml(src, fileName));
    this.zoomPan.apply();
    this.videoControls.bind();
  }

  private handleStoreUpdate(): void {
    const items = this.getUnifiedItems();
    if (items.length === 0) {
      this.isStructureBuilt = false;
      this.render();
      return;
    }

    const currentVm = this.getViewMode();
    if (this.lastViewMode !== currentVm) {
      this.lastViewMode = currentVm;
      this.isStructureBuilt = false;
      this.render();
      return;
    }

    if (currentVm === 'grid') {
      const visible = this.getVisibleIndices(items);
      const idx = this.getCurrentIndex();
      if (isFilterActive(this.gridFilter)) {
        // Auto-advance can land on a photo the filter hides: move on to the next one shown.
        const snapped = snapToFiltered(visible, idx);
        if (snapped !== null && snapped !== idx) {
          this.goToPhoto(snapped);
          return;
        }
      }
      const expectedPage = pageOf(visible, idx, this.pageSize);
      if (expectedPage !== null && expectedPage !== this.gridPage) {
        this.gridPage = expectedPage;
        this.isStructureBuilt = false;
        this.render();
        return;
      }
    }

    if (!this.isStructureBuilt) {
      this.render();
    } else {
      this.updateActivePhotoUI();
    }
  }

  private async updateActivePhotoUI(): Promise<void> {
    const items = this.getUnifiedItems();
    if (items.length === 0) return;

    const idx = this.getCurrentIndex();
    const item = this.getActiveItem();
    const classifiedCount = items.filter(it => it.isClassified).length;
    const total = items.length;
    const percent = Math.round((classifiedCount / total) * 100);

    // Update progress in right navigation control
    const progressText = this.querySelector('#classifyProgressText');
    if (progressText) {
      progressText.textContent = `${percent}%`;
    }
    const countSub = this.querySelector('#classifiedCountSub');
    if (countSub) {
      countSub.textContent = `(${classifiedCount}/${total})`;
    }

    // Update active metadata
    const fileNameEl = this.querySelector('#activeFileName');
    if (fileNameEl && item) {
      fileNameEl.textContent = item.fileName;
      fileNameEl.setAttribute('title', item.fileName);
    }

    const speciesBadgeEl = this.querySelector('#activeSpeciesBadge');
    if (speciesBadgeEl) {
      speciesBadgeEl.textContent = item?.species || 'Unclassified';
      speciesBadgeEl.className = `badge ${item?.species ? 'badge-success' : 'badge-muted'}`;
    }

    // Update active site label
    const siteLabelEl = this.querySelector<HTMLElement>('#activeSiteLabel');
    if (siteLabelEl) {
      siteLabelEl.textContent = this.getSiteName() || 'Set Location';
    }

    // Update count badge in toolbar
    const countBadgeEl = this.querySelector<HTMLElement>('#activeCountBadge');
    if (countBadgeEl) {
      const currentCount = item?.count || 1;
      if (currentCount > 1) {
        countBadgeEl.innerHTML = `${icon('paw')} ×${currentCount}`;
        countBadgeEl.style.display = 'inline-flex';
      } else {
        countBadgeEl.style.display = 'none';
      }
    }

    // Update toolbar comment badge
    const toolbarCommentBadge = this.querySelector<HTMLElement>('#toolbarCommentBadge');
    const commentLabel = this.querySelector<HTMLElement>('#activeCommentLabel');
    if (toolbarCommentBadge && commentLabel) {
      const comment = item?.comment || '';
      if (comment) {
        commentLabel.textContent = comment;
        toolbarCommentBadge.style.display = 'inline-flex';
      } else {
        toolbarCommentBadge.style.display = 'none';
      }
    }

    // Update toolbar date label
    const activeDateLabel = this.querySelector<HTMLElement>('#activeDateLabel');
    if (activeDateLabel && item) {
      activeDateLabel.innerHTML = item.timestamp
        ? `${icon('calendar')} ${new Date(item.timestamp).toLocaleString()}`
        : `${icon('calendar')} No Date Recorded`;
    }

    // Update animal count stepper in sidebar if not actively focused
    const countInput = this.querySelector<HTMLInputElement>('#inputAnimalCount');
    if (countInput && document.activeElement !== countInput) {
      countInput.value = String(item?.count || 1);
    }

    // Update auto-advance checkbox
    const chkAuto = this.querySelector<HTMLInputElement>('#chkAutoAdvance');
    if (chkAuto && document.activeElement !== chkAuto) {
      chkAuto.checked = this.getAutoAdvance();
    }
    this.syncAdvanceDelayControl();

    // Update sidebar comment input if not actively focused
    const sidebarInput = this.querySelector<HTMLInputElement>('#inputSidebarComment');
    if (sidebarInput && document.activeElement !== sidebarInput) {
      sidebarInput.value = item?.comment || '';
    }
    const clearBtn = this.querySelector<HTMLElement>('#btnClearComment');
    if (clearBtn) {
      clearBtn.style.display = item?.comment ? 'block' : 'none';
    }

    // Update counter overlay
    const counterEl = this.querySelector('#photoCounterText');
    if (counterEl) {
      counterEl.textContent = `${idx + 1} / ${items.length}`;
    }

    // Update prev/next button disabled state
    const prevBtn = this.querySelector<HTMLButtonElement>('#btnPrevPhoto');
    const nextBtn = this.querySelector<HTMLButtonElement>('#btnNextPhoto');
    if (prevBtn) prevBtn.disabled = idx === 0;
    if (nextBtn) nextBtn.disabled = idx >= items.length - 1;

    // Update sidebar active species buttons
    this.querySelectorAll('.palette-btn').forEach(btn => {
      const sp = btn.getAttribute('data-species');
      if (sp === item?.species) {
        btn.classList.add('active-species');
      } else {
        btn.classList.remove('active-species');
      }
    });

    // Update species counts in Quick mode
    if (this.mode === 'quick') {
      const speciesCounts: Record<string, number> = {};
      items.forEach(it => {
        if (it.isClassified && it.species) {
          speciesCounts[it.species] = (speciesCounts[it.species] || 0) + 1;
        }
      });
      const keyCounts = hotkeyCounts(quickStore.hotkeys.map(h => h.species), speciesCounts);
      this.querySelectorAll('.palette-btn').forEach(btn => {
        const sp = btn.getAttribute('data-species');
        const badge = btn.querySelector('.badge');
        if (sp && badge) {
          const count = sp === 'Empty' ? speciesCounts[sp] || 0 : keyCounts[sp] || 0;
          badge.textContent = String(count);
          badge.className = `badge ${count > 0 ? 'badge-accent' : 'badge-muted'}`;
        }
      });
    }

    // Update image element source
    if (item && this.currentPath !== item.fullPath) {
      const targetPath = item.fullPath;
      this.currentPath = targetPath;
      this.zoomPan.reset();

      readMediaDataUri(targetPath).then(src => {
        if (this.currentPath === targetPath) {
          this.currentImageSrc = src;
          this.applyViewerMedia(item.fileName, src);
        }
      }).catch(err => console.error('Failed to load media:', err));

      // Speculative prefetch of the next image for instant transitions. Never for videos:
      // loading one through an Image would start decoding it.
      const nextIdx = idx + 1;
      if (nextIdx < items.length && !isVideoFile(items[nextIdx].fileName)) {
        readMediaDataUri(items[nextIdx].fullPath).then(nextSrc => {
          const pre = new Image();
          pre.src = nextSrc;
        }).catch(() => { });
      }
    }

    // Update grid card highlights and badges if currently in grid mode
    if (this.getViewMode() === 'grid') {
      this.querySelectorAll('.grid-card').forEach((card) => {
        const globalIdx = Number(card.getAttribute('data-idx'));
        if (globalIdx === idx) {
          card.classList.add('active');
          card.scrollIntoView({ block: 'nearest' });
        } else {
          card.classList.remove('active');
        }
        const it = items[globalIdx];
        if (it) {
          const badge = card.querySelector('.grid-card-species-badge');
          if (badge) {
            badge.textContent = it.species || 'Unclassified';
            badge.className = `badge grid-card-species-badge ${it.isClassified ? 'badge-success' : 'badge-muted'}`;
          }
          const countBadge = card.querySelector<HTMLElement>('.grid-card-count-badge');
          if (countBadge) {
            if (it.count > 1) {
              countBadge.textContent = `×${it.count}`;
              countBadge.style.display = 'inline-block';
            } else {
              countBadge.style.display = 'none';
            }
          }
        }
      });
    }
  }

  // ============================================================
  // Grid Filter Controls
  // ============================================================
  private bindGridFilterControls(): void {
    this.querySelector<HTMLButtonElement>('#btnGridUnclassifiedOnly')?.addEventListener('click', (e) => {
      // Release focus so Space and the hotkeys tag photos instead of pressing this button again.
      (e.currentTarget as HTMLElement).blur();
      this.setGridFilter({ unclassifiedOnly: !this.gridFilter.unclassifiedOnly, species: null });
    });

    const input = this.querySelector<HTMLInputElement>('#inputGridSpeciesFilter');
    if (!input) return;
    input.addEventListener('focus', () => {
      input.select();
      this.openSpeciesMenu('');
    });
    input.addEventListener('input', () => this.openSpeciesMenu(input.value));
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.moveSpeciesHighlight(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const highlighted = this.querySelector<HTMLElement>('#gridSpeciesMenu .combobox-option-item.highlighted');
        if (highlighted) this.pickSpecies(highlighted.dataset.species ?? null);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closeSpeciesMenu();
        input.blur();
      }
    });
    input.addEventListener('blur', () => {
      // Put back the chosen species if the typed text was not picked.
      this.closeSpeciesMenu();
      input.value = this.gridFilter.species ?? '';
    });

    const toggle = this.querySelector('#btnToggleGridSpecies');
    // mousedown is cancelled so the input keeps focus (and its menu) while the arrow is pressed.
    toggle?.addEventListener('mousedown', (e) => e.preventDefault());
    toggle?.addEventListener('click', () => {
      if (this.querySelector<HTMLElement>('#gridSpeciesMenu')?.style.display !== 'none') {
        input.blur();
      } else if (document.activeElement === input) {
        this.openSpeciesMenu('');
      } else {
        input.focus();
      }
    });
    this.querySelector('#btnClearGridSpecies')?.addEventListener('click', () => this.pickSpecies(null));
  }

  /** Shows the species list, narrowed to names containing `query`. */
  private openSpeciesMenu(query: string): void {
    const menu = this.querySelector<HTMLElement>('#gridSpeciesMenu');
    if (!menu) return;
    const options = matchSpeciesOptions(speciesOptions(this.getUnifiedItems()), query);
    const rows: Array<{ species: string | null; label: string; count?: number }> = [];
    if (!query.trim()) rows.push({ species: null, label: 'All species' });
    options.forEach(o => rows.push({ species: o.species, label: o.species, count: o.count }));

    menu.replaceChildren();
    if (rows.length === 0) {
      const none = document.createElement('div');
      none.className = 'grid-species-none';
      none.textContent = 'No matching species';
      menu.appendChild(none);
    }
    rows.forEach(row => {
      const el = document.createElement('div');
      el.className = 'combobox-option-item';
      el.setAttribute('role', 'option');
      if (row.species === this.gridFilter.species) el.classList.add('selected');
      if (row.species !== null) el.dataset.species = row.species;
      const label = document.createElement('span');
      label.textContent = row.label;
      el.appendChild(label);
      if (row.count !== undefined) {
        const count = document.createElement('span');
        count.className = 'grid-species-count';
        count.textContent = String(row.count);
        el.appendChild(count);
      }
      // mousedown, not click, so the input's blur doesn't close the menu first.
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.pickSpecies(row.species);
      });
      menu.appendChild(el);
    });
    menu.style.display = 'flex';
    // Highlight the chosen species when the list first opens, else the best match.
    const selected = rows.findIndex(r => r.species === this.gridFilter.species);
    this.speciesMenuHighlight = !query.trim() && selected >= 0 ? selected : 0;
    this.moveSpeciesHighlight(0);
  }

  private moveSpeciesHighlight(delta: number): void {
    const opts = [...this.querySelectorAll<HTMLElement>('#gridSpeciesMenu .combobox-option-item')];
    if (opts.length === 0) return;
    this.speciesMenuHighlight = Math.max(0, Math.min(opts.length - 1, this.speciesMenuHighlight + delta));
    opts.forEach((el, i) => el.classList.toggle('highlighted', i === this.speciesMenuHighlight));
    opts[this.speciesMenuHighlight].scrollIntoView({ block: 'nearest' });
  }

  private closeSpeciesMenu(): void {
    const menu = this.querySelector<HTMLElement>('#gridSpeciesMenu');
    if (menu) menu.style.display = 'none';
  }

  private pickSpecies(species: string | null): void {
    this.closeSpeciesMenu();
    this.querySelector<HTMLInputElement>('#inputGridSpeciesFilter')?.blur();
    this.setGridFilter({ unclassifiedOnly: false, species });
  }

  private async render(): Promise<void> {
    const items = this.getUnifiedItems();
    if (items.length === 0) {
      this.innerHTML = html`
        <div
          style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: var(--space-8); gap: var(--space-3); height: 100%;">
          <p style="font-size: var(--text-lg); font-weight: 600;">No images loaded for classification</p>
          ${this.mode === 'project' ? '<button class="btn-primary" id="btnBackToBatches">◀ Go to Batches</button>' : ''}
        </div>
      `;
      this.querySelector('#btnBackToBatches')?.addEventListener('click', () => {
        projectStore.setActiveTab('batches');
      });
      return;
    }

    const idx = this.getCurrentIndex();
    const item = this.getActiveItem();
    const total = items.length;
    const classifiedCount = items.filter(i => i.isClassified).length;
    const percent = Math.round((classifiedCount / total) * 100);
    const viewMode = this.getViewMode();
    const isGrid = viewMode === 'grid';
    const currentSpecies = item?.species;
    const currentComment = item?.comment || '';
    const currentCount = item?.count || 1;

    // Grid pagination bounds, over the photos the filters let through
    const visible = isGrid ? this.getVisibleIndices(items) : [];
    const filtered = isGrid && isFilterActive(this.gridFilter);
    const shown = visible.length;
    const pageSize = this.pageSize;
    const totalPages = Math.max(1, Math.ceil(shown / pageSize));
    if (this.gridPage >= totalPages) this.gridPage = totalPages - 1;
    if (this.gridPage < 0) this.gridPage = 0;

    const pageStart = this.gridPage * pageSize;
    const pageEnd = Math.min(pageStart + pageSize, shown);
    const pageIndices = visible.slice(pageStart, pageEnd);
    const emptyFilterText = this.gridFilter.unclassifiedOnly
      ? 'No unclassified photos left. Turn off “Unclassified” to see them all.'
      : `No photos tagged “${this.gridFilter.species ?? ''}”.`;

    // Load initial image src if needed
    if (item && !this.currentImageSrc) {
      this.currentPath = item.fullPath;
      try {
        this.currentImageSrc = await readMediaDataUri(item.fullPath);
      } catch (err) {
        console.error('Failed to load media URI:', err);
      }
    }

    // Compute species counts for Quick mode
    const speciesCounts: Record<string, number> = {};
    if (this.mode === 'quick') {
      items.forEach(it => {
        if (it.isClassified && it.species) {
          speciesCounts[it.species] = (speciesCounts[it.species] || 0) + 1;
        }
      });
    }

    // Keymap list setup
    let keymapButtonsHtml = '';
    if (this.mode === 'quick') {
      const slots = quickStore.hotkeys.filter(s => s.species.toLowerCase() !== 'empty' && s.key.toLowerCase() !== 'space');
      // Species without their own key (often from the AI) count under a Bird or Other key.
      const keyCounts = hotkeyCounts(slots.map(s => s.species), speciesCounts);
      keymapButtonsHtml = slots.map((slot, index) => {
        const isSelected = currentSpecies === slot.species;
        const count = keyCounts[slot.species] || 0;
        const slotNum = index < 9 ? index + 1 : slot.key;

        return `
          <button class="palette-btn ${isSelected ? 'active-species' : ''}" data-species="${escapeHtml(slot.species)}">
            <div style="display: flex; align-items: center; gap: var(--space-2);">
              <span class="slot-key">${escapeHtml(slotNum)}</span>
              <span>${escapeHtml(slot.species)}</span>
            </div>
            <span class="badge ${count > 0 ? 'badge-accent' : 'badge-muted'}" style="font-size: 10px; font-family: var(--font-mono);">${count}</span>
          </button>
        `;
      }).join('');
    } else {
      let visibleKeymaps = projectStore.keymaps.filter(k => !k.hidden && k.species.toLowerCase() !== 'empty' && k.keystrokes.toLowerCase() !== 'space');
      if (visibleKeymaps.length === 0) {
        visibleKeymaps = quickStore.hotkeys
          .filter(h => h.species.toLowerCase() !== 'empty' && h.key.toLowerCase() !== 'space')
          .map((h, i) => ({
            keystrokes: h.key,
            species: h.species,
            builtin: true,
            sortOrder: i + 1,
            hidden: false,
            locked: false,
          }));
      }
      keymapButtonsHtml = visibleKeymaps.map((k, index) => {
        const isSelected = currentSpecies === k.species;
        const slotNum = index < 9 ? index + 1 : '';

        return `
          <button class="palette-btn ${isSelected ? 'active-species' : ''}" data-species="${escapeHtml(k.species)}">
            <div style="display: flex; align-items: center; gap: var(--space-2);">
              <span class="slot-key">${escapeHtml(slotNum || k.keystrokes)}</span>
              <span>${escapeHtml(k.species)}</span>
            </div>
            ${slotNum ? `<span style="font-size: 10px; opacity: 0.7; font-family: var(--font-mono); font-weight: 700;">[${escapeHtml(k.keystrokes)}]</span>` : `<span style="font-size: 10px; opacity: 0.5; font-family: var(--font-mono);">${escapeHtml(k.keystrokes)}</span>`}
          </button>
        `;
      }).join('');
    }

    const gridCardsHtml = !isGrid ? '' : shown === 0
      ? `<div class="grid-filter-empty">${escapeHtml(emptyFilterText)}</div>`
      : pageIndices.map(globalIdx => {
      const it = items[globalIdx];
      const isCurrent = globalIdx === idx;
      const isClass = it.isClassified;
      const cachedSrc = this.gridThumbnails.getCached(it.fullPath);
      return `
        <div class="grid-card ${isCurrent ? 'active' : ''} ${isClass ? 'classified' : ''}" data-idx="${globalIdx}" id="gridCard_${globalIdx}">
          <div class="grid-card-thumb-wrap">
            ${isVideoFile(it.fileName)
              ? `<div class="grid-card-video" title="${escapeHtml(it.fileName)}">${icon('video', { size: 30 })}<span>${escapeHtml(it.fileName.slice(it.fileName.lastIndexOf('.') + 1).toUpperCase())}</span></div>`
              : `<img class="grid-card-thumb" src="${escapeHtml(cachedSrc)}" data-path="${escapeHtml(it.fullPath)}" alt="${escapeHtml(it.fileName)}" loading="lazy" decoding="async" />`}
          </div>
          <div class="grid-card-info">
            <span class="grid-card-filename" title="${escapeHtml(it.fileName)}">
              ${escapeHtml(it.fileName)}
            </span>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px;">
              <span class="badge grid-card-species-badge ${isClass ? 'badge-success' : 'badge-muted'}" style="font-size: 10px; padding: 1px 6px;">
                ${escapeHtml(it.species || 'Unclassified')}
              </span>
              ${it.count > 1 ? `
              <span class="badge badge-accent grid-card-count-badge" style="display: inline-flex;">
                ×${it.count}
              </span>` : `
              <span class="badge badge-accent grid-card-count-badge" style="display: none;">
                ×${it.count}
              </span>`}
            </div>
          </div>
        </div>
      `;
    }).join('');

    const dateFormatted = item?.timestamp ? new Date(item.timestamp).toLocaleString() : 'No Date Recorded';

    this.videoControls.release();
    this.innerHTML = html`
      <div style="display: flex; width: 100%; height: 100%; overflow: hidden;">
      
        <!-- Left Main Column (Toolbar + Viewer Stage) -->
        <div style="display: flex; flex-direction: column; flex: 1; min-width: 0; height: 100%; overflow: hidden;">
      
          <!-- Top Toolbar -->
          <div class="classify-toolbar">
            <!-- Left: View Modes & Scale / Zoom, then Folder, Location Changer, Date Changer in that order -->
            <div class="toolbar-left"
              style="display: flex; align-items: center; gap: var(--space-2); min-width: 0; flex: 1; overflow-x: auto; scrollbar-width: none; padding: 4px 2px;">
              <!-- View Modes (Single / Grid) -->
              <div
                style="display: flex; gap: 2px; background: var(--color-bg-base); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 2px; flex-shrink: 0;">
                <button type="button" class="btn-ghost ${!isGrid ? 'btn-secondary' : ''}" id="btnSingleMode"
                  style="padding: 2px 8px; font-size: 11px;" title="Single Photo View (Shortcut: G)">
                  ${icon('photo')} Single
                </button>
                <button type="button" class="btn-ghost ${isGrid ? 'btn-secondary' : ''}" id="btnGridMode"
                  style="padding: 2px 8px; font-size: 11px;" title="Contact Sheet Grid View (Shortcut: G)">
                  ▦ Grid
                </button>
              </div>
      
              <!-- Scale / Zoom Controls (Single Mode) -->
              ${!isGrid ? html`
              <div class="viewer-zoom-bar"
                style="display: flex; align-items: center; gap: 2px; background: var(--color-bg-base); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 2px; flex-shrink: 0;">
                <button type="button" class="btn-ghost" id="btnViewerZoomOut" style="padding: 2px 6px; font-size: 11px;"
                  title="Zoom Out (Mouse Wheel Down)">−</button>
                <span id="viewerZoomPercent"
                  style="font-size: 11px; font-family: var(--font-mono); min-width: 36px; text-align: center; color: var(--color-text-muted);">
                  ${Math.round(this.zoomPan.scale * 100)}%
                </span>
                <button type="button" class="btn-ghost" id="btnViewerZoomIn" style="padding: 2px 6px; font-size: 11px;"
                  title="Zoom In (Mouse Wheel Up)">+</button>
                <button type="button" class="btn-ghost" id="btnViewerZoomFit" style="padding: 2px 6px; font-size: 10px;"
                  title="Fit to Screen">Fit</button>
              </div>
              ` : ''}
      
              <!-- 1. Folder Name (Right of 100% Fit button) -->
              <span
                style="font-weight: 700; font-size: 11px; color: var(--color-text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; background: var(--color-bg-base); border: 1px solid var(--color-border); border-radius: var(--radius-sm); max-width: 170px; flex-shrink: 0;"
                title="${escapeHtml(this.getTitle())}">
                <span style="overflow: hidden; text-overflow: ellipsis;">${escapeHtml(this.getTitle())}</span>
              </span>
      
              <!-- 2. Location Changer -->
              <button type="button" class="btn-ghost" id="btnToolbarEditSite"
                style="display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: var(--radius-sm); border: 1px solid var(--color-border); font-size: 11px; cursor: pointer; background: var(--color-bg-base); max-width: 160px; flex-shrink: 0;"
                title="Click to edit location / site name">
                <span id="activeSiteLabel"
                  style="font-weight: 600; color: var(--color-text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  ${escapeHtml(this.getSiteName()) || 'Set Location'}
                </span>
                <span style="opacity: 0.6; display: flex; color: var(--color-accent);">${icon('pencil', { size: 10 })}</span>
              </button>
      
              <!-- 3. Date Changer -->
              <div
                style="display: inline-flex; align-items: center; gap: 4px; background: var(--color-bg-base); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 2px 6px; font-size: 11px; flex-shrink: 0;">
                <span id="activeDateLabel"
                  style="color: var(--color-text-main); font-weight: 500; display: inline-flex; align-items: center; gap: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px;">
                  ${dateFormatted}
                </span>
                <button type="button" class="btn-ghost" id="btnToolbarEditDate"
                  style="padding: 1px 4px; font-size: 11px; color: var(--color-accent); font-weight: 600; cursor: pointer; flex-shrink: 0;"
                  title="Edit date and time">
                  ${icon('pencil', { size: 11 })}
                </button>
              </div>

              <!-- 4. Animal Count -->
              <div
                style="display: inline-flex; align-items: center; gap: 2px; background: var(--color-bg-base); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 1px 4px;">
                <span
                  style="font-size: 10px; color: var(--color-text-muted); font-weight: 600; margin-right: 2px;">Count:</span>
                <button type="button" class="btn-step" id="btnCountMinus"
                  style="padding: 1px 5px; font-size: 11px; height: 20px; width: 20px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer;"
                  title="Decrease count (−)">−</button>
                <input type="number" id="inputAnimalCount" min="1" max="99" value="${currentCount}"
                  style="width: 28px; height: 20px; text-align: center; font-size: 11px; font-family: var(--font-mono); font-weight: 700; padding: 0; border: none; background: transparent; color: var(--color-text-main);"
                  title="Number in frame (Keys: + / −)" />
                <button type="button" class="btn-step" id="btnCountPlus"
                  style="padding: 1px 5px; font-size: 11px; height: 20px; width: 20px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer;"
                  title="Increase count (+)">+</button>
              </div>
      
            </div>
      
            <!-- Right: Nav & Progress Controls -->
            <div class="toolbar-right" style="flex-shrink: 0;">
              <!-- Navigation & Classification Progress -->
              <div class="nav-progress-control"
                style="display: inline-flex; align-items: center; background: var(--color-bg-base); border: 1px solid var(--color-border); border-radius: var(--radius-sm); overflow: hidden; flex-shrink: 0;">
                <button type="button" class="btn-ghost" id="btnPrevPhoto" ${idx === 0 ? 'disabled' : ''}
                  style="padding: 4px 8px; font-size: 11px; border-radius: 0; border-right: 1px solid var(--color-border);"
                  title="Previous Image (← or ↑)">
                  ◀
                </button>
                <div
                  style="display: flex; align-items: center; gap: 6px; padding: 3px 10px; font-family: var(--font-mono); font-size: 11px; font-weight: 600; white-space: nowrap;">
                  <span id="photoCounterText" style="color: var(--color-text-main);">${idx + 1} / ${total}</span>
                  <span style="color: var(--color-border-strong); font-weight: 400;">•</span>
                  <span id="classifyProgressText" style="color: var(--color-brand); font-weight: 600;">${percent}%</span>
                  <span id="classifiedCountSub"
                    style="color: var(--color-text-muted); font-size: 10px; font-weight: 400;">(${classifiedCount}/${total})</span>
                </div>
                <button type="button" class="btn-ghost" id="btnNextPhoto" ${idx >= total - 1 ? 'disabled' : ''} style="padding:
                  4px 8px; font-size: 11px; border-radius: 0; border-left: 1px solid var(--color-border);" title="Next Image
                  (→ or ↓)">
                  ▶
                </button>
              </div>
            </div>
          </div>
      
          <!-- Main Stage: Viewer + Docked Bottom Bar (Single Mode) OR Grid View -->
          <div class="classifier-stage-wrap"
            style="flex: 1; display: flex; flex-direction: column; min-width: 0; height: 100%; position: relative; overflow: hidden; background: var(--color-stage-bg);">
            <!-- Multi-Key Shortcut Indicator -->
            <div id="keyBufferIndicator" class="key-buffer-indicator" style="display: none;"></div>
            ${!isGrid ? html`
            <div class="viewer-img-container" id="viewerImgContainer"
              style="flex: 1; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; cursor: grab; position: relative;">
              ${viewerMediaHtml(this.currentImageSrc, item?.fileName ?? '')}
      
              <div class="viewer-pan-hint"
                style="position: absolute; bottom: 12px; left: 12px; background: var(--color-overlay-bg); color: var(--color-text-main); border: 1px solid var(--color-border); padding: 4px 8px; border-radius: var(--radius-sm); font-size: 10px; pointer-events: none; opacity: 0.85;">
                Wheel to Zoom • Drag to Pan
              </div>
            </div>
      
            <!-- DOCKED BOTTOM INFO BAR: File Name, Species Tag, Animal Count, Comment -->
            <div class="viewer-bottom-bar"
              style="min-height: 40px; background: var(--color-bg-surface); border-top: 1px solid var(--color-border); display: flex; align-items: center; justify-content: space-between; padding: 0 var(--space-4); gap: var(--space-4); flex-shrink: 0; z-index: 10;">
              <!-- Left: File name -->
              <div style="display: flex; align-items: center; gap: var(--space-2); min-width: 0; max-width: 45%;">
                <span style="color: var(--color-text-muted); display: flex;">${icon('photo', { size: 14 })}</span>
                <span id="activeFileName"
                  style="font-family: var(--font-mono); font-size: 11px; font-weight: 600; color: var(--color-text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                  title="${escapeHtml(item?.fileName)}">
                  ${escapeHtml(item?.fileName)}
                </span>
              </div>
      
              <!-- Right: Species Tag, Animal Count, Comment -->
              <div style="display: flex; align-items: center; gap: var(--space-3); flex-shrink: 0;">
                <!-- Species Badge -->
                <span id="activeSpeciesBadge" class="badge ${currentSpecies ? 'badge-success' : 'badge-muted'}"
                  style="font-size: 11px; padding: 2px 8px; font-weight: 600;">
                  ${escapeHtml(currentSpecies || 'Unclassified')}
                </span>
      
                <!-- Active Count Badge -->
                ${currentCount > 1 ? html`
                <span id="activeCountBadge" class="badge badge-accent" style="display: inline-flex;">
                  ${icon('paw')} ×${currentCount}
                </span>
                ` : html`
                <span id="activeCountBadge" class="badge badge-accent" style="display: none;">
                  ${icon('paw')} ×${currentCount}
                </span>
                `}
      
                <!-- Active Comment Badge -->
                ${currentComment ? html`
                <span id="toolbarCommentBadge" class="badge badge-muted"
                  style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; max-width: 180px; cursor: pointer;"
                  title="Click to edit comment in sidebar">
                  <span style="display: flex;">${icon('message', { size: 12 })}</span>
                  <span id="activeCommentLabel"
                    style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(currentComment)}</span>
                </span>
                ` : html`
                <span id="toolbarCommentBadge" class="badge badge-muted"
                  style="display: none; align-items: center; gap: 4px; font-size: 11px; max-width: 180px; cursor: pointer;"
                  title="Click to edit comment in sidebar">
                  <span style="display: flex;">${icon('message', { size: 12 })}</span>
                  <span id="activeCommentLabel"
                    style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"></span>
                </span>
                `}
              </div>
            </div>
            ` : html`
            <!-- Grid Pagination Header -->
            <div class="grid-page-header">
              <div
                style="display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-xs); color: var(--color-text-muted);">
                ${shown === 0 ? html`
                <span>No photos match this filter</span>
                ` : html`
                <span>Showing photos <strong>${pageStart + 1}–${pageEnd}</strong> of <strong>${shown}</strong></span>
                `}
                ${filtered ? html`
                <span style="opacity: 0.4;">•</span>
                <span>filtered from ${total}</span>
                ` : ''}
                <span style="opacity: 0.4;">•</span>
                <span>Double-click photo for Single View</span>
              </div>
              <div style="display: flex; align-items: center; gap: var(--space-2);">
                <!-- Filters: unclassified only, or one species (picking one turns the other off) -->
                <button type="button" class="grid-filter-toggle ${this.gridFilter.unclassifiedOnly ? 'on' : ''}"
                  id="btnGridUnclassifiedOnly" role="switch" aria-checked="${this.gridFilter.unclassifiedOnly}"
                  title="Show only photos that are not tagged yet">
                  <span class="grid-filter-switch" aria-hidden="true"></span>
                  Unclassified
                </button>
                <div class="grid-species-filter ${this.gridFilter.species !== null ? 'active' : ''}" id="gridSpeciesFilter">
                  <div class="combobox-input-group">
                    <input type="text" id="inputGridSpeciesFilter" class="combobox-input" placeholder="All species"
                      value="${escapeHtml(this.gridFilter.species ?? '')}" autocomplete="off" spellcheck="false"
                      aria-label="Filter by species" title="Show only one species (type to search)" />
                    ${this.gridFilter.species !== null ? html`
                    <button type="button" class="btn-ghost" id="btnClearGridSpecies" title="Show all species">${icon('close')}</button>
                    ` : ''}
                    <button type="button" class="btn-ghost" id="btnToggleGridSpecies" tabindex="-1"
                      style="padding: 2px 6px; font-size: 10px;" title="Show species">▼</button>
                  </div>
                  <div id="gridSpeciesMenu" class="comment-menu-dropdown grid-species-menu" role="listbox" style="display: none;"></div>
                </div>
                <span class="grid-filter-divider" aria-hidden="true"></span>
                <button type="button" class="btn-ghost" id="btnGridPrevPage" ${this.gridPage === 0 ? 'disabled' : ''}
                  style="padding: 2px 8px; font-size: 11px;">
                  ◀ Prev Page
                </button>
                <span
                  style="font-size: 11px; font-family: var(--font-mono); font-weight: 600; color: var(--color-text-main); min-width: 70px; text-align: center;">
                  ${this.gridPage + 1} / ${totalPages}
                </span>
                <button type="button" class="btn-ghost" id="btnGridNextPage" ${this.gridPage >= totalPages - 1 ? 'disabled' :
          ''} style="padding: 2px 8px; font-size: 11px;">
                  Next Page ▶
                </button>
              </div>
            </div>
      
            <!-- Paginated Grid Cards (Ultra-low RAM) -->
            <div class="grid-container" id="gridCardsContainer">
              ${gridCardsHtml}
            </div>
            `}
          </div>
      
        </div>
      
        <!-- Right Column: ALL THE WAY TO THE TOP OF THE TITLE BAR -->
        <div class="sidebar-resize-handle" id="sidebarResizeHandle" role="separator" aria-orientation="vertical" aria-label="Resize the right panel" tabindex="0" title="Drag the grip to resize the right panel (double-click to reset)"></div>
        <div
          id="classifierSidebar"
          style="width: ${this.sidebarResizer.currentWidth}px; background-color: var(--color-bg-surface); border-left: 1px solid var(--color-border); display: flex; flex-direction: column; padding: var(--space-4); gap: var(--space-4); overflow-y: auto; flex-shrink: 0; height: 100%;">
      
          <!-- Quick Mode Actions (At Top of Right Sidebar: Export & Close matching UI) -->
          ${this.mode === 'quick' ? html`
          <div
            style="display: flex; gap: var(--space-2); align-items: center; width: 100%; padding-bottom: var(--space-3); border-bottom: 1px solid var(--color-border);">
            <button class="btn-primary" id="btnOpenExportModal"
              style="flex: 1; font-size: var(--text-xs); padding: 7px 12px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; font-weight: 600;">
              ${icon('table-export', { size: 14 })} Export
            </button>
            <button type="button" id="btnCloseSession"
              style="flex: 1; font-size: var(--text-xs); padding: 7px 12px; background: #dc2626; color: #ffffff; border: 1px solid #dc2626; border-radius: var(--radius-sm); font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; transition: opacity 0.15s ease;"
              title="Close session">
              ${icon('close', { size: 14 })} Close
            </button>
          </div>
          <ai-panel mode="quick"></ai-panel>
          ` : '<ai-panel mode="project"></ai-panel>'}
      
          <!-- Comment Combobox Section (Top of Sidebar) -->
          <div class="sidebar-comment-section"
            style="padding-bottom: var(--space-3); border-bottom: 1px solid var(--color-border); position: relative;">
            <!-- Saved / Cleared message: sits in the padding below the box, so it takes no space above it -->
            <span id="commentStatusHint"
              style="position: absolute; right: 0; bottom: 1px; line-height: 1; font-size: 10px; color: var(--color-brand); font-weight: 600;"></span>
      
            <div class="comment-combobox-wrap" id="commentComboboxWrap">
              <div class="combobox-input-group">
                <input type="text" id="inputSidebarComment" class="combobox-input" placeholder="Type note or pick preset..." aria-label="Comment (shortcut C)"
                  value="${escapeHtml(currentComment)}" autocomplete="off" />
                ${currentComment ? html`
                <button type="button" class="btn-ghost" id="btnClearComment" title="Clear comment">${icon('close')}</button>
                ` : html`
                <button type="button" class="btn-ghost" id="btnClearComment" style="display: none;"
                  title="Clear comment">${icon('close')}</button>
                `}
                <button type="button" class="btn-ghost" id="btnToggleCommentDropdown"
                  style="padding: 2px 6px; font-size: 10px;" title="Show preset comments">▼</button>
              </div>
      
              <!-- Dropdown List of Presets -->
              <div id="commentMenuDropdown" class="comment-menu-dropdown" style="display: none;">
                <!-- Populated dynamically -->
              </div>
            </div>
          </div>
      
          <!-- Auto-Advance Toggle + delay slider -->
          <div
            style="display: flex; align-items: center; gap: var(--space-3); padding-bottom: var(--space-3); border-bottom: 1px solid var(--color-border);"
            title="Auto-advance moves to the next image on tag. The slider sets how long to wait first, so you can add more hotkeys, a count or a comment.">
            <label style="display: flex; align-items: center; gap: var(--space-2); cursor: pointer; user-select: none; flex-shrink: 0;">
              <input type="checkbox" id="chkAutoAdvance" ${this.getAutoAdvance() ? 'checked' : ''} />
              <span
                style="font-size: var(--text-xs); font-weight: 600; color: var(--color-text-main); display: inline-flex; align-items: center; gap: var(--space-1); white-space: nowrap;">
                ${icon('bolt')} Auto-Advance
              </span>
            </label>
            <div id="advanceDelayRow" style="display: flex; align-items: center; gap: var(--space-2); flex: 1; min-width: 0; ${this.getAutoAdvance() ? '' : 'opacity: 0.5;'}">
              <input type="range" id="rngAdvanceDelay" class="advance-delay-slider" min="0" max="${MAX_ADVANCE_DELAY_MS}" step="100"
                value="${getAdvanceDelay()}" ${this.getAutoAdvance() ? '' : 'disabled'}
                style="flex: 1; min-width: 0; --pct: ${this.advanceDelayPercent(getAdvanceDelay())}%;" />
              <span id="lblAdvanceDelay"
                style="font-size: 10px; color: var(--color-text-muted); min-width: 40px; text-align: right;">${this.formatAdvanceDelay(getAdvanceDelay())}</span>
            </div>
          </div>
      
          <!-- Quick Keys Palette -->
          <div class="palette-keys-list" id="paletteKeysList" role="group" aria-label="Quick keys">
            ${keymapButtonsHtml}
      
            <!-- Space for Empty (Single button on both workspaces, no dotted line) -->
            <button class="palette-btn ${currentSpecies === 'Empty' ? 'active-species' : ''}" data-species="Empty">
              <div style="display: flex; align-items: center; gap: var(--space-2);">
                <span class="slot-key">Space</span>
                <span>Empty</span>
              </div>
              ${this.mode === 'quick' ? html`
              <span class="badge ${(speciesCounts['Empty'] || 0) > 0 ? 'badge-accent' : 'badge-muted'}"
                style="font-size: 10px; font-family: var(--font-mono);">${speciesCounts['Empty'] || 0}</span>
              ` : html`
              <span style="font-size: 10px; opacity: 0.7; font-family: var(--font-mono); font-weight: 700;">#0 [0]</span>
              `}
            </button>
          </div>
      
          <!-- Type Species Box (Underneath Quick Keys) -->
          <div class="type-species-box"
            style="display: flex; flex-direction: column; gap: var(--space-2); margin-top: 0; padding-top: var(--space-3); border-top: 1px solid var(--color-border);">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <label style="font-size: var(--text-xs); font-weight: 700; color: var(--color-text-main);">
                Type species
              </label>
              <span style="font-size: 10px; color: var(--color-text-muted);">Press Enter or Tag</span>
            </div>
            <div style="display: flex; gap: var(--space-2);">
              <input type="text" id="inputCustomSpecies" placeholder="Search or type species..."
                style="flex: 1; font-size: var(--text-xs);" autocomplete="off" />
              <button class="btn-primary" id="btnApplyCustomSpecies"
                style="padding: var(--space-1) var(--space-3); font-size: var(--text-xs); white-space: nowrap;">
                Tag
              </button>
            </div>
          </div>
      
        </div>
      
        <!-- Date & Site Editor Modals -->
        <date-editor-modal></date-editor-modal>
        <site-editor-modal id="classifierSiteModal"></site-editor-modal>
      </div>
    `;

    this.isStructureBuilt = true;

    // ============================================================
    // Event Listeners Binding
    // ============================================================
    this.querySelector('#btnSingleMode')?.addEventListener('click', () => {
      this.setViewMode('single');
    });

    this.querySelector('#btnGridMode')?.addEventListener('click', () => {
      this.setViewMode('grid');
    });

    this.querySelector('#btnPrevPhoto')?.addEventListener('click', () => this.prevPhoto());
    this.querySelector('#btnNextPhoto')?.addEventListener('click', () => this.nextPhoto());

    // Zoom Buttons
    this.querySelector('#btnViewerZoomOut')?.addEventListener('click', () => this.zoomPan.zoomBy(1 / 1.25));
    this.querySelector('#btnViewerZoomIn')?.addEventListener('click', () => this.zoomPan.zoomBy(1.25));
    this.querySelector('#btnViewerZoomFit')?.addEventListener('click', () => this.zoomPan.reset());

    // Mouse Wheel Zoom on Viewer Container
    const viewerContainer = this.querySelector<HTMLElement>('#viewerImgContainer');
    viewerContainer?.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1.15 : 0.87;
      this.zoomPan.zoomBy(delta);
    }, { passive: false });

    // Mouse Pan Dragging
    viewerContainer?.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('.viewer-pan-hint, .video-bar, button, input')) return;

      this.zoomPan.beginDrag(e);
      viewerContainer.classList.add('panning');
    });

    // Toolbar comment badge click focuses sidebar comment input
    this.querySelector('#toolbarCommentBadge')?.addEventListener('click', () => {
      this.commentDropdown.open();
    });

    // Comment Combobox in Sidebar Listeners
    const commentInput = this.querySelector<HTMLInputElement>('#inputSidebarComment');
    commentInput?.addEventListener('focus', () => {
      this.commentDropdown.open();
    });

    commentInput?.addEventListener('input', () => {
      const val = commentInput.value;
      const clearBtn = this.querySelector<HTMLElement>('#btnClearComment');
      if (clearBtn) {
        clearBtn.style.display = val.trim() ? 'block' : 'none';
      }
      this.commentDropdown.renderOptions(val);
    });

    this.querySelector('#btnToggleCommentDropdown')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.commentDropdown.toggle();
    });

    this.querySelector('#btnClearComment')?.addEventListener('click', () => {
      this.saveCurrentComment('');
    });

    // Auto-advance toggle
    this.querySelector('#chkAutoAdvance')?.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      this.setAutoAdvance(checked);
      this.syncAdvanceDelayControl();
    });

    // The toolbar's scrollbars are hidden or tiny, so let it be dragged sideways when buttons are cut off.
    // Inner scroller first: it claims the drag so the outer one does not also scroll.
    this.toolbarScrollCleanups.forEach(fn => fn());
    this.toolbarScrollCleanups = [];
    const toolbarLeft = this.querySelector<HTMLElement>('.toolbar-left');
    const toolbar = this.querySelector<HTMLElement>('.classify-toolbar');
    if (toolbarLeft) this.toolbarScrollCleanups.push(enableDragScroll(toolbarLeft));
    if (toolbar) this.toolbarScrollCleanups.push(enableDragScroll(toolbar));

    this.videoControls.bind();

    // Sidebar resize handle
    const resizeHandle = this.querySelector('#sidebarResizeHandle');
    resizeHandle?.addEventListener('mousedown', (e) => this.sidebarResizer.beginDrag(e as MouseEvent));
    resizeHandle?.addEventListener('dblclick', () => this.sidebarResizer.reset());
    resizeHandle?.addEventListener('keydown', (e) => this.sidebarResizer.handleKey(e as KeyboardEvent));
    this.sidebarResizer.sizeGrip();

    // Auto-advance delay slider: update live while dragging, persist on release
    const delaySlider = this.querySelector<HTMLInputElement>('#rngAdvanceDelay');
    delaySlider?.addEventListener('input', () => {
      setAdvanceDelay(Number(delaySlider.value), false);
      this.syncAdvanceDelayControl();
    });
    delaySlider?.addEventListener('change', () => {
      setAdvanceDelay(Number(delaySlider.value));
      // Release focus so hotkeys work again instead of being captured by the slider.
      delaySlider.blur();
    });

    // Animal count controls
    this.querySelector('#btnCountMinus')?.addEventListener('click', () => {
      this.stepAnimalCount(-1);
    });

    this.querySelector('#btnCountPlus')?.addEventListener('click', () => {
      this.stepAnimalCount(1);
    });

    const animalCountInput = this.querySelector<HTMLInputElement>('#inputAnimalCount');
    animalCountInput?.addEventListener('change', () => {
      const val = Math.max(1, parseInt(animalCountInput.value, 10) || 1);
      this.updateCurrentAnimalCount(val);
    });

    // Species buttons click
    this.querySelectorAll('.palette-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const species = btn.getAttribute('data-species');
        if (species) {
          this.classifyCurrent(species);
        }
      });
    });

    // Custom species apply (Tag)
    const applyCustom = () => {
      const input = this.querySelector<HTMLInputElement>('#inputCustomSpecies');
      const species = input?.value.trim();
      if (species) {
        this.classifyCurrent(species, undefined, undefined, false);
        if (input) input.value = '';
      }
    };

    this.querySelector('#btnApplyCustomSpecies')?.addEventListener('click', applyCustom);
    this.querySelector<HTMLInputElement>('#inputCustomSpecies')?.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyCustom();
        // Release focus so hotkeys work again without pressing Esc.
        (e.target as HTMLElement).blur();
      }
    });

    // Grid card click
    this.querySelectorAll('.grid-card').forEach(card => {
      card.addEventListener('click', () => {
        const i = Number(card.getAttribute('data-idx'));
        this.goToPhoto(i);
      });
      card.addEventListener('dblclick', () => {
        this.setViewMode('single');
      });
    });

    // Grid pagination buttons
    this.querySelector('#btnGridPrevPage')?.addEventListener('click', () => {
      if (this.gridPage > 0) {
        this.gridPage--;
        this.isStructureBuilt = false;
        this.render();
      }
    });

    this.querySelector('#btnGridNextPage')?.addEventListener('click', () => {
      if (this.gridPage < totalPages - 1) {
        this.gridPage++;
        this.isStructureBuilt = false;
        this.render();
      }
    });

    this.bindGridFilterControls();

    // Date Editor Button (Both Quick and Project modes)
    this.querySelector('#btnToolbarEditDate')?.addEventListener('click', () => {
      const active = this.getActiveItem();
      if (active) {
        const modal = this.querySelector<DateEditorModal>('date-editor-modal');
        modal?.open(active, this.mode);
      }
    });

    // Site / Location Editor Button (Both Quick and Project modes)
    this.querySelector('#btnToolbarEditSite')?.addEventListener('click', () => {
      const modal = this.querySelector<SiteEditorModal>('#classifierSiteModal');
      if (this.mode === 'quick') {
        const title = quickStore.folderName || 'Quick Session';
        modal?.open(title, this.getSiteName(), 'quick');
      } else {
        const activeBatchName = projectStore.activeBatchName;
        if (activeBatchName) {
          modal?.open(activeBatchName, this.getSiteName(), 'project');
        }
      }
    });

    // Quick Mode Toolbar Buttons
    if (this.mode === 'quick') {
      this.querySelector('#btnOpenExportModal')?.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('open-export-modal', { bubbles: true, composed: true }));
      });

      this.querySelector('#btnCloseSession')?.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('close-session', { bubbles: true, composed: true }));
      });
    }

    if (isGrid) {
      this.gridThumbnails.observe(this);
    }
  }
}

customElements.define('classifier-view', ClassifierView);

declare global {
  interface HTMLElementTagNameMap {
    'classifier-view': ClassifierView;
  }
}
