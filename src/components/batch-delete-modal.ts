import { showToast } from '../services/ui-scale';
import { BaseModal } from './base-modal';
import { projectStore } from '../store/project-store';
import { icon } from '../services/icons';
import { html, escapeHtml } from '../utils';

export class BatchDeleteModal extends BaseModal {
  private batchNames: string[] = [];
  private deleteLocalFiles = false;
  private isDeleting = false;

  protected override canDismiss(): boolean {
    return !this.isDeleting;
  }

  public open(batchNames: string[]): void {
    if (!batchNames || batchNames.length === 0) return;
    this.batchNames = [...batchNames];
    this.deleteLocalFiles = false;
    this.isDeleting = false;
    super.open();
  }

  protected override onClose(): void {
    this.batchNames = [];
  }

  protected render(): void {
    if (this.batchNames.length === 0) {
      this.innerHTML = '';
      return;
    }

    const isSingle = this.batchNames.length === 1;
    const title = isSingle
      ? `Remove Folder "${this.batchNames[0]}"?`
      : `Remove ${this.batchNames.length} Selected Folders?`;
    const folderTargetText = isSingle ? 'this folder' : 'these folders';

    if (this.isDeleting) {
      this.innerHTML = html`
        <div class="modal-backdrop">
          <div class="modal-dialog max-w-dialog text-center" role="dialog" aria-modal="true" aria-label="Removing Batches">
            <div class="modal-header">
              <span class="inline-flex items-center gap-2">${icon('refresh')} Removing Batches...</span>
            </div>
            <div class="modal-body p-6 items-center">
              <div class="export-spinner" style="border-top-color: var(--color-danger);"></div>
              <p class="font-semibold text-md mt-4">
                Removing ${this.batchNames.length} batch(es)...
              </p>
              <p class="text-muted text-xs mt-2">
                Please wait while database records ${this.deleteLocalFiles ? 'and disk files ' : ''}are updated.
              </p>
            </div>
          </div>
        </div>
      `;
      return;
    }

    // Lookup batches from store for summary
    const batchDetails = this.batchNames.map(name => {
      return projectStore.batches.find(b => b.name === name) || {
        name,
        site: name,
        totalImages: 0,
        classifiedCount: 0,
      };
    });

    const totalPhotos = batchDetails.reduce((sum, b) => sum + (b.totalImages || 0), 0);
    const totalClassified = batchDetails.reduce((sum, b) => sum + (b.classifiedCount || 0), 0);

    this.innerHTML = html`
      <div class="modal-backdrop">
        <div class="modal-dialog max-w-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
          <div class="modal-header">
            <span class="font-bold flex items-center gap-2 text-danger">
              ${icon('trash')} ${escapeHtml(title)}
            </span>
            <button type="button" class="btn-ghost btn-sm" id="btnCloseDeleteModal">${icon('close')}</button>
          </div>
      
          <div class="modal-body gap-4">
            <!-- Summary Info Box -->
            <div class="bg-base border rounded-md p-3 text-xs">
              ${isSingle ? html`
              <div class="flex justify-between items-center">
                <strong class="font-mono text-sm">${escapeHtml(this.batchNames[0])}</strong>
                <span class="badge badge-muted">${escapeHtml(batchDetails[0].site)}</span>
              </div>
              <div class="mt-2 text-muted">
                Contains <strong>${batchDetails[0].totalImages}</strong> photos (${batchDetails[0].classifiedCount} classified)
              </div>
              ` : html`
              <div class="flex justify-between items-center mb-2 font-semibold">
                <span>Selected Folders (${this.batchNames.length}):</span>
                <span class="text-muted">${totalPhotos} photos total (${totalClassified} classified)</span>
              </div>
              <div class="overflow-y-auto flex flex-col gap-1 pr-1" style="max-height: 120px;">
                ${batchDetails.map(b => html`
                <div class="flex justify-between p-1 bg-surface rounded-sm border">
                  <span class="font-mono">${escapeHtml(b.name)}</span>
                  <span class="text-muted">${b.totalImages} photos</span>
                </div>
                `)}
              </div>
              `}
            </div>
      
            <div class="text-xs text-muted" style="line-height: 1.5;">
              This will remove all classification history, annotations, and observation records from ${folderTargetText} and
              the TRAAACE database.
            </div>
      
            <!-- Optional: Delete files from disk checkbox -->
            <label class="flex items-start gap-3 p-3 rounded-md border cursor-pointer"
              style="background: rgba(239, 68, 68, 0.06); border-color: rgba(239, 68, 68, 0.25);">
              <input type="checkbox" id="chkDeleteDiskFiles" ${this.deleteLocalFiles ? 'checked' : ''}
                class="mt-1" />
              <div>
                <strong class="text-xs text-danger">
                  Also permanently delete raw image folder(s) from disk
                </strong>
                <p class="text-muted text-xs m-0 mt-1" style="line-height: 1.4;">
                  Reclaims disk space by completely removing the folder(s) from your storage. If unchecked, your original
                  photos remain untouched on disk.
                </p>
              </div>
            </label>
          </div>
      
          <div class="modal-footer flex justify-end gap-2">
            <button type="button" class="btn-secondary" id="btnCancelDelete">
              Cancel
            </button>
            <button type="button" class="btn-danger" id="btnConfirmDelete">
              ${icon('trash')} ${isSingle ? 'Remove Folder' : `Delete ${this.batchNames.length} Folders`}
            </button>
          </div>
        </div>
      </div>
    `;

    this.querySelector('#btnCloseDeleteModal')?.addEventListener('click', () => this.close());
    this.querySelector('#btnCancelDelete')?.addEventListener('click', () => this.close());

    this.querySelector('#chkDeleteDiskFiles')?.addEventListener('change', (e) => {
      this.deleteLocalFiles = (e.target as HTMLInputElement).checked;
    });

    this.querySelector('#btnConfirmDelete')?.addEventListener('click', async () => {
      await this.executeDelete();
    });
  }

  private async executeDelete(): Promise<void> {
    this.isDeleting = true;
    this.render();

    try {
      await projectStore.deleteBatches(this.batchNames, this.deleteLocalFiles);
      this.close();
    } catch (err: any) {
      this.isDeleting = false;
      showToast(`Failed to remove batch: ${err.message || err}`);
      this.render();
    }
  }
}

customElements.define('batch-delete-modal', BatchDeleteModal);

declare global {
  interface HTMLElementTagNameMap {
    'batch-delete-modal': BatchDeleteModal;
  }
}
