import { BaseModal } from './base-modal';
import { projectStore } from '../store/project-store';
import { quickStore } from '../store/quick-store';
import { icon } from '../services/icons';
import { html, escapeHtml } from '../utils';

export class SiteEditorModal extends BaseModal {
  private batchName: string | null = null;
  private currentSite = '';
  private mode: 'project' | 'quick' = 'project';

  public open(batchName: string, currentSite?: string, mode: 'project' | 'quick' = 'project'): void {
    this.mode = mode;
    this.batchName = batchName;
    if (mode === 'quick') {
      this.currentSite = currentSite !== undefined ? currentSite : (quickStore.siteName || quickStore.folderName || '');
    } else {
      const batch = projectStore.batches.find(b => b.name === batchName);
      this.currentSite = currentSite !== undefined ? currentSite : (batch?.site || '');
    }
    super.open();
  }

  protected override onClose(): void {
    this.batchName = null;
  }

  protected render(): void {
    if (!this.batchName) {
      this.innerHTML = '';
      return;
    }

    const batchName = this.batchName;
    const currentSite = this.currentSite;

    // Collect distinct existing sites across the project for 1-click reuse
    const existingSites = Array.from(
      new Set(
        projectStore.batches
          .map(b => (b.site || '').trim())
          .filter(s => s.length > 0 && s !== currentSite)
      )
    ).slice(0, 10);

    this.innerHTML = html`
      <div class="modal-backdrop">
        <div class="modal-dialog max-w-dialog" role="dialog" aria-modal="true" aria-label="Edit Location and Site">
          <div class="modal-header">
            <span class="inline-flex items-center gap-2 font-semibold">
              Edit Location / Site
            </span>
            <button type="button" class="btn-ghost btn-sm" id="btnCloseSiteModal" title="Close">
              ${icon('close')}
            </button>
          </div>

          <div class="modal-body">
            <p class="text-muted text-sm m-0">
              Assign or rename the deployment location for <strong class="text-main font-mono">${escapeHtml(batchName)}</strong>.
            </p>

            <div class="flex flex-col gap-1">
              <label class="text-xs font-semibold text-muted" style="text-transform: uppercase;">
                Site / Location Name
              </label>
              <input
                type="text"
                id="inputBatchSite"
                value="${escapeHtml(currentSite)}"
                placeholder="e.g. site_EFH, Pukekura Ridge, Station 04"
                class="text-sm font-semibold px-3 py-2"
                autocomplete="off"
              />
            </div>

            ${existingSites.length > 0 ? html`
              <div class="flex flex-col gap-1">
                <span class="text-xs font-semibold text-muted">
                  Quick Pick Existing Sites:
                </span>
                <div class="flex flex-wrap gap-2">
                  ${existingSites.map(s => html`
                    <button
                      type="button"
                      class="btn-secondary btn-quick-pick-site btn-sm"
                      data-site="${escapeHtml(s)}"
                    >
                      ${escapeHtml(s)}
                    </button>
                  `).join('')}
                </div>
              </div>
            ` : ''}

            <p class="text-xs text-muted m-0 flex items-start gap-2">
              <span class="text-brand">${icon('check')}</span>
              <span>${this.mode === 'quick' ? 'Sets session location for export reports and data.' : 'Saves permanently to your project library and updates <code>_site.txt</code> in the image folder.'}</span>
            </p>
          </div>

          <div class="modal-footer flex justify-end gap-2 bg-base">
            <button type="button" class="btn-secondary" id="btnCancelSiteModal">Cancel</button>
            <button type="button" class="btn-primary" id="btnSaveSiteModal">
              Save Location
            </button>
          </div>
        </div>
      </div>
    `;

    const input = this.querySelector<HTMLInputElement>('#inputBatchSite');
    setTimeout(() => {
      input?.focus();
      input?.select();
    }, 50);

    // Click handler for quick-pick chips
    this.querySelectorAll('.btn-quick-pick-site').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const siteVal = (e.currentTarget as HTMLElement).getAttribute('data-site');
        if (siteVal && input) {
          input.value = siteVal;
          input.focus();
        }
      });
    });

    const doSave = async () => {
      const newSite = input?.value.trim() || '';
      if (!newSite) {
        input?.focus();
        return;
      }
      if (this.mode === 'quick') {
        quickStore.setSiteName(newSite);
      } else {
        await projectStore.updateBatchSite(batchName, newSite);
      }
      this.close();
    };

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSave();
      }
    });

    this.querySelector('#btnCloseSiteModal')?.addEventListener('click', () => this.close());
    this.querySelector('#btnCancelSiteModal')?.addEventListener('click', () => this.close());
    this.querySelector('#btnSaveSiteModal')?.addEventListener('click', () => doSave());
  }
}

customElements.define('site-editor-modal', SiteEditorModal);

declare global {
  interface HTMLElementTagNameMap {
    'site-editor-modal': SiteEditorModal;
  }
}
