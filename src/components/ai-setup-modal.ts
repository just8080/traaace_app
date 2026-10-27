import { BaseModal } from './base-modal';
import { aiStore, type AiInstallPhase } from '../store/ai-store';
import { formatBytes, installStatusText, percentDone } from '../services/ai';
import { icon } from '../services/icons';
import { html, escapeHtml } from '../utils';

/**
 * Sets up the optional AI add-on in plain language: what it is, how big it is, where it goes, who made it, then
 * downloads and installs it with a progress bar. Anyone who already has the add-on can choose its folder instead.
 */
export class AiSetupModal extends BaseModal {
  private unsubscribe: (() => void) | null = null;
  private confirmingRemove = false;
  private renderedPhase: AiInstallPhase | null = null;

  protected override canDismiss(): boolean {
    return aiStore.install.phase !== 'installing' && aiStore.install.phase !== 'removing';
  }

  protected override onOpen(): void {
    this.renderedPhase = null;
    this.confirmingRemove = false;
    this.unsubscribe = aiStore.subscribe(() => this.refresh());
    // Look up the download straight away, so the size and credits are on screen when the dialog opens.
    aiStore.resetInstall();
    if (aiStore.install.phase === 'idle') {
      void aiStore.refreshStatus().then(() => {
        if (!aiStore.status?.installed) void aiStore.checkDownload();
      });
    }
  }

  protected override onClose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.renderedPhase = null;
  }

  /** Redraws on a change of step; while downloading only the bar and its text move, so buttons do not flicker. */
  private refresh(): void {
    if (!this.isOpen) return;
    if (this.renderedPhase === 'installing' && aiStore.install.phase === 'installing') {
      this.updateProgress();
      return;
    }
    this.render();
  }

  private updateProgress(): void {
    const p = aiStore.install.progress;
    const bar = this.querySelector<HTMLElement>('#aiInstallBar');
    const line = this.querySelector('#aiInstallLine');
    const amount = this.querySelector('#aiInstallAmount');
    if (!p || !bar || !line || !amount) return;
    bar.style.width = `${percentDone(p.bytesDone, p.bytesTotal)}%`;
    line.textContent = installStatusText(p);
    amount.textContent = `${formatBytes(p.bytesDone)} of ${formatBytes(p.bytesTotal)}`;
  }

  protected render(): void {
    const status = aiStore.status;
    const { phase, info, message } = aiStore.install;
    this.renderedPhase = phase;
    const installed = status?.installed ?? false;
    const upToDate = installed && info !== null && info.version === status?.version;

    let body: string;
    let footer: string;

    const canRemove = installed && (status?.managed ?? false);
    const removeButton = canRemove ? '<button type="button" class="btn-secondary" id="btnAiRemove" style="margin-right: auto;">Remove the add-on…</button>' : '';

    if (phase === 'removing') {
      body = '<p class="text-sm m-0">Removing the AI add-on…</p>';
      footer = '';
    } else if (phase === 'removed') {
      body = html`
        ${this.tick('<strong>The AI add-on has been removed.</strong>')}
        <p class="text-sm text-muted m-0">Its files are gone from this computer. You can download it again whenever you like.</p>`;
      footer = '<button type="button" class="btn-primary" id="btnAiDone">Done</button>';
    } else if (this.confirmingRemove && canRemove) {
      body = html`
        <p class="text-sm m-0"><strong>Remove the AI add-on?</strong></p>
        <p class="text-sm m-0">This deletes its files from this computer and frees up the disk space. Your photos, tags and exports are not affected, and you can download it again at any time.</p>`;
      footer = html`<button type="button" class="btn-secondary" id="btnAiKeep">Keep it</button>
        <button type="button" class="btn-danger" id="btnAiConfirmRemove">${icon('trash')} Remove</button>`;
    } else if (phase === 'installing') {
      const p = aiStore.install.progress;
      body = html`
        <p class="text-sm m-0">Please keep TRAAACE open while this downloads. It can take a few minutes.</p>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div class="text-sm" id="aiInstallLine">${escapeHtml(p ? installStatusText(p) : 'Starting…')}</div>
          <div style="height: 8px; border-radius: 4px; background: var(--color-border); overflow: hidden;">
            <div id="aiInstallBar" style="height: 100%; width: ${p ? percentDone(p.bytesDone, p.bytesTotal) : 0}%; background: var(--color-brand); transition: width 0.2s;"></div>
          </div>
          <div class="text-xs text-muted" id="aiInstallAmount">${p ? `${formatBytes(p.bytesDone)} of ${formatBytes(p.bytesTotal)}` : ''}</div>
        </div>`;
      footer = '<button type="button" class="btn-secondary" id="btnAiCancelInstall">Cancel</button>';
    } else if (phase === 'done') {
      body = html`
        ${this.tick('<strong>The AI add-on is installed and ready.</strong>')}
        <p class="text-sm text-muted m-0">Open a folder of photos and press <strong>Scan</strong> to try it.</p>`;
      footer = '<button type="button" class="btn-primary" id="btnAiDone">Done</button>';
    } else if (phase === 'error') {
      body = html`
        <p class="text-sm m-0"><strong>That didn't work.</strong></p>
        <p class="text-sm m-0">${escapeHtml(message)}</p>`;
      footer = html`<button type="button" class="btn-secondary" id="btnAiClose">Close</button>
        <button type="button" class="btn-primary" id="btnAiRetry">Try again</button>`;
    } else if (phase === 'checking') {
      body = '<p class="text-sm text-muted m-0">Checking what is available…</p>';
      footer = '<button type="button" class="btn-secondary" id="btnAiClose">Close</button>';
    } else if (upToDate) {
      body = html`
        ${this.tick(`<strong>You have the latest AI add-on</strong> (version ${escapeHtml(status?.version ?? '')}).`)}
        ${this.whereBlock(status?.packDir ?? status?.installDir ?? '', canRemove)}`;
      footer = `${removeButton}<button type="button" class="btn-primary" id="btnAiDone">Done</button>`;
    } else if (info) {
      body = html`
        <p class="text-sm m-0">${installed ? '<strong>A newer AI add-on is available.</strong>' : 'This is a free add-on. TRAAACE downloads it once, then it works without the internet.'}</p>
        <div class="text-sm" style="display: flex; flex-direction: column; gap: 4px; padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius-sm);">
          <div><strong>What:</strong> ${escapeHtml(info.modelName)}, version ${escapeHtml(info.version)}</div>
          <div><strong>Size:</strong> ${formatBytes(info.downloadBytes)} to download (${formatBytes(info.unpackedBytes)} on your disk once installed)</div>
          <div><strong>Where:</strong> <span class="font-mono text-xs">${escapeHtml(status?.installDir ?? '')}</span></div>
        </div>
        <p class="text-xs text-muted m-0">You can remove it again from this window. Your photos and videos are never uploaded.</p>
        ${this.creditsBlock(info.credits, info.licenses, status?.licenseNote ?? '')}
        ${info.requiresAcceptance ? '<p class="text-xs text-muted m-0">By downloading you agree to the licences listed under Credits and licences.</p>' : ''}`;
      footer = html`<button type="button" class="btn-secondary" id="btnAiClose">Not now</button>
        <button type="button" class="btn-primary" id="btnAiInstall">${icon('check')} Download and install (${formatBytes(info.downloadBytes)})</button>`;
    } else if (installed) {
      body = html`
        ${this.tick('<strong>The AI add-on is installed.</strong>')}
        ${this.whereBlock(status?.packDir ?? '', canRemove)}`;
      footer = html`${removeButton}<button type="button" class="btn-secondary" id="btnAiCheck">Check for updates</button>
        <button type="button" class="btn-primary" id="btnAiDone">Done</button>`;
    } else {
      body = '<p class="text-sm m-0">Checking what is available…</p>';
      footer = '<button type="button" class="btn-secondary" id="btnAiClose">Close</button>';
    }

    const intro = phase === 'installing' || phase === 'done'
      ? ''
      : '<p class="text-sm m-0">TRAAACE can look at your photos and videos and suggest which species is in each one, and how many animals. It all happens on this computer.</p>';

    this.innerHTML = html`
      <div class="modal-backdrop">
        <div class="modal-dialog max-w-dialog" role="dialog" aria-modal="true" aria-label="AI species suggestions">
          <div class="modal-header">
            <span class="inline-flex items-center gap-2 font-semibold">${icon('paw')} AI species suggestions</span>
            ${phase === 'installing' ? '' : `<button type="button" class="btn-ghost btn-sm" id="btnAiClose2" title="Close">${icon('close')}</button>`}
          </div>
          <div class="modal-body">${intro}${body}</div>
          <div class="modal-footer flex justify-end gap-2 bg-base">${footer}</div>
        </div>
      </div>
    `;
    this.bind();
  }

  /** A tick and a line of text side by side. */
  private tick(text: string): string {
    return `<p class="text-sm m-0" style="display: flex; align-items: center; gap: 8px;">${icon('check')}<span>${text}</span></p>`;
  }

  /** Where the add-on is. One TRAAACE downloaded has a Remove button; a folder chosen by hand is removed by deleting it. */
  private whereBlock(dir: string, canRemove: boolean): string {
    if (!dir) return '';
    const removal = canRemove ? 'To remove it, use <strong>Remove the add-on…</strong> below.' : 'To remove it, delete that folder.';
    return `<p class="text-xs text-muted m-0">It is saved in <span class="font-mono">${escapeHtml(dir)}</span>. ${removal}</p>`;
  }

  private creditsBlock(credits: string[], licenses: string[], note: string): string {
    return html`
      <details>
        <summary class="text-xs font-semibold" style="cursor: pointer;">Credits and licences</summary>
        <ul class="text-xs m-0" style="padding-left: 1.1rem; margin-top: 6px; display: flex; flex-direction: column; gap: 4px;">
          ${credits.map(c => `<li>${escapeHtml(c)}</li>`).join('')}
        </ul>
        <p class="text-xs text-muted" style="margin: 6px 0 0;">${escapeHtml(licenses.length ? `Licences: ${licenses.join('; ')}.` : note)}</p>
      </details>`;
  }

  private bind(): void {
    const on = (id: string, fn: () => void) => this.querySelector(`#${id}`)?.addEventListener('click', fn);
    ['btnAiClose', 'btnAiClose2', 'btnAiDone'].forEach(id => on(id, () => this.close()));
    on('btnAiInstall', () => void aiStore.startInstall());
    on('btnAiCancelInstall', () => aiStore.cancelInstall());
    on('btnAiRetry', () => void aiStore.checkDownload());
    on('btnAiCheck', () => void aiStore.checkDownload());
    on('btnAiRemove', () => { this.confirmingRemove = true; this.render(); });
    on('btnAiKeep', () => { this.confirmingRemove = false; this.render(); });
    on('btnAiConfirmRemove', () => { this.confirmingRemove = false; void aiStore.removeAddOn(); });
  }
}

customElements.define('ai-setup-modal', AiSetupModal);
