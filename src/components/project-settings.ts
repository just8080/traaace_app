import { projectStore } from '../store/project-store';
import { ipc } from '../services/tauri-bridge';
import { getSavedUiScale, applyZoom, showToast } from '../services/ui-scale';
import { icon } from '../services/icons';
import { html, escapeHtml } from '../utils';
import { getShowWelcomeOnStartup, setShowWelcomeOnStartup } from '../services/welcome-pref';

export class ProjectSettings extends HTMLElement {
  private unsubscribe: (() => void) | null = null;
  private scaleListener: ((e: Event) => void) | null = null;
  private restoreKeydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private appDataPath = '';
  private isDevMode = false;
  private showRestoreConfirmModal = false;
  private isRestoring = false;

  connectedCallback(): void {
    this.unsubscribe = projectStore.subscribe(() => this.render());
    this.scaleListener = () => {
      const scale = getSavedUiScale();
      const badge = this.querySelector('#scaleReadoutBadge');
      if (badge) badge.textContent = `${Math.round(scale * 100)}%`;
      this.querySelectorAll<HTMLElement>('.btn-scale-preset').forEach((btn) => {
        const btnScale = parseFloat(btn.dataset.scale || '1');
        btn.classList.toggle('active', Math.abs(btnScale - scale) < 0.03);
      });
    };
    window.addEventListener('traaace-scale-changed', this.scaleListener);

    this.restoreKeydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.showRestoreConfirmModal && !this.isRestoring) {
        this.showRestoreConfirmModal = false;
        this.render();
      }
    };
    window.addEventListener('keydown', this.restoreKeydownHandler);

    this.loadSystemInfo();
    this.render();
  }

  disconnectedCallback(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
    if (this.scaleListener) {
      window.removeEventListener('traaace-scale-changed', this.scaleListener);
      this.scaleListener = null;
    }
    if (this.restoreKeydownHandler) {
      window.removeEventListener('keydown', this.restoreKeydownHandler);
      this.restoreKeydownHandler = null;
    }
  }

  private async loadSystemInfo(): Promise<void> {
    try {
      this.appDataPath = await ipc.getAppDataPath();
      this.isDevMode = await ipc.getDevMode();
      this.render();
    } catch (err) {
      console.error('Failed to load system info:', err);
    }
  }

  private render(): void {
    const currentScale = getSavedUiScale();

    this.innerHTML = html`
      <div class="page-container">
        <!-- Header -->
        <div>
          <h1 style="font-size: var(--text-2xl); font-weight: 700; color: var(--color-text-main);">Project Settings</h1>
          <p class="text-muted text-sm mt-1">
            Configure interface scaling, persistent database storage, and automated backups.
          </p>
        </div>
      

      
        <!-- Section: Interface Scaling -->
        <div class="surface-card">
          <div class="scale-header-row">
            <div>
              <strong class="text-md text-main">Interface Scaling</strong>
              <p class="text-xs text-muted mt-1">
                Scale the entire interface up or down. You can also use keyboard shortcuts anytime.
              </p>
            </div>
            <div class="scale-readout-badge" id="scaleReadoutBadge">${Math.round(currentScale * 100)}%</div>
          </div>
      
          <div class="scale-controls-row">
            <button type="button" class="btn btn-secondary scale-step-btn" id="btnScaleDown"
              title="Zoom Out (Cmd -)">−</button>
            <div class="scale-presets-pills">
              <button type="button" class="btn-scale-preset ${Math.abs(currentScale - 0.85) < 0.03 ? 'active' : ''}"
                data-scale="0.85">85%</button>
              <button type="button" class="btn-scale-preset ${Math.abs(currentScale - 0.90) < 0.03 ? 'active' : ''}"
                data-scale="0.9">90%</button>
              <button type="button" class="btn-scale-preset ${Math.abs(currentScale - 1.00) < 0.03 ? 'active' : ''}"
                data-scale="1.0">100%</button>
              <button type="button" class="btn-scale-preset ${Math.abs(currentScale - 1.10) < 0.03 ? 'active' : ''}"
                data-scale="1.1">110%</button>
              <button type="button" class="btn-scale-preset ${Math.abs(currentScale - 1.25) < 0.03 ? 'active' : ''}"
                data-scale="1.25">125%</button>
              <button type="button" class="btn-scale-preset ${Math.abs(currentScale - 1.50) < 0.03 ? 'active' : ''}"
                data-scale="1.5">150%</button>
            </div>
            <button type="button" class="btn btn-secondary scale-step-btn" id="btnScaleUp" title="Zoom In (Cmd +)">+</button>
            <button type="button" class="btn btn-secondary" id="btnScaleReset">Reset</button>
          </div>
      
          <div class="keyboard-shortcuts-block">
            <span class="shortcuts-title">Keyboard Shortcuts:</span>
            <div class="keyboard-shortcuts-list">
              <div class="shortcut-line">
                <kbd>⌘ +</kbd> <span>/</span> <kbd>Ctrl +</kbd> <span>Zoom in</span>
              </div>
              <div class="shortcut-line">
                <kbd>⌘ -</kbd> <span>/</span> <kbd>Ctrl -</kbd> <span>Zoom out</span>
              </div>
              <div class="shortcut-line">
                <kbd>⌘ 0</kbd> <span>/</span> <kbd>Ctrl 0</kbd> <span>Reset</span>
              </div>
            </div>
          </div>
        </div>
      
        <!-- Section: Welcome Screen -->
        <div class="surface-card">
          <div class="flex justify-between items-center">
            <div>
              <strong class="text-md text-main">Welcome Screen</strong>
              <p class="text-xs text-muted mt-1">
                The welcome screen is where you choose Quick Classify or a project when TRAAACE starts.
              </p>
            </div>
            <label style="display: flex; align-items: center; gap: var(--space-2); cursor: pointer; user-select: none;">
              <input type="checkbox" id="chkShowWelcome" ${getShowWelcomeOnStartup() ? 'checked' : ''} />
              <span class="text-sm text-main">Show on startup</span>
            </label>
          </div>
          <div class="flex items-center gap-3" style="margin-top: var(--space-3);">
            <button type="button" class="btn btn-secondary" id="btnSwitchWorkspace">Switch workspace…</button>
            <span class="text-xs text-muted">Reopens the welcome screen. Use it if the startup screen is turned off.</span>
          </div>
        </div>

        <!-- Section: SQLite Database & App Storage -->
        <div class="surface-card">
          <div class="flex justify-between items-center">
            <div>
              <strong class="text-md text-main">Database & Application Storage</strong>
              <p class="text-xs text-muted mt-1">
                Longitudinal local storage engine storing all project metadata, keymaps, and classifications.
              </p>
            </div>
            <div class="flex gap-2 items-center">
              ${this.isDevMode ? '<span class="badge badge-warning">Dev Mode</span>' : ''}
              <span class="badge badge-success">SQLite 3</span>
            </div>
          </div>
      
          <div class="flex flex-col gap-2">
            <label class="text-xs font-semibold text-muted">
              APPLICATION DATA PATH
            </label>
            <div class="flex gap-2">
              <input type="text" value="${escapeHtml(this.appDataPath) || 'Loading...'}"
                class="font-mono text-xs" style="flex: 1;" readonly />
              <button class="btn-secondary" id="btnRevealAppData">
                Reveal in Finder
              </button>
            </div>
            <p class="text-muted mt-1" style="font-size: 11px;">
              Contains <code>trace_classifier.sqlite</code> and local app configuration.
            </p>
          </div>
        </div>
      
        <!-- Section: Database Backup & Recovery -->
        <div class="surface-card">
          <div>
            <strong class="text-md text-main">Backup & Restore</strong>
            <p class="text-xs text-muted mt-1">
              Create self-contained ZIP backup archives of your entire SQLite database and project state.
            </p>
          </div>
      
          <div class="grid-cols-2 gap-4" style="display: grid;">
            <div class="inner-card justify-between">
              <div>
                <strong class="text-sm text-main inline-flex items-center gap-2">
                  ${icon('box-seam')} Create Database Backup
                </strong>
                <p class="text-xs text-muted mt-1" style="line-height: 1.5;">
                  Safely vacuums and compresses your active SQLite database into a portable <code>.zip</code> file.
                </p>
              </div>
              <button class="btn-primary" id="btnBackupDatabase">
                Export Backup Archive (.zip)...
              </button>
            </div>
      
            <div class="inner-card justify-between">
              <div>
                <strong class="text-sm text-main inline-flex items-center gap-2">
                  ${icon('refresh')} Restore from Backup
                </strong>
                <p class="text-xs text-muted mt-1" style="line-height: 1.5;">
                  Restore your project database from a previously exported TRAAACE backup archive.
                </p>
              </div>
              <button class="btn-ghost" id="btnRestoreDatabase"
                style="border: 1px solid var(--color-border); color: var(--color-danger);">
                Restore Archive (.zip)...
              </button>
            </div>
          </div>
        </div>
      
        <!-- Section: Data Migration & CSV Import -->
        <div class="surface-card">
          <div>
            <strong class="text-md text-main">CSV Import</strong>
            <p class="text-xs text-muted mt-1">
              Import observation records exported from previous versions of TRAAACE or external spreadsheets into your database.
            </p>
          </div>
      
          <div class="flex gap-3 items-center">
            <button class="btn-secondary" id="btnImportObservationsCsv">
              ${icon('table-import')} Import Observation CSV File...
            </button>
            <span class="text-xs text-muted">
              Supports standard column headers: Site, Timestamp, Species, Count, Comment, Filename.
            </span>
          </div>
        </div>
      </div>

      <!-- In-App Restore Confirmation Modal -->
      ${this.showRestoreConfirmModal ? html`
        <div class="modal-backdrop" id="modalRestoreBackdrop">
          <div class="modal-dialog max-w-dialog" role="dialog" aria-modal="true" aria-labelledby="restoreModalTitle">
            <div class="modal-header">
              <span class="inline-flex items-center gap-2 text-main font-semibold" id="restoreModalTitle">
                <span style="color: var(--color-danger); display: flex;">${icon('refresh')}</span>
                Restore Project Database
              </span>
              <button type="button" class="btn-ghost p-1 cursor-pointer text-muted" id="btnCancelRestoreModalHeader" title="Close">
                ✕
              </button>
            </div>
            <div class="modal-body" style="gap: var(--space-4);">
              <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid var(--color-danger); border-radius: var(--radius-md); padding: var(--space-4); display: flex; gap: var(--space-3); align-items: flex-start;">
                <span style="color: var(--color-danger); flex-shrink: 0; margin-top: 1px; display: flex;">${icon('info')}</span>
                <div class="text-xs" style="line-height: 1.6; color: var(--color-text-main);">
                  <strong style="color: var(--color-danger);">WARNING:</strong> Restoring will overwrite your current active SQLite database with the selected backup archive.
                  Any classifications, notes, or edits made since the backup was created will be permanently replaced.
                </div>
              </div>
              <p class="text-xs text-muted">
                Are you sure you wish to proceed and choose a backup <code>.zip</code> file?
              </p>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" id="btnCancelRestoreModal">
                Cancel
              </button>
              <button type="button" class="btn btn-primary" id="btnConfirmRestoreModal"
                style="background-color: var(--color-danger); border-color: var(--color-danger);">
                Choose Backup (.zip) & Restore...
              </button>
            </div>
          </div>
        </div>
      ` : ''}
    `;

    // UI Scaling controls
    this.querySelector('#chkShowWelcome')?.addEventListener('change', (e) => {
      setShowWelcomeOnStartup((e.target as HTMLInputElement).checked);
    });
    this.querySelector('#btnSwitchWorkspace')?.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('open-welcome', { bubbles: true, composed: true }));
    });

    this.querySelector('#btnScaleDown')?.addEventListener('click', () => {
      const s = applyZoom(getSavedUiScale() - 0.1, true);
      showToast(`Zoom: ${Math.round(s * 100)}%`);
    });

    this.querySelector('#btnScaleUp')?.addEventListener('click', () => {
      const s = applyZoom(getSavedUiScale() + 0.1, true);
      showToast(`Zoom: ${Math.round(s * 100)}%`);
    });

    this.querySelector('#btnScaleReset')?.addEventListener('click', () => {
      applyZoom(1.0, true);
      showToast('Zoom reset to 100%');
    });

    this.querySelectorAll<HTMLElement>('.btn-scale-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const scale = parseFloat(btn.dataset.scale || '1');
        if (scale) {
          applyZoom(scale, true);
          showToast(`Zoom: ${Math.round(scale * 100)}%`);
        }
      });
    });

    // Reveal in Finder
    this.querySelector('#btnRevealAppData')?.addEventListener('click', async () => {
      try {
        await ipc.openAppDataFolder();
      } catch (err) {
        showToast(`Could not open app data folder: ${err}`, 4000);
      }
    });

    // Backup Database
    this.querySelector('#btnBackupDatabase')?.addEventListener('click', async () => {
      try {
        const defaultName = `traaace_backup_${new Date().toISOString().slice(0, 10)}.zip`;
        const dest = await ipc.selectSaveBackupPath(defaultName);
        if (dest) {
          const info = await ipc.backupAppData(dest);
          showToast(`Backup created successfully (${info.classificationCount || 0} records)`, 3500);
        }
      } catch (err) {
        showToast(`Backup failed: ${err}`, 4000);
      }
    });

    // Restore Database trigger
    this.querySelector('#btnRestoreDatabase')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showRestoreConfirmModal = true;
      this.render();
    });

    // Restore Modal cancel actions
    const closeRestoreModal = () => {
      if (this.isRestoring) return;
      this.showRestoreConfirmModal = false;
      this.render();
    };

    this.querySelector('#btnCancelRestoreModal')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeRestoreModal();
    });

    this.querySelector('#btnCancelRestoreModalHeader')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeRestoreModal();
    });

    this.querySelector('#modalRestoreBackdrop')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'modalRestoreBackdrop') {
        closeRestoreModal();
      }
    });

    // Restore Modal confirm action
    this.querySelector('#btnConfirmRestoreModal')?.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.isRestoring) return;
      this.isRestoring = true;

      const confirmBtn = this.querySelector<HTMLButtonElement>('#btnConfirmRestoreModal');
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Selecting file...';
      }

      try {
        const file = await ipc.selectBackupFile();
        this.showRestoreConfirmModal = false;
        this.render();

        if (file) {
          showToast('Restoring database archive...', 2500);
          await ipc.restoreAppData(file);
          showToast('Database restored successfully! Reloading data...', 3500);
          await projectStore.loadBatches();
          await projectStore.loadKeymaps();
          await projectStore.loadComments();
          await projectStore.loadAnalytics();
        }
      } catch (err) {
        this.showRestoreConfirmModal = false;
        this.render();
        showToast(`Restore failed: ${err}`, 4500);
      } finally {
        this.isRestoring = false;
      }
    });

    // Import CSV
    this.querySelector('#btnImportObservationsCsv')?.addEventListener('click', async () => {
      try {
        const file = await ipc.selectCsvFile();
        if (file) {
          const res = await ipc.importAnalyticsCsv(file);
          const count = res.importedCount;
          const batches = res.batchCount;
          showToast(res.message || `CSV imported: ${count} observations across ${batches} batches.`, 3500);
          await projectStore.loadBatches();
          await projectStore.loadKeymaps();
          await projectStore.loadComments();
          await projectStore.loadAnalytics();
        }
      } catch (err) {
        showToast(`CSV import failed: ${err}`, 4000);
      }
    });
  }
}

customElements.define('project-settings', ProjectSettings);

declare global {
  interface HTMLElementTagNameMap {
    'project-settings': ProjectSettings;
  }
}
