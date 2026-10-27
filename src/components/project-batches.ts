import { projectStore, type ProjectBatchSummary } from '../store/project-store';
import { selectFolderDialog, openPath } from '../services/tauri-bridge';
import { icon } from '../services/icons';
import { html, escapeHtml } from '../utils';
import './batch-export-modal';
import type { BatchExportModal } from './batch-export-modal';
import './batch-delete-modal';
import type { BatchDeleteModal } from './batch-delete-modal';
import './site-editor-modal';
import type { SiteEditorModal } from './site-editor-modal';

export class ProjectBatches extends HTMLElement {
  private unsubscribe: (() => void) | null = null;
  private searchQuery = '';

  connectedCallback(): void {
    this.unsubscribe = projectStore.subscribe(() => this.render());
    projectStore.loadBatches().catch(err => console.error('Failed to load batches on connect:', err));
    this.render();
  }

  disconnectedCallback(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }

  private getFilteredBatches(): ProjectBatchSummary[] {
    const all = projectStore.batches || [];
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return all;
    return all.filter(b => b.name.toLowerCase().includes(q) || b.site.toLowerCase().includes(q));
  }

  private updateSelectedButtons(): void {
    const selectedCount = projectStore.selectedBatchNames.size;
    const btnExport = this.querySelector<HTMLButtonElement>('#btnExportCombined');
    if (btnExport) {
      btnExport.textContent = `Export Selected (${selectedCount})`;
      btnExport.disabled = selectedCount === 0;
    }
    const btnDelete = this.querySelector<HTMLButtonElement>('#btnDeleteCombined');
    if (btnDelete) {
      btnDelete.innerHTML = `${icon('trash')} Delete Selected (${selectedCount})`;
      btnDelete.disabled = selectedCount === 0;
      btnDelete.style.color = selectedCount > 0 ? 'var(--color-danger)' : '';
      btnDelete.style.borderColor = selectedCount > 0 ? 'rgba(239, 68, 68, 0.4)' : '';
    }
  }

  private updateSelectAllCheckbox(batches: ProjectBatchSummary[]): void {
    const chkSelectAll = this.querySelector<HTMLInputElement>('#chkSelectAllBatches');
    if (chkSelectAll) {
      const allSelected = batches.length > 0 && batches.every(b => projectStore.selectedBatchNames.has(b.name));
      const someSelected = !allSelected && batches.some(b => projectStore.selectedBatchNames.has(b.name));
      chkSelectAll.checked = allSelected;
      chkSelectAll.indeterminate = someSelected;
    }
  }

  private updateBatchesTable(): void {
    const batches = this.getFilteredBatches();
    const countBadge = this.querySelector('#batchCountBadge');
    if (countBadge) {
      countBadge.textContent = `Showing ${batches.length} of ${projectStore.batches.length} batches`;
    }
    const container = this.querySelector('#batchesTableContainer');
    if (container) {
      container.innerHTML = this.renderTableHtml(batches);
      this.attachTableListeners(batches);
    }
    this.updateSelectedButtons();
  }

  private renderTableHtml(batches: ProjectBatchSummary[]): string {
    if (batches.length === 0) {
      return html`
        <div class="surface-card text-center text-muted" style="padding: var(--space-10);">
          <p class="text-md font-semibold text-main">No projects found</p>
          <p class="text-xs mt-1">Make sure your Working Folder is set, click <strong>Browse...</strong> to import footage.</p>
        </div>
      `;
    }

    const allSelected = batches.length > 0 && batches.every(b => projectStore.selectedBatchNames.has(b.name));

    return html`
      <div class="batches-table-box">
        <table class="w-full text-sm" style="border-collapse: collapse; text-align: left;">
          <thead>
            <tr class="text-muted text-xs bg-base" style="border-bottom: 1px solid var(--color-border);">
              <th style="padding: var(--space-3) var(--space-4); width: 40px; text-align: center;">
                <input type="checkbox" id="chkSelectAllBatches" ${allSelected ? 'checked' : ''} />
              </th>
              <th style="padding: var(--space-3) var(--space-4);">Folders</th>
              <th style="padding: var(--space-3) var(--space-4);">Site</th>
              <th style="padding: var(--space-3) var(--space-4);">Images</th>
              <th style="padding: var(--space-3) var(--space-4); width: 220px;">Progress</th>
              <th style="padding: var(--space-3) var(--space-4);">Status</th>
              <th style="padding: var(--space-3) var(--space-4);">Exported</th>
              <th style="padding: var(--space-3) var(--space-4); text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${batches.map(b => {
              const percent = b.totalImages > 0 ? Math.round((b.classifiedCount / b.totalImages) * 100) : 0;
              const isChecked = projectStore.selectedBatchNames.has(b.name);
              const isExported = (b.totalImages > 0 && b.exportedCount >= b.totalImages) || b.status.toLowerCase() === 'exported';
              const isComplete = b.totalImages > 0 && b.classifiedCount >= b.totalImages;
              const isArchived = b.status.toLowerCase() === 'archived' || b.mediaAvailable === false;

              // Classification / Archival Status
              const statusBadge = (isArchived || isComplete)
                ? '<span class="badge badge-archive">Archived</span>'
                : (b.classifiedCount > 0
                  ? '<span class="badge badge-accent">In Progress</span>'
                  : '<span class="badge badge-muted">Unclassified</span>');

              // Dedicated Export Status
              const exportedBadge = isExported
                ? '<span class="badge badge-exported">Exported</span>'
                : '<span class="text-muted" style="font-size: 11px; padding-left: 8px;">—</span>';

              return html`
                <tr style="border-bottom: 1px solid var(--color-border);">
                  <td style="padding: var(--space-3) var(--space-4); text-align: center;">
                    <input type="checkbox" class="chk-batch-item" data-name="${escapeHtml(b.name)}" ${isChecked ? 'checked' : ''} />
                  </td>
                  <td class="font-mono text-xs font-semibold" style="padding: var(--space-3) var(--space-4);">
                    ${escapeHtml(b.name)}
                  </td>
                  <td style="padding: var(--space-3) var(--space-4);">
                    <button type="button" class="btn-ghost btn-edit-batch-site cursor-pointer text-main bg-base inline-flex items-center gap-1" data-name="${escapeHtml(b.name)}" data-site="${escapeHtml(b.site)}"
                      style="padding: 2px 8px; border-radius: var(--radius-sm); border: 1px solid var(--color-border); font-size: 11px; max-width: 180px;"
                      title="Click to edit location / site name for ${escapeHtml(b.name)}">
                      <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600;">${escapeHtml(b.site) || 'Set Location'}</span>
                      <span class="text-accent flex" style="opacity: 0.6;">${icon('pencil', { size: 10 })}</span>
                    </button>
                  </td>
                  <td class="font-semibold" style="padding: var(--space-3) var(--space-4);">
                    ${b.totalImages}
                  </td>
                  <td style="padding: var(--space-3) var(--space-4);">
                    <div class="flex flex-col gap-1">
                      <div class="batch-progress-track">
                        <div class="batch-progress-fill" data-percent="${percent}"></div>
                      </div>
                      <span class="text-muted" style="font-size: 11px;">
                        ${b.classifiedCount} / ${b.totalImages} (${percent}%)
                      </span>
                    </div>
                  </td>
                  <td style="padding: var(--space-3) var(--space-4);">
                    ${statusBadge}
                  </td>
                  <td style="padding: var(--space-3) var(--space-4);">
                    ${exportedBadge}
                  </td>
                  <td style="padding: var(--space-3) var(--space-4); text-align: right;">
                    <div class="inline-flex items-center gap-2">
                      <button class="btn-primary btn-sm btn-classify-project-batch" data-name="${escapeHtml(b.name)}">
                        ${isComplete ? 'Review' : 'Classify'}
                      </button>
                      <button class="btn-secondary btn-sm btn-export-project-batch" data-name="${escapeHtml(b.name)}" ${b.classifiedCount === 0 ? 'disabled' : ''}>
                        Export
                      </button>
                      <button class="btn-ghost btn-sm btn-delete-project-batch text-danger" data-name="${escapeHtml(b.name)}" title="Remove batch from database" style="padding: 3px 6px;">
                        ${icon('trash')}
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>
    `;
  }

  private attachTableListeners(batches: ProjectBatchSummary[]): void {
    const allSelected = batches.length > 0 && batches.every(b => projectStore.selectedBatchNames.has(b.name));
    const someSelected = !allSelected && batches.some(b => projectStore.selectedBatchNames.has(b.name));

    // Initialize progress bar fills
    this.querySelectorAll<HTMLElement>('.batch-progress-fill').forEach(el => {
      const pct = el.getAttribute('data-percent') || '0';
      el.style.width = `${pct}%`;
    });

    // Checkbox selection
    this.querySelectorAll('.chk-batch-item').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        const name = target.getAttribute('data-name');
        if (name) {
          if (target.checked) {
            projectStore.selectedBatchNames.add(name);
          } else {
            projectStore.selectedBatchNames.delete(name);
          }
          this.updateSelectAllCheckbox(batches);
          this.updateSelectedButtons();
        }
      });
    });

    // Select all / Deselect all toggle
    const chkSelectAll = this.querySelector<HTMLInputElement>('#chkSelectAllBatches');
    if (chkSelectAll) {
      chkSelectAll.indeterminate = someSelected;
      chkSelectAll.checked = allSelected;

      chkSelectAll.addEventListener('change', (e) => {
        const checked = (e.target as HTMLInputElement).checked;
        if (checked) {
          batches.forEach(b => projectStore.selectedBatchNames.add(b.name));
        } else {
          batches.forEach(b => projectStore.selectedBatchNames.delete(b.name));
        }
        this.querySelectorAll<HTMLInputElement>('.chk-batch-item').forEach(item => {
          item.checked = checked;
        });
        chkSelectAll.indeterminate = false;
        this.updateSelectedButtons();
      });
    }

    // Classify click -> opens persistent SQLite classification!
    this.querySelectorAll('.btn-classify-project-batch').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.getAttribute('data-name');
        if (name) {
          await projectStore.openBatchForClassification(name);
        }
      });
    });

    // Delete single batch via dedicated modal (with cancel/abort option & disk deletion choice)
    this.querySelectorAll('.btn-delete-project-batch').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const name = (e.currentTarget as HTMLElement).getAttribute('data-name');
        if (name) {
          const modal = this.querySelector<BatchDeleteModal>('#batchDeleteModal');
          modal?.open([name]);
        }
      });
    });

    // Export single batch
    this.querySelectorAll('.btn-export-project-batch').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const name = (e.currentTarget as HTMLElement).getAttribute('data-name');
        if (name) {
          const modal = this.querySelector<BatchExportModal>('#batchExportModal');
          modal?.open([name]);
        }
      });
    });

    // Edit location / site name
    this.querySelectorAll('.btn-edit-batch-site').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const name = target.getAttribute('data-name');
        const site = target.getAttribute('data-site') || '';
        if (name) {
          const modal = this.querySelector<SiteEditorModal>('#batchSiteModal');
          modal?.open(name, site);
        }
      });
    });
  }

  private render(): void {
    const activeEl = document.activeElement;
    const isSearchFocused = activeEl?.id === 'inputBatchSearch';
    const selStart = isSearchFocused ? (activeEl as HTMLInputElement).selectionStart : null;
    const selEnd = isSearchFocused ? (activeEl as HTMLInputElement).selectionEnd : null;

    const workingFolder = projectStore.workingFolder;
    const exportFolder = projectStore.exportFolder;
    const selectedCount = projectStore.selectedBatchNames.size;
    const batches = this.getFilteredBatches();

    this.innerHTML = html`
      <div class="page-container" style="max-width: 1200px;">
        <!-- Header -->
        <div class="flex justify-between items-end">
          <div>
            <h1 style="font-size: var(--text-2xl); font-weight: 700; color: var(--color-text-main);">Project Library</h1>
            <p class="text-muted text-sm mt-1">
              Review, classify, and export camera footage tracked permanently to your local database.
            </p>
          </div>
          <div class="flex gap-2 items-center">
            <button class="btn-primary" id="btnRescanFolder" title="Rescan your Working Folder for new imports">
              ${icon('refresh')} Rescan Folder
            </button>
            <button class="btn-secondary" id="btnExportCombined" ${selectedCount === 0 ? 'disabled' : ''}>
              Export Selected (${selectedCount})
            </button>
            <button class="btn-secondary" id="btnDeleteCombined" ${selectedCount === 0 ? 'disabled' : ''} style="${selectedCount > 0 ? 'color: var(--color-danger); border-color: rgba(239, 68, 68, 0.4);' : ''}">
              ${icon('trash')} Delete Selected (${selectedCount})
            </button>
          </div>
        </div>

        <!-- Directory Locations Card -->
        <div class="surface-card">
          <div class="flex justify-between items-center">
            <strong class="text-sm">Project Directory Locations</strong>
            ${workingFolder
              ? '<span class="badge badge-accent">Persistent Local Storage</span>'
              : '<span class="badge badge-warning">No Working Folder Set</span>'}
          </div>

          <div class="grid-cols-2 gap-4" style="display: grid;">
            <div class="flex flex-col gap-1">
              <label class="text-xs font-semibold text-muted">
                WORKING FOLDER (Auto-Scanned)
              </label>
              <div class="flex gap-2">
                <input
                  type="text"
                  value="${escapeHtml(workingFolder)}"
                  placeholder="Not set (Select working directory...)"
                  class="font-mono text-xs"
                  style="flex: 1;"
                  readonly
                />
                <button class="btn-secondary" id="btnBrowseWorking">Browse...</button>
                ${workingFolder ? `
                  <button class="btn-secondary" id="btnOpenWorking" title="Open working folder in file manager" style="display: inline-flex; align-items: center; gap: 4px; font-size: var(--text-xs); white-space: nowrap;">
                    ${icon('folder-open', { size: 13 })} Open
                  </button>
                  <button class="btn-ghost" id="btnClearWorking" title="Clear Working Folder">${icon('close')}</button>
                ` : ''}
              </div>
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-xs font-semibold text-muted">
                EXPORT FOLDER
              </label>
              <div class="flex gap-2">
                <input
                  type="text"
                  value="${escapeHtml(exportFolder)}"
                  placeholder="Not set (Select export directory...)"
                  class="font-mono text-xs"
                  style="flex: 1;"
                  readonly
                />
                <button class="btn-secondary" id="btnBrowseExport">Browse...</button>
                ${exportFolder ? `
                  <button class="btn-secondary" id="btnOpenExport" title="Open export folder in file manager" style="display: inline-flex; align-items: center; gap: 4px; font-size: var(--text-xs); white-space: nowrap;">
                    ${icon('folder-open', { size: 13 })} Open
                  </button>
                  <button class="btn-ghost" id="btnClearExport" title="Clear Export Folder">${icon('close')}</button>
                ` : ''}
              </div>
            </div>
          </div>
        </div>

        <!-- Toolbar & Search -->
        <div class="flex justify-between items-center">
          <div class="flex items-center gap-3">
            <input
              type="text"
              id="inputBatchSearch"
              placeholder="Search folders by site or name..."
              value="${this.searchQuery}"
              class="text-xs"
              style="width: 280px;"
            />
            <span id="batchCountBadge" class="text-xs text-muted">
              Showing ${batches.length} of ${projectStore.batches.length} batches
            </span>
          </div>

          <button class="btn-ghost text-xs" id="btnRefreshBatches">
            ${icon('refresh')} Refresh Folders
          </button>
        </div>

        <!-- Batches Table Container -->
        <div id="batchesTableContainer">
          ${this.renderTableHtml(batches)}
        </div>
      </div>
      <batch-export-modal id="batchExportModal"></batch-export-modal>
      <batch-delete-modal id="batchDeleteModal"></batch-delete-modal>
      <site-editor-modal id="batchSiteModal"></site-editor-modal>
    `;

    // Folder selection
    this.querySelector('#btnBrowseWorking')?.addEventListener('click', async () => {
      const folder = await selectFolderDialog('Select Project Working Folder', projectStore.workingFolder || undefined);
      if (folder) {
        await projectStore.setWorkingFolder(folder);
      }
    });

    this.querySelector('#btnClearWorking')?.addEventListener('click', async () => {
      await projectStore.setWorkingFolder(null);
    });

    this.querySelector('#btnOpenWorking')?.addEventListener('click', async () => {
      if (projectStore.workingFolder) {
        await openPath(projectStore.workingFolder);
      }
    });

    this.querySelector('#btnBrowseExport')?.addEventListener('click', async () => {
      const folder = await selectFolderDialog('Select Project Export Folder', projectStore.exportFolder || undefined);
      if (folder) {
        await projectStore.setExportFolder(folder);
      }
    });

    this.querySelector('#btnClearExport')?.addEventListener('click', async () => {
      await projectStore.setExportFolder(null);
    });

    this.querySelector('#btnOpenExport')?.addEventListener('click', async () => {
      if (projectStore.exportFolder) {
        await openPath(projectStore.exportFolder);
      }
    });

    // Search input: filter table only so search input never loses focus
    const searchInput = this.querySelector<HTMLInputElement>('#inputBatchSearch');
    searchInput?.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      this.updateBatchesTable();
    });

    // Refresh
    this.querySelector('#btnRefreshBatches')?.addEventListener('click', () => {
      projectStore.loadBatches();
    });

    // Export combined
    this.querySelector('#btnExportCombined')?.addEventListener('click', () => {
      const names = Array.from(projectStore.selectedBatchNames);
      if (names.length === 0) return;
      const modal = this.querySelector<BatchExportModal>('#batchExportModal');
      modal?.open(names);
    });

    // Delete combined / multi-batch
    this.querySelector('#btnDeleteCombined')?.addEventListener('click', () => {
      const names = Array.from(projectStore.selectedBatchNames);
      if (names.length === 0) return;
      const modal = this.querySelector<BatchDeleteModal>('#batchDeleteModal');
      modal?.open(names);
    });

    // Rescan Working Folder
    this.querySelector('#btnRescanFolder')?.addEventListener('click', async () => {
      const btn = this.querySelector<HTMLButtonElement>('#btnRescanFolder');
      if (btn) btn.innerHTML = `${icon('refresh')} Scanning...`;
      try {
        await projectStore.loadBatches();
      } finally {
        if (btn) btn.innerHTML = `${icon('refresh')} Rescan Folder`;
      }
    });

    // Attach table listeners
    this.attachTableListeners(batches);

    // If search was previously focused, restore focus and cursor position
    if (isSearchFocused) {
      const input = this.querySelector<HTMLInputElement>('#inputBatchSearch');
      if (input) {
        input.focus();
        if (selStart !== null && selEnd !== null) {
          input.setSelectionRange(selStart, selEnd);
        }
      }
    }
  }
}

customElements.define('project-batches', ProjectBatches);

declare global {
  interface HTMLElementTagNameMap {
    'project-batches': ProjectBatches;
  }
}
