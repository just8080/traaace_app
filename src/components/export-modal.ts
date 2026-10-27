import { BaseModal } from './base-modal';
import { quickStore } from '../store/quick-store';
import { executeQuickExport, selectFolderDialog, openPath } from '../services/tauri-bridge';
import { icon } from '../services/icons';
import { html, escapeHtml } from '../utils';
import { showToast } from '../services/ui-scale';
import type { ExportConfig } from '../types';

export class ExportModal extends BaseModal {
  private destinationPath: string = '';
  private isExporting = false;
  private exportResult: { summary: string; destination: string; filesExported: number } | null = null;

  protected override canDismiss(): boolean {
    return !this.isExporting;
  }

  protected override onOpen(): void {
    this.exportResult = null;
    this.destinationPath = '';
  }

  protected render(): void {
    const total = quickStore.items.length;
    const classified = quickStore.classifiedCount;

    if (this.exportResult) {
      this.innerHTML = html`
        <div class="modal-backdrop">
          <div class="modal-dialog" role="dialog" aria-modal="true" aria-label="Export Complete">
            <div class="modal-header">
              <span class="inline-flex items-center gap-2 text-success font-bold">${icon('check')} Export Complete</span>
              <button type="button" class="btn-ghost btn-sm" id="btnCloseExportDone">${icon('close')}</button>
            </div>
            <div class="modal-body">
              <p class="text-md font-semibold text-success flex items-center gap-2">
                ${icon('check')} Files successfully exported!
              </p>
              <div class="bg-base p-3 rounded-md border text-sm">
                <p><strong>Destination:</strong> ${this.exportResult.destination}</p>
                <p class="mt-1"><strong>Summary:</strong> ${this.exportResult.summary}</p>
              </div>
              <p class="text-muted text-xs">
                This Quick Session is ephemeral. You can clear it now or keep reviewing.
              </p>
            </div>
            <div class="modal-footer flex justify-between items-center w-full">
              <button type="button" class="btn-secondary inline-flex items-center gap-2" id="btnOpenExportFolder">
                ${icon('folder-open')} Open Export Folder
              </button>
              <div class="flex items-center gap-2">
                <button type="button" class="btn-secondary" id="btnKeepReviewing">Keep Session Open</button>
                <button type="button" class="btn-primary" id="btnClearAndClose">Clear Session & Reset</button>
              </div>
            </div>
          </div>
        </div>
      `;

      this.querySelector('#btnCloseExportDone')?.addEventListener('click', () => this.close());
      this.querySelector('#btnKeepReviewing')?.addEventListener('click', () => this.close());
      this.querySelector('#btnClearAndClose')?.addEventListener('click', () => {
        quickStore.clearSession();
        this.dispatchEvent(new CustomEvent('session-closed', { bubbles: true, composed: true }));
        this.close();
      });
      this.querySelector('#btnOpenExportFolder')?.addEventListener('click', async () => {
        const dest = this.exportResult?.destination;
        if (dest) {
          try {
            await openPath(dest);
          } catch (err) {
            console.error('Failed to open export folder:', err);
            showToast(`Could not open folder: ${err}`);
          }
        }
      });
      return;
    }

    this.innerHTML = html`
      <div class="modal-backdrop">
        <div class="modal-dialog max-w-dialog" role="dialog" aria-modal="true" aria-label="Export Quick Session">
          <div class="modal-header">
            <span class="inline-flex items-center gap-2 font-bold">${icon('box-seam')} Export Quick Session</span>
            <button type="button" class="btn-ghost btn-sm" id="btnCloseExportModal">${icon('close')}</button>
          </div>
      
          <div class="modal-body">
            <div class="flex justify-between items-center bg-base p-3 rounded-md border">
              <div class="flex flex-col gap-1">
                <span>Session: <strong>${escapeHtml(quickStore.folderName)}</strong></span>
                <span class="text-xs text-muted">
                  Location / Site: <strong>${escapeHtml(quickStore.siteName || quickStore.folderName || 'Default')}</strong>
                </span>
              </div>
              <span class="badge badge-success">${classified} / ${total} Classified</span>
            </div>
      
            <!-- Destination Selection -->
            <div class="flex flex-col gap-1">
              <label class="font-semibold text-sm">Export Destination Folder:</label>
              <div class="flex gap-2">
                <input type="text" id="inputExportDest" value="${escapeHtml(this.destinationPath)}"
                  placeholder="Choose destination folder (click Browse...)" class="flex-1" />
                <button type="button" class="btn-secondary inline-flex items-center gap-1" id="btnBrowseExportDest">
                  ${icon('folder-open')} Browse...
                </button>
              </div>
            </div>
      
            <!-- Data Formats -->
            <div class="flex flex-col gap-2">
              <label class="font-semibold text-sm">Select Data Reports to Generate:</label>
              <div class="grid grid-cols-2 gap-2">
                <label class="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" id="chkExportXlsx" checked />
                  <span class="inline-flex items-center gap-1">${icon('chart')} Excel Workbook (.xlsx)</span>
                </label>
                <label class="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" id="chkExportCsv" checked />
                  <span class="inline-flex items-center gap-1">${icon('clipboard')} CSV Spreadsheet (.csv)</span>
                </label>
                <label class="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" id="chkExportTxt" checked />
                  <span class="inline-flex items-center gap-1">${icon('clipboard')} Text Summary Report (.txt)</span>
                </label>
                <label class="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" id="chkExportJson" />
                  <span class="inline-flex items-center gap-1">${icon('box-seam')} JSON Data (.json)</span>
                </label>
              </div>
            </div>
      
            <!-- Image File Actions -->
            <div class="flex flex-col gap-2 border-t pt-4">
              <label class="font-semibold text-sm">Image Handling:</label>
              <div class="flex flex-col gap-1">
                <label class="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="imageAction" value="none" />
                  <span>Do not move or copy images (Data reports only)</span>
                </label>
                <label class="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="imageAction" value="copy" checked />
                  <span>Copy images into export folder</span>
                </label>
                <label class="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="imageAction" value="move" />
                  <span>Move images (Cut from original card/folder)</span>
                </label>
              </div>
      
              <label class="flex items-center gap-2 text-sm mt-2 cursor-pointer">
                <input type="checkbox" id="chkOrganizeBySpecies" checked />
                <span>Sort images into subfolders named by species (e.g. <code>/Possum/</code>)</span>
              </label>
            </div>
          </div>
      
          <div class="modal-footer">
            <button type="button" class="btn-secondary" id="btnCancelExport">Cancel</button>
            <button type="button" class="btn-primary" id="btnExecuteExport" ${this.isExporting ? 'disabled' : ''}>
              ${this.isExporting ? 'Exporting...' : `${icon('table-export')} Start Export`}
            </button>
          </div>
        </div>
      </div>
    `;

    this.querySelector('#btnCloseExportModal')?.addEventListener('click', () => this.close());
    this.querySelector('#btnCancelExport')?.addEventListener('click', () => this.close());

    this.querySelector('#btnBrowseExportDest')?.addEventListener('click', async () => {
      const picked = await selectFolderDialog('Select Export Destination Folder');
      if (picked) {
        this.destinationPath = picked;
        const input = this.querySelector<HTMLInputElement>('#inputExportDest');
        if (input) input.value = picked;
      }
    });

    this.querySelector<HTMLInputElement>('#inputExportDest')?.addEventListener('input', (e) => {
      this.destinationPath = (e.target as HTMLInputElement).value.trim();
    });

    this.querySelector('#btnExecuteExport')?.addEventListener('click', async () => {
      const destInput = this.querySelector<HTMLInputElement>('#inputExportDest');
      const dest = destInput?.value.trim() || this.destinationPath;

      if (!dest) {
        const picked = await selectFolderDialog('Select Export Destination Folder');
        if (!picked) {
          showToast('Please select an export destination folder.');
          return;
        }
        // Fill the destination only; the user still reviews the export options and clicks Export.
        this.destinationPath = picked;
        if (destInput) destInput.value = picked;
        return;
      }

      const exportXlsx = (this.querySelector('#chkExportXlsx') as HTMLInputElement)?.checked ?? true;
      const exportCsv = (this.querySelector('#chkExportCsv') as HTMLInputElement)?.checked ?? true;
      const exportTxt = (this.querySelector('#chkExportTxt') as HTMLInputElement)?.checked ?? true;
      const exportJson = (this.querySelector('#chkExportJson') as HTMLInputElement)?.checked ?? false;
      const organizeBySpecies = (this.querySelector('#chkOrganizeBySpecies') as HTMLInputElement)?.checked ?? true;

      const actionRadio = this.querySelector<HTMLInputElement>('input[name="imageAction"]:checked');
      const imageAction = (actionRadio?.value || 'copy') as 'none' | 'copy' | 'move';

      const config: ExportConfig = {
        destinationPath: dest,
        exportXlsx,
        exportCsv,
        exportTxt,
        exportJson,
        imageAction,
        organizeBySpecies,
        site: quickStore.siteName || quickStore.folderName || 'Default',
        folderName: quickStore.folderName || 'Quick_Session',
      };

      this.isExporting = true;
      this.render();

      try {
        const res = await executeQuickExport(quickStore.items, config);
        this.exportResult = res;
      } catch (err) {
        showToast(`Export failed: ${err}`);
      } finally {
        this.isExporting = false;
        this.render();
      }
    });
  }
}

customElements.define('export-modal', ExportModal);

declare global {
  interface HTMLElementTagNameMap {
    'export-modal': ExportModal;
  }
}
