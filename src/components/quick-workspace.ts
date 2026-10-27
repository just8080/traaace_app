import { quickStore } from '../store/quick-store';
import { projectStore } from '../store/project-store';
import { selectFolderDialog, askConfirm, listenFileDrop } from '../services/tauri-bridge';
import { icon } from '../services/icons';
import { html, escapeHtml } from '../utils';
import { showToast } from '../services/ui-scale';
import './classifier-view';
import './date-editor-modal';
import './export-modal';
import type { DateEditorModal } from './date-editor-modal';
import type { ExportModal } from './export-modal';

export class QuickWorkspace extends HTMLElement {
  private unsubscribe: (() => void) | null = null;
  private keydownListener: ((e: KeyboardEvent) => void) | null = null;
  private unlistenFileDrop: (() => void) | null = null;
  private currentMode: 'loading' | 'ingest' | 'classify' | null = null;

  connectedCallback(): void {
    this.unsubscribe = quickStore.subscribe(() => this.render());
    this.setupGlobalShortcuts();
    this.setupModalEventListeners();
    this.setupNativeDragDrop();
    this.render();
  }

  disconnectedCallback(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.keydownListener) {
      window.removeEventListener('keydown', this.keydownListener);
      this.keydownListener = null;
    }
    if (this.unlistenFileDrop) {
      this.unlistenFileDrop();
      this.unlistenFileDrop = null;
    }
  }

  private async setupNativeDragDrop(): Promise<void> {
    if (this.unlistenFileDrop) {
      this.unlistenFileDrop();
      this.unlistenFileDrop = null;
    }

    this.unlistenFileDrop = await listenFileDrop((payload) => {
      // Only handle drag/drop if on the ingest screen
      if (quickStore.isSessionStarted) return;

      const card = this.querySelector('#dropzoneCard');
      if (payload.type === 'enter' || payload.type === 'over') {
        card?.classList.add('drag-over');
      } else if (payload.type === 'leave') {
        card?.classList.remove('drag-over');
      } else if (payload.type === 'drop') {
        card?.classList.remove('drag-over');
        if (payload.paths && payload.paths.length > 0) {
          const path = payload.paths[0];
          if (path) {
            quickStore.loadFolder(path);
          }
        }
      }
    });
  }

  private setupGlobalShortcuts(): void {
    this.keydownListener = (e: KeyboardEvent) => {
      // Export trigger: Cmd/Ctrl + E
      if (e.key.toLowerCase() === 'e' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const exportModal = this.querySelector<ExportModal>('export-modal');
        exportModal?.open();
      }
    };

    window.addEventListener('keydown', this.keydownListener);
  }

  private setupModalEventListeners(): void {
    this.addEventListener('open-export-modal', () => {
      const exportModal = this.querySelector<ExportModal>('export-modal');
      exportModal?.open();
    });

    this.addEventListener('open-date-editor', (e: any) => {
      const dateModal = this.querySelector<DateEditorModal>('date-editor-modal');
      const item = e.detail?.item || quickStore.activeItem;
      if (item) {
        dateModal?.open(item);
      }
    });

    this.addEventListener('close-session', () => {
      this.handleCloseSession();
    });
  }

  private async handleCloseSession(): Promise<void> {
    const total = quickStore.items.length;
    const classified = quickStore.classifiedCount;

    let message = 'Are you sure you want to close this session? Any unexported work will be lost.';
    if (classified > 0) {
      message = `You have classified ${classified} of ${total} images in this session.\n\nClosing will discard any unexported classifications. Are you sure you want to close?`;
    } else if (total > 0) {
      message = `Close current session with ${total} photos loaded? Any progress will be lost.`;
    }

    const confirmed = await askConfirm(message, {
      title: 'Close Quick Classify Session',
      kind: 'warning',
    });

    if (confirmed) {
      quickStore.clearSession();
      showToast('Session closed');
      // Closing a session returns to the welcome screen so the workspace can be chosen again.
      this.dispatchEvent(new CustomEvent('session-closed', { bubbles: true, composed: true }));
    }
  }

  private render(): void {
    if (quickStore.isLoading) {
      if (this.currentMode !== 'loading') {
        this.currentMode = 'loading';
        this.innerHTML = html`
          <div
            style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-3);">
            <div style="color: var(--color-brand);">${icon('bolt', { size: 40 })}</div>
            <div style="font-size: var(--text-lg); font-weight: 600;">${escapeHtml(quickStore.statusMessage)}</div>
          </div>
        `;
      }
      return;
    }

    if (!quickStore.folderPath || !quickStore.isSessionStarted) {
      this.currentMode = 'ingest';
      this.renderIngestScreen();
      return;
    }

    if (this.currentMode !== 'classify') {
      this.currentMode = 'classify';
      this.renderClassifyScreen();
    } else {
      this.updateCompletionPrompt();
    }
  }

  private renderIngestScreen(): void {
    const hotkeys = quickStore.hotkeys;
    const comments = quickStore.presetComments;
    const hasFolder = Boolean(quickStore.folderPath);
    const folderName = quickStore.folderName || 'Selected Folder';
    const folderPath = quickStore.folderPath || '';
    const itemCount = quickStore.items.length;

    // Collect distinct existing sites across project batches for quick reuse
    const existingSites = Array.from(
      new Set(
        projectStore.batches
          .map(b => (b.site || '').trim())
          .filter(s => s.length > 0 && s !== quickStore.siteName)
      )
    ).slice(0, 6);

    this.innerHTML = html`
      <div class="ingest-screen">
        <div class="ingest-container">
      
          <!-- PAGE HEADING & TOP ACTION ROW -->
          <div
            style="display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-1); flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: var(--space-3); min-width: 0;">
              <div
                style="width: 38px; height: 38px; border-radius: var(--radius-lg); background: rgba(245, 158, 11, 0.12); color: #f59e0b; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                ${icon('bolt', { size: 22 })}
              </div>
              <div style="min-width: 0;">
                <div style="display: flex; align-items: center; gap: var(--space-2);">
                  <h1 style="font-size: var(--text-lg); font-weight: 700; color: var(--color-text-main); margin: 0;">Quick
                    Classify</h1>
                </div>
                <p style="color: var(--color-text-muted); font-size: var(--text-xs); margin: 2px 0 0; line-height: 1.4;">
                  Drag & drop folder or select folder below and start classifying.
                </p>
              </div>
            </div>
      
            <!-- Start Quick Classify Button: Smaller and positioned above file select box -->
            <button type="button" class="btn-primary" id="btnStartClassifyTop" ${hasFolder && itemCount === 0
        ? 'disabled style="padding: 7px 16px; font-size: var(--text-xs); font-weight: 600; display: inline-flex; align-items: center; gap: 6px; border-radius: var(--radius-sm); opacity: 0.5; cursor: not-allowed; white-space: nowrap; flex-shrink: 0;"'
        : 'style="padding: 7px 16px; font-size: var(--text-xs); font-weight: 600; display: inline-flex; align-items: center; gap: 6px; border-radius: var(--radius-sm); white-space: nowrap; flex-shrink: 0; box-shadow: var(--shadow-sm); cursor: pointer;"'
      }>
              ${icon('bolt', { size: 14 })} Start Quick Classify &rarr;
            </button>
          </div>
      
          <!-- SOURCE FOLDER PANEL: Matches other panels, integrates file name & file location -->
          ${!hasFolder ? html`
          <div class="quick-dropzone-banner" id="dropzoneCard"
            style="background: var(--color-bg-surface); border: 1px solid var(--color-border-strong); border-radius: var(--radius-lg); padding: var(--space-4) var(--space-5); display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); box-shadow: var(--shadow-sm); cursor: pointer;">
            <div style="display: flex; align-items: center; gap: var(--space-3); min-width: 0;">
              <div>
                <div style="font-size: var(--text-sm); font-weight: 600; color: var(--color-text-main);">Drag & drop folder or
                  SD card here, or click to browse</div>
                <div style="font-size: 11px; color: var(--color-text-muted); margin-top: 2px;">Supports JPG, PNG, and video
                  trail camera footage</div>
              </div>
            </div>
            <button type="button" class="btn-secondary" id="btnSelectFolder"
              style="padding: var(--space-2) var(--space-4); font-size: var(--text-xs); white-space: nowrap; flex-shrink: 0;">
              ${icon('folder-open', { size: 14 })} Select Folder...
            </button>
          </div>
          ` : html`
          <div
            style="background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-4) var(--space-5); display: flex; flex-direction: column; gap: var(--space-3); box-shadow: var(--shadow-sm);">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong
                style="font-size: var(--text-sm); display: inline-flex; align-items: center; gap: var(--space-2); color: var(--color-text-main);">
                Source Folder & Media
              </strong>
              <div style="display: flex; align-items: center; gap: var(--space-2);">
                ${itemCount > 0 ? html`
                <span class="badge badge-success" style="font-size: 11px; font-weight: 600;">
                  ${itemCount} Photos Ready
                </span>
                ` : html`
                <span class="badge badge-danger" style="font-size: 11px; font-weight: 600;">
                  0 Photos Found
                </span>
                `}
                <button type="button" class="btn-secondary" id="btnChangeFolder"
                  style="padding: 2px 10px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;">
                  ${icon('folder-open', { size: 12 })} Change Folder...
                </button>
              </div>
            </div>
      
            <div
              style="display: flex; align-items: center; gap: var(--space-3); background: var(--color-bg-base); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3); min-width: 0;">
              <div style="display: flex; align-items: center; gap: var(--space-2); flex-shrink: 0;">
                <span style="font-size: 11px; color: var(--color-text-muted); font-weight: 600;">Folder:</span>
                <span
                  style="font-family: var(--font-mono); font-weight: 700; font-size: var(--text-xs); color: var(--color-text-main);">
                  ${escapeHtml(folderName)}
                </span>
              </div>
              <span style="color: var(--color-border); font-size: var(--text-xs);">|</span>
              <div style="display: flex; align-items: center; gap: var(--space-2); min-width: 0; flex: 1;">
                <span style="font-size: 11px; color: var(--color-text-muted); font-weight: 600; flex-shrink: 0;">Path:</span>
                <span
                  style="font-family: var(--font-mono); font-size: 11px; color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;"
                  title="${escapeHtml(folderPath)}">
                  ${escapeHtml(folderPath)}
                </span>
              </div>
            </div>
      
            ${itemCount === 0 ? html`
            <div
              style="display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3); background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: var(--radius-sm); font-size: 11px; color: var(--color-danger);">
              <span>${icon('alert-triangle', { size: 14 })}</span>
              <span>No camera trap images or videos (JPG, PNG, MP4, etc.) found in "${escapeHtml(folderName)}". Click "Change Folder..."
                to select a folder containing camera trap footage.</span>
            </div>
            ` : ''}
          </div>
          `}
      
          <!-- LOCATION PANEL: Same shape and size as the file box above, quick picks on the right -->
          <div
            style="background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-4) var(--space-5); display: flex; flex-direction: column; gap: var(--space-3); box-shadow: var(--shadow-sm);">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: var(--space-2);">
              <strong
                style="font-size: var(--text-sm); display: inline-flex; align-items: center; gap: var(--space-2); color: var(--color-text-main);">
                Location / Site Name
              </strong>
              <span style="font-size: 11px; color: var(--color-text-muted);">Deployment site or camera station &bull; Defaults
                to folder name if blank</span>
            </div>
      
            <div
              style="display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap;">
              <input type="text" id="inputQuickSiteName" value="${escapeHtml(quickStore.siteName)}"
                placeholder="e.g. site_EFH, Bush Ridge, Station 04"
                style="flex: 1; min-width: 260px; max-width: 380px; font-size: var(--text-sm); font-weight: 600; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm);" />
      
              <div
                style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; flex: 1; min-width: 0;">
                ${existingSites.length > 0 ? html`
                <span style="font-size: 11px; color: var(--color-text-muted); font-weight: 500; margin-right: 2px;">Quick
                  Pick:</span>
                ${existingSites.map(s => html`
                <button type="button" class="btn-secondary btn-quick-pick-site" data-site="${escapeHtml(s)}"
                  style="padding: 2px 8px; font-size: 11px; border-radius: var(--radius-xs); white-space: nowrap;">
                  ${escapeHtml(s)}
                </button>
                `).join('')}
                ` : html`
                <span style="font-size: 11px; color: var(--color-text-muted);">Used for EXIF metadata & CSV export
                  tagging</span>
                `}
              </div>
            </div>
          </div>
      
          <!-- BOTTOM SECTION: Two Balanced Cards Side-by-Side -->
          <div class="quick-setup-two-col"
            style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-5); align-items: stretch;">
      
            <!-- LEFT CARD: Preset Comments (Quick Notes) -->
            <div
              style="background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-4); box-shadow: var(--shadow-sm);">
      
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <strong
                    style="font-size: var(--text-sm); display: inline-flex; align-items: center; gap: var(--space-2); color: var(--color-text-main);">
                    Preset Comments
                  </strong>
                  <p style="color: var(--color-text-muted); font-size: var(--text-xs); margin: 2px 0 0;">
                    Quick notes during tagging
                  </p>
                </div>
                <div style="display: flex; gap: var(--space-2); align-items: center;">
                  <button type="button" class="btn-ghost" id="btnResetDefaultComments"
                    style="font-size: 11px; padding: 2px 6px;" title="Restore default comments">
                    ${icon('refresh')} Reset
                  </button>
                  <button type="button" class="btn-secondary" id="btnAddComment"
                    style="font-size: 11px; padding: 2px 8px; font-weight: 600;">
                    + Add Note
                  </button>
                </div>
              </div>
      
              <div class="comments-grid-two-col"
                style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); padding: 2px;">
                ${comments.map((comment, index) => html`
                <div class="comment-row-item" data-index="${index}"
                  style="display: flex; align-items: center; gap: 4px; background: var(--color-bg-base); padding: 4px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-sm);">
                  <input type="text" class="comment-text-input" value="${escapeHtml(comment)}" data-index="${index}"
                    placeholder="Comment note..."
                    style="font-size: var(--text-xs); border: none; background: transparent; padding: 2px 4px; width: 100%;" />
                  <button type="button" class="btn-remove-comment" data-index="${index}" title="Remove comment"
                    style="background: none; border: none; cursor: pointer; color: var(--color-text-muted); padding: 2px; display: flex;">
                    ${icon('close', { size: 14 })}
                  </button>
                </div>
                `).join('')}
              </div>
      
              <div
                style="margin-top: auto; padding: var(--space-2) var(--space-3); background: var(--color-bg-base); border-radius: var(--radius-sm); border: 1px solid var(--color-border); font-size: 11px; color: var(--color-text-muted); display: flex; align-items: center; gap: var(--space-2);">
                <span>Hotkey <kbd class="kbd-badge">C</kbd> jumps directly into comments &bull; Use <kbd
                    class="kbd-badge">&darr;</kbd> <kbd class="kbd-badge">&uarr;</kbd> to navigate notes.</span>
              </div>
      
            </div>
      
            <!-- RIGHT CARD: Configure Hotkeys for This Session -->
            <div
              style="background: var(--color-bg-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-4); box-shadow: var(--shadow-sm);">
      
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <strong
                    style="font-size: var(--text-sm); display: inline-flex; align-items: center; gap: var(--space-2); color: var(--color-text-main);">
                    Configure Hotkeys
                  </strong>
                  <p style="color: var(--color-text-muted); font-size: var(--text-xs); margin: 2px 0 0;">
                    Assign species to your number keys
                  </p>
                </div>
                <button type="button" class="btn-ghost" id="btnResetDefaultHotkeys"
                  style="font-size: 11px; padding: 2px 6px;">
                  ${icon('refresh')} Reset Defaults
                </button>
              </div>
      
              <!-- Hotkey 2-Column Grid -->
              <div class="hotkey-grid-two-col"
                style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2);">
                ${hotkeys.map((slot, index) => {
                    const isSpace = slot.key === 'Space';
                    return html`
                <div class="hotkey-row-item" data-index="${index}"
                  style="display: flex; align-items: center; gap: var(--space-2); background: var(--color-bg-base); padding: 4px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-sm);">
                  <span class="slot-badge ${isSpace ? 'slot-badge-space' : ''}">${slot.key}</span>
                  <input type="text" class="hotkey-species-input" value="${escapeHtml(slot.species)}" data-index="${index}"
                    placeholder="Species name"
                    style="font-size: var(--text-xs); border: none; background: transparent; padding: 4px 6px; width: 100%; min-width: 0; font-weight: 500; color: var(--color-text-main);" />
                </div>
                `;
                  }).join('')}
              </div>
      
              <div
                style="margin-top: auto; padding: var(--space-2) var(--space-3); background: var(--color-bg-base); border-radius: var(--radius-sm); border: 1px solid var(--color-border); font-size: 11px; color: var(--color-text-muted); display: flex; align-items: center; gap: var(--space-2);">
                <span>Space key is preset to <strong>Empty</strong>. Number keys 1–9 instantly tag and advance.</span>
              </div>
      
            </div>
      
          </div>
      
          <!-- BOTTOM STATUS BAR -->
          <div
            style="display: flex; align-items: center; padding: var(--space-3) 0 var(--space-1); border-top: 1px solid var(--color-border); margin-top: var(--space-1);">
            <div
              style="font-size: var(--text-xs); color: var(--color-text-muted); display: flex; align-items: center; gap: var(--space-2);">
              <span
                style="color: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx; display: flex;">${icon('check',
        { size: 16 })}</span>
              <span>${hasFolder ? (itemCount > 0 ? `Folder ready: ${itemCount} photos loaded` : `No photos found in
                "${escapeHtml(folderName)}"`) : 'Select or drop a folder to begin classifying'}</span>
            </div>
          </div>
      
        </div>
      </div>
    `;

    // Dropzone & select handlers
    const card = this.querySelector('#dropzoneCard');

    card?.addEventListener('click', async (e) => {
      if ((e.target as HTMLElement).closest('#btnSelectFolder')) {
        return;
      }
      const selected = await selectFolderDialog('Select Camera Trap Footage Folder');
      if (selected) {
        await quickStore.loadFolder(selected);
      }
    });

    card?.addEventListener('dragover', (e) => {
      e.preventDefault();
      card.classList.add('drag-over');
    });
    card?.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });
    card?.addEventListener('drop', (e: any) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        const path = (file as any).path || file.name;
        if (path) {
          quickStore.loadFolder(path);
        }
      }
    });

    this.querySelector('#btnSelectFolder')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const selected = await selectFolderDialog('Select Camera Trap Footage Folder');
      if (selected) {
        await quickStore.loadFolder(selected);
      }
    });

    // Start classify button
    const handleStartClassify = async () => {
      if (quickStore.folderPath && quickStore.items.length > 0) {
        quickStore.startSession();
      } else {
        const selected = await selectFolderDialog('Select Camera Trap Footage Folder');
        if (selected) {
          await quickStore.loadFolder(selected);
          quickStore.startSession();
        }
      }
    };

    this.querySelector('#btnStartClassifyTop')?.addEventListener('click', handleStartClassify);

    this.querySelector('#btnChangeFolder')?.addEventListener('click', async () => {
      const selected = await selectFolderDialog('Select Camera Trap Footage Folder');
      if (selected) {
        await quickStore.loadFolder(selected);
      }
    });

    // Quick pick chips for location
    this.querySelectorAll('.btn-quick-pick-site').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const siteVal = (e.currentTarget as HTMLElement).getAttribute('data-site');
        const inputSite = this.querySelector<HTMLInputElement>('#inputQuickSiteName');
        if (siteVal && inputSite) {
          inputSite.value = siteVal;
          quickStore.setSiteName(siteVal);
        }
      });
    });

    // Location input
    const inputSite = this.querySelector<HTMLInputElement>('#inputQuickSiteName');
    inputSite?.addEventListener('input', () => {
      quickStore.siteName = inputSite.value.trim();
    });
    inputSite?.addEventListener('change', () => {
      quickStore.setSiteName(inputSite.value.trim());
    });

    // Hotkey input changes
    this.querySelectorAll<HTMLInputElement>('.hotkey-species-input').forEach(input => {
      const idx = Number(input.getAttribute('data-index'));
      input.addEventListener('input', () => {
        if (!isNaN(idx) && idx < quickStore.hotkeys.length) {
          quickStore.updateHotkey(idx, input.value, false);
        }
      });
      input.addEventListener('change', () => {
        const trimmed = input.value.trim();
        if (trimmed && !isNaN(idx) && idx < quickStore.hotkeys.length) {
          quickStore.updateHotkey(idx, trimmed, false);
        }
      });
    });

    this.querySelector('#btnResetDefaultHotkeys')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      quickStore.resetHotkeys();
      this.renderIngestScreen();
      showToast('Hotkeys reset to defaults');
    });

    // Comment input changes
    this.querySelectorAll<HTMLInputElement>('.comment-text-input').forEach(input => {
      const idx = Number(input.getAttribute('data-index'));
      input.addEventListener('input', () => {
        if (!isNaN(idx) && idx < quickStore.presetComments.length) {
          quickStore.updatePresetComment(idx, input.value, false);
        }
      });
      input.addEventListener('change', () => {
        const trimmed = input.value.trim();
        if (!isNaN(idx) && idx < quickStore.presetComments.length) {
          if (trimmed === '') {
            quickStore.removePresetComment(idx);
            this.renderIngestScreen();
          } else {
            quickStore.updatePresetComment(idx, trimmed, false);
          }
        }
      });
    });

    // Remove comment buttons
    this.querySelectorAll<HTMLButtonElement>('.btn-remove-comment').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx = Number(btn.getAttribute('data-index'));
        if (!isNaN(idx)) {
          quickStore.removePresetComment(idx);
          this.renderIngestScreen();
        }
      });
    });

    // Add comment button
    this.querySelector('#btnAddComment')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      quickStore.addPresetComment('New note');
      this.renderIngestScreen();
      setTimeout(() => {
        const inputs = this.querySelectorAll<HTMLInputElement>('.comment-text-input');
        const last = inputs[inputs.length - 1];
        if (last) {
          last.focus();
          last.select();
        }
      }, 50);
    });

    // Reset comments button
    this.querySelector('#btnResetDefaultComments')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      quickStore.resetPresetComments();
      this.renderIngestScreen();
      showToast('Comments reset to defaults');
    });
  }

  private renderClassifyScreen(): void {
    this.innerHTML = html`
      <div class="classify-view"
        style="display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; overflow: hidden;">
        <classifier-view mode="quick" style="flex: 1; display: flex; flex-direction: column; min-height: 0;">
        </classifier-view>
      </div>
      
      <!-- Completion Export Notification Modal Container -->
      <div id="completionPromptContainer"></div>
      
      <!-- Modals -->
      <date-editor-modal></date-editor-modal>
      <export-modal></export-modal>
    `;

    this.updateCompletionPrompt();
  }

  private updateCompletionPrompt(): void {
    const container = this.querySelector('#completionPromptContainer');
    if (!container) return;

    if (!quickStore.showCompletionPrompt) {
      container.innerHTML = '';
      return;
    }

    if (container.querySelector('.modal-backdrop')) {
      return;
    }

    const total = quickStore.items.length;
    container.innerHTML = html`
      <div class="modal-backdrop">
        <div class="modal-dialog" style="max-width: 440px; text-align: center;">
          <div class="modal-body" style="align-items: center; padding: var(--space-6);">
            <div style="margin-bottom: var(--space-2); color: var(--color-brand);">${icon('paw', { size: 48 })}</div>
            <h2 style="font-size: var(--text-xl); font-weight: 700; color: var(--color-text-main);">
              You've reached the last photo!
            </h2>
            <p
              style="color: var(--color-text-muted); font-size: var(--text-sm); margin-top: var(--space-2); line-height: 1.5;">
              All <strong>${total}</strong> photos in <strong>${escapeHtml(quickStore.folderName)}</strong> are classified.
              <br />
              Ready to export your session data and images?
            </p>
          </div>
          <div class="modal-footer" style="justify-content: center; gap: var(--space-3); background: var(--color-bg-base);">
            <button class="btn-secondary" id="btnDismissPrompt">Keep Reviewing</button>
            <button class="btn-primary" id="btnExportFromPrompt" style="padding: var(--space-2) var(--space-5);">
              ${icon('table-export')} Export Results Now
            </button>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#btnDismissPrompt')?.addEventListener('click', () => {
      quickStore.dismissCompletionPrompt();
    });
    container.querySelector('#btnExportFromPrompt')?.addEventListener('click', () => {
      quickStore.dismissCompletionPrompt();
      const exportModal = this.querySelector<ExportModal>('export-modal');
      exportModal?.open();
    });
  }
}

customElements.define('quick-workspace', QuickWorkspace);

declare global {
  interface HTMLElementTagNameMap {
    'quick-workspace': QuickWorkspace;
  }
}
