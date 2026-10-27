import { showToast } from '../services/ui-scale';
import { BaseModal } from './base-modal';
import { projectStore } from '../store/project-store';
import { selectFolderDialog } from '../services/tauri-bridge';
import { ipc, openPath } from '../services/tauri-bridge';
import type { ExportOptions, ExportResult } from '../ipc-types';
import { icon } from '../services/icons';
import { html, escapeHtml } from '../utils';

export class BatchExportModal extends BaseModal {
  private batchNames: string[] = [];
  private destinationPath = '';
  private imageStructure: 'species_folders' | 'original_folders' | 'none' = 'species_folders';
  private mergeData = true;
  private exportCsv = true;
  private exportXlsx = true;
  private exportJson = true;
  private exportTxt = true;
  private isExporting = false;
  private exportResult: ExportResult | null = null;

  protected override canDismiss(): boolean {
    return !this.isExporting;
  }

  public override open(batchNames?: string[]): void {
    if (!batchNames || batchNames.length === 0) return;
    this.batchNames = batchNames;
    this.destinationPath = projectStore.exportFolder || '';
    this.imageStructure = 'species_folders';
    this.mergeData = true;
    this.exportCsv = true;
    this.exportXlsx = true;
    this.exportJson = true;
    this.exportTxt = true;
    this.isExporting = false;
    this.exportResult = null;

    super.open();
  }

  protected render(): void {
    if (!this.isOpen) {
      this.innerHTML = '';
      return;
    }

    const isSingle = this.batchNames.length === 1;
    const title = isSingle
      ? `Export Batch: ${this.batchNames[0]}`
      : `Export Combined (${this.batchNames.length} Batches)`;

    if (this.isExporting) {
      this.innerHTML = html`
        <div class="modal-backdrop">
          <div class="modal-dialog text-center" role="dialog" aria-modal="true" aria-label="Exporting" style="max-width: 520px;">
            <div class="modal-header">
              <span class="inline-flex items-center gap-2">${icon('refresh')} Exporting...</span>
            </div>
            <div class="modal-body" style="padding: var(--space-8) var(--space-6);">
              <div class="export-spinner"></div>
              <p class="font-semibold text-md mt-4">
                Generating data reports and exporting files...
              </p>
              <p class="text-muted text-xs mt-2">
                Processing observations for ${this.batchNames.length} batch(es). Please wait.
              </p>
            </div>
          </div>
        </div>
      `;
      return;
    }

    if (this.exportResult) {
      const records = this.exportResult.totalRecords;
      const filesCount = this.exportResult.exportedFileCount;
      const isMerged = !!this.exportResult.merged;
      const imagesPath = this.exportResult.imagesPath;

      this.innerHTML = html`
        <div class="modal-backdrop">
          <div class="modal-dialog" role="dialog" aria-modal="true" aria-label="Export Completed" style="max-width: 540px;">
            <div class="modal-header">
              <span class="text-success font-bold inline-flex items-center gap-2">${icon('check')} Export Completed!</span>
              <button class="btn-ghost btn-sm" id="btnCloseExportSuccess" aria-label="Close">${icon('close')}</button>
            </div>
            <div class="modal-body" style="gap: var(--space-4);">
              <div class="inner-card flex flex-col gap-2 text-xs">
                <div>
                  <strong>Destination:</strong>
                  <div class="font-mono text-main mt-1" style="word-break: break-all;">
                    ${escapeHtml(this.destinationPath)}
                  </div>
                </div>

                <div class="grid-cols-2 gap-3 mt-2 pt-2" style="display: grid; border-top: 1px solid var(--color-border);">
                  <div>
                    <span class="text-muted">Observations Exported:</span>
                    <div class="text-base font-bold text-accent">
                      ${records} records
                    </div>
                  </div>
                  <div>
                    <span class="text-muted">Photos Copied:</span>
                    <div class="text-base font-bold text-main">
                      ${imagesPath ? `${filesCount} images` : 'None (Data only)'}
                    </div>
                  </div>
                </div>

                <div class="mt-2 pt-2" style="border-top: 1px solid var(--color-border);">
                  <span class="text-muted">Master Dataset Mode:</span>
                  <div class="font-semibold text-main mt-1">
                    ${isMerged ? 'Merged into master files (traaace_export.csv / .xlsx / .json / .txt)' : 'Standalone batch files'}
                  </div>
                </div>
              </div>

              <p class="text-muted" style="font-size: 11px; line-height: 1.4;">
                Data is safely stored in your SQLite database. You can re-export anytime or reveal the files in Finder.
              </p>
            </div>
            <div class="modal-footer flex justify-between items-center w-full">
              <button class="btn-secondary inline-flex items-center gap-2" id="btnRevealInFinder">
                ${icon('folder-open')} Reveal in Finder
              </button>
              <button class="btn-primary" id="btnDoneExport">
                Done
              </button>
            </div>
          </div>
        </div>
      `;

      this.querySelector('#btnCloseExportSuccess')?.addEventListener('click', () => {
        this.close();
        projectStore.loadBatches();
      });
      this.querySelector('#btnDoneExport')?.addEventListener('click', () => {
        this.close();
        projectStore.loadBatches();
      });
      this.querySelector('#btnRevealInFinder')?.addEventListener('click', async () => {
        try {
          await openPath(this.destinationPath);
        } catch (err) {
          showToast(`Could not open folder: ${err}`);
        }
      });
      return;
    }

    this.innerHTML = html`
      <div class="modal-backdrop">
        <div class="modal-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}" style="max-width: 620px;">
          <div class="modal-header">
            <span class="font-bold">${escapeHtml(title)}</span>
            <button class="btn-ghost btn-sm" id="btnCloseExport" aria-label="Close">${icon('close')}</button>
          </div>

          <div class="modal-body" style="gap: var(--space-5);">
            <!-- Destination Folder -->
            <div class="flex flex-col gap-1">
              <label class="text-xs font-semibold text-muted">
                EXPORT DESTINATION FOLDER
              </label>
              <div class="flex gap-2">
                <input
                  type="text"
                  id="inputExportDestination"
                  value="${escapeHtml(this.destinationPath)}"
                  placeholder="Select export directory..."
                  class="font-mono text-xs"
                  style="flex: 1;"
                />
                <button class="btn-secondary" id="btnBrowseDestination">Change...</button>
              </div>
            </div>

            <!-- What to Export: Data Reports Checklist -->
            <div class="flex flex-col gap-2">
              <label class="text-xs font-semibold text-muted">
                DATA REPORT FORMATS
              </label>
              <div class="inner-card grid-cols-2 gap-2" style="display: grid;">
                <label class="flex items-center gap-2 cursor-pointer text-xs text-main">
                  <input type="checkbox" id="chkFormatCsv" ${this.exportCsv ? 'checked' : ''} />
                  <span class="inline-flex items-center gap-1">${icon('clipboard')} CSV Spreadsheet (.csv)</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer text-xs text-main">
                  <input type="checkbox" id="chkFormatXlsx" ${this.exportXlsx ? 'checked' : ''} />
                  <span class="inline-flex items-center gap-1">${icon('chart')} Excel Workbook (.xlsx)</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer text-xs text-main">
                  <input type="checkbox" id="chkFormatJson" ${this.exportJson ? 'checked' : ''} />
                  <span class="inline-flex items-center gap-1">${icon('box-seam')} JSON Dataset (.json)</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer text-xs text-main">
                  <input type="checkbox" id="chkFormatTxt" ${this.exportTxt ? 'checked' : ''} />
                  <span class="inline-flex items-center gap-1">${icon('clipboard')} Text Manifest (.txt)</span>
                </label>
              </div>
            </div>

            <!-- Image File Handling -->
            <div class="flex flex-col gap-2">
              <label class="text-xs font-semibold text-muted">
                IMAGE FILE HANDLING
              </label>
              <div class="export-options-grid">
                <!-- Species Folders -->
                <label class="export-option-card ${this.imageStructure === 'species_folders' ? 'active' : ''}">
                  <input type="radio" name="imageStructure" value="species_folders" ${this.imageStructure === 'species_folders' ? 'checked' : ''} />
                  <div class="export-option-content">
                    <div class="export-option-title">
                      <span>Organize photos into individual species folders</span>
                      <span class="badge badge-accent">Recommended</span>
                    </div>
                    <p class="export-option-desc">
                      Copies classified photos into sorted subfolders inside an <code>Images/</code> directory (e.g. <code>Images/Possum/</code>, <code>Images/Stoat/</code>).
                    </p>
                  </div>
                </label>

                <!-- Original Folders -->
                <label class="export-option-card ${this.imageStructure === 'original_folders' ? 'active' : ''}">
                  <input type="radio" name="imageStructure" value="original_folders" ${this.imageStructure === 'original_folders' ? 'checked' : ''} />
                  <div class="export-option-content">
                    <div class="export-option-title">
                      <span>Export photos as per imported (Batch folders)</span>
                    </div>
                    <p class="export-option-desc">
                      Copies photos preserving their original batch folder structure inside <code>Images/&lt;batch_name&gt;/</code>.
                    </p>
                  </div>
                </label>

                <!-- Data Only -->
                <label class="export-option-card ${this.imageStructure === 'none' ? 'active' : ''}">
                  <input type="radio" name="imageStructure" value="none" ${this.imageStructure === 'none' ? 'checked' : ''} />
                  <div class="export-option-content">
                    <div class="export-option-title">
                      <span>Data Reports Only (No images copied)</span>
                      <span class="badge badge-muted">Fastest</span>
                    </div>
                    <p class="export-option-desc">
                      Exports only the selected data files (.csv, .xlsx, .json, .txt). Raw photos remain completely untouched on disk.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            <!-- Merge Master Dataset Option -->
            <div class="inner-card">
              <label class="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" id="chkMergeMasterData" ${this.mergeData ? 'checked' : ''} style="margin-top: 2px;" />
                <div>
                  <span class="text-sm font-semibold text-main">
                    Merge data into master export files
                  </span>
                  <p class="text-muted mt-1" style="font-size: 11px; line-height: 1.4;">
                    Consolidates observations into unified <code>traaace_export.csv</code>, <code>.xlsx</code>, <code>.json</code>, and <code>.txt</code> files in the export folder. Uncheck to export standalone files named after the batch.
                  </p>
                </div>
              </label>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn-secondary" id="btnCancelExportDialog">Cancel</button>
            <button class="btn-primary inline-flex items-center gap-2" id="btnStartExportDialog">
              ${icon('table-export')} Start Export
            </button>
          </div>
        </div>
      </div>
    `;

    // Event listeners
    this.querySelector('#btnCloseExport')?.addEventListener('click', () => this.close());
    this.querySelector('#btnCancelExportDialog')?.addEventListener('click', () => this.close());

    // Browse destination
    this.querySelector('#btnBrowseDestination')?.addEventListener('click', async () => {
      const picked = await selectFolderDialog('Select Export Destination Folder', this.destinationPath || undefined);
      if (picked) {
        this.destinationPath = picked;
        const input = this.querySelector<HTMLInputElement>('#inputExportDestination');
        if (input) input.value = picked;
      }
    });

    // Destination input manual edit
    this.querySelector('#inputExportDestination')?.addEventListener('input', (e) => {
      this.destinationPath = (e.target as HTMLInputElement).value.trim();
    });

    // Format checkboxes
    this.querySelector('#chkFormatCsv')?.addEventListener('change', (e) => {
      this.exportCsv = (e.target as HTMLInputElement).checked;
    });
    this.querySelector('#chkFormatXlsx')?.addEventListener('change', (e) => {
      this.exportXlsx = (e.target as HTMLInputElement).checked;
    });
    this.querySelector('#chkFormatJson')?.addEventListener('change', (e) => {
      this.exportJson = (e.target as HTMLInputElement).checked;
    });
    this.querySelector('#chkFormatTxt')?.addEventListener('change', (e) => {
      this.exportTxt = (e.target as HTMLInputElement).checked;
    });

    // Image structure radio group
    this.querySelectorAll<HTMLInputElement>('input[name="imageStructure"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        const val = (e.target as HTMLInputElement).value as any;
        this.imageStructure = val;
        this.querySelectorAll('.export-option-card').forEach((card) => {
          card.classList.remove('active');
        });
        radio.closest('.export-option-card')?.classList.add('active');
      });
    });

    // Merge data checkbox
    this.querySelector('#chkMergeMasterData')?.addEventListener('change', (e) => {
      this.mergeData = (e.target as HTMLInputElement).checked;
    });

    // Execute Export
    this.querySelector('#btnStartExportDialog')?.addEventListener('click', async () => {
      await this.executeExport();
    });
  }

  private async executeExport(): Promise<void> {
    const input = this.querySelector<HTMLInputElement>('#inputExportDestination');
    const dest = input?.value.trim() || this.destinationPath;

    if (!dest) {
      const picked = await selectFolderDialog('Select Export Destination Folder');
      if (!picked) {
        showToast('Please select an export destination folder.');
        return;
      }
      // Fill the destination only; the user still reviews the export options and clicks Export.
      this.destinationPath = picked;
      if (input) input.value = picked;
      return;
    }

    if (!this.exportCsv && !this.exportXlsx && !this.exportJson && !this.exportTxt) {
      showToast('Please select at least one data report format (.csv, .xlsx, .json, or .txt).');
      return;
    }

    this.destinationPath = dest;
    this.isExporting = true;
    this.render();

    const isDataOnly = this.imageStructure === 'none';
    const exportType = isDataOnly ? 'data_only' : 'full';

    try {
      const opts: ExportOptions = {
        exportType,
        destinationPath: this.destinationPath,
        mergeData: this.mergeData,
        exportCsv: this.exportCsv,
        exportXlsx: this.exportXlsx,
        exportJson: this.exportJson,
        exportTxt: this.exportTxt,
        imageStructure: this.imageStructure,
      };
      let res: ExportResult;
      if (this.batchNames.length === 1) {
        res = await ipc.exportBatch(this.batchNames[0], opts);
      } else {
        res = await ipc.exportCombinedBatches(this.batchNames, opts);
        projectStore.selectedBatchNames.clear();
      }

      this.isExporting = false;
      this.exportResult = res;
      this.render();
    } catch (err: any) {
      this.isExporting = false;
      showToast(`Export failed: ${err.message || err}`);
      this.render();
    }
  }
}

customElements.define('batch-export-modal', BatchExportModal);

declare global {
  interface HTMLElementTagNameMap {
    'batch-export-modal': BatchExportModal;
  }
}
