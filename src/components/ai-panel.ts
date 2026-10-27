import { aiStore } from '../store/ai-store';
import { projectAiHost, quickAiHost, type AiHost } from '../store/ai-hosts';
import { icon } from '../services/icons';
import {
  acceptedTag, confidenceLevel, formatPercent, isAiScannable, isAiVideo, reviewSuggestion, type AiReview,
} from '../services/ai';
import { showToast } from '../services/ui-scale';
import { html, escapeHtml } from '../utils';
import './ai-setup-modal';
import type { AiSetupModal } from './ai-setup-modal';

// What the app says when there's simply no add-on yet (src-tauri/src/ai/pack.rs, locate_first).
const NOT_INSTALLED = 'The AI add-on is not installed.';
const CARD = 'padding-bottom: var(--space-3); border-bottom: 1px solid var(--color-border); display: flex; flex-direction: column; gap: var(--space-2);';

/**
 * The AI suggestions panel in the Quick Classify sidebar. It stays hidden in builds without AI support, offers
 * set-up when the add-on is missing, and otherwise scans the session's photos and lets the reviewer accept suggestions.
 */
export class AiPanel extends HTMLElement {
  private unsubscribers: (() => void)[] = [];
  private host: AiHost = quickAiHost;

  connectedCallback(): void {
    this.host = this.getAttribute('mode') === 'project' ? projectAiHost : quickAiHost;
    this.innerHTML = '<div class="ai-body"></div><ai-setup-modal></ai-setup-modal>';
    this.unsubscribers = [aiStore.subscribe(() => this.render()), this.host.subscribe(() => this.render())];
    if (!aiStore.status) void aiStore.refreshStatus();
    this.render();
  }

  disconnectedCallback(): void {
    this.unsubscribers.forEach(off => off());
    this.unsubscribers = [];
  }

  private get body(): HTMLElement {
    return this.querySelector<HTMLElement>('.ai-body')!;
  }

  private reviewOf(id: string): AiReview | null {
    const s = aiStore.suggestions.get(id);
    return s ? reviewSuggestion(s, aiStore.threshold) : null;
  }

  /** Photos whose suggestion could be accepted in bulk: the user has not tagged them and the AI named something. */
  private bulkTags() {
    return this.host.items().flatMap(item => {
      if (item.classified) return [];
      const review = this.reviewOf(item.id);
      const tag = review && acceptedTag(review);
      return tag && review ? [{ id: item.id, ...tag, confidence: confidenceLevel(review.score) }] : [];
    });
  }

  private render(): void {
    const status = aiStore.status;
    this.style.display = status?.compiled ? '' : 'none';
    if (!status?.compiled) return;

    // Moving to another batch swaps in that batch's own suggestions.
    if (aiStore.scope !== this.host.scope()) {
      void aiStore.useScope(this.host.scope(), this.host.load);
      return;
    }

    const scan = aiStore.scan;
    let content: string;
    if (!status.installed) content = this.renderNotInstalled();
    else if (scan.phase === 'running') content = this.renderRunning();
    else if (aiStore.suggestions.size > 0) content = this.renderReview();
    else content = this.renderReady();

    this.body.innerHTML = html`
      <div style="${CARD}">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <span class="text-xs font-semibold text-muted" style="text-transform: uppercase;">AI suggestions (beta)</span>
          <button type="button" class="btn-ghost btn-sm" id="btnAiAbout" title="About the AI add-on and credits">${icon('help', { size: 14 })}</button>
        </div>
        ${content}
      </div>
    `;
    this.bind();
  }

  private renderNotInstalled(): string {
    // Microsoft publishes no ONNX Runtime for Intel Macs any more, so the add-on can't run there.
    if (aiStore.status?.platform === 'macos-x86_64') {
      return html`
        <p class="text-xs text-muted m-0">AI suggestions aren't available on Intel Macs yet. They need a Mac with Apple Silicon (M1 or newer), Windows or Linux.</p>
      `;
    }
    // Something was found but couldn't be used (a missing file, a test folder that's gone): say why.
    const problem = aiStore.status?.problem;
    const note =
      problem && problem !== NOT_INSTALLED
        ? `<p class="text-xs m-0" style="color: var(--color-danger, #dc2626);">${escapeHtml(problem)}</p>`
        : '';
    return html`
      <p class="text-xs text-muted m-0">Suggests the species and count for each photo, on this computer. Needs the optional AI add-on.</p>
      ${note}
      <button type="button" class="btn-secondary" id="btnAiSetup">Set up AI…</button>
    `;
  }

  private scannable() {
    const videos = aiStore.status?.videoTool ?? false;
    return this.host.items().filter(i => isAiScannable(i.filename, videos));
  }

  private renderReady(): string {
    const files = this.scannable();
    const videoCount = files.filter(i => isAiVideo(i.filename)).length;
    const photoCount = files.length - videoCount;
    const skipped = this.host.items().length - files.length;
    const what = [
      photoCount > 0 || videoCount === 0 ? `${photoCount} photo${photoCount === 1 ? '' : 's'}` : '',
      videoCount > 0 ? `${videoCount} video${videoCount === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' and ');
    const scan = aiStore.scan;
    const note =
      scan.phase === 'error' ? `<p class="text-xs m-0" style="color: var(--color-danger, #dc2626);">${escapeHtml(scan.message)}</p>` : '';
    return html`
      ${note}
      <button type="button" class="btn-primary" id="btnAiScan" ${files.length === 0 ? 'disabled' : ''}>
        ${icon('paw', { size: 14 })} Scan ${what} with AI
      </button>
      ${skipped > 0 ? `<p class="text-xs text-muted m-0">${skipped} video${skipped === 1 ? ' is' : 's are'} skipped; this AI add-on can only read photos.</p>` : ''}
    `;
  }

  private renderRunning(): string {
    const { total, done, failed, message } = aiStore.scan;
    const finished = done + failed;
    const pct = total > 0 ? Math.round((finished / total) * 100) : 0;
    return html`
      <div class="text-xs">${message ? escapeHtml(message) : `Scanning ${finished} of ${total}${failed ? ` (${failed} could not be read)` : ''}`}</div>
      <div style="height: 6px; border-radius: 3px; background: var(--color-border); overflow: hidden;">
        <div style="height: 100%; width: ${pct}%; background: var(--color-brand); transition: width 0.2s;"></div>
      </div>
      <button type="button" class="btn-secondary" id="btnAiCancel">Cancel</button>
    `;
  }

  private renderReview(): string {
    const scan = aiStore.scan;
    const activeId = this.host.activeId();
    const item = this.host.items().find(i => i.id === activeId);
    const suggestion = item ? aiStore.suggestions.get(item.id) : undefined;
    const review = item ? this.reviewOf(item.id) : null;
    const pending = this.bulkTags().length;

    const status =
      scan.phase === 'cancelled' ? `Stopped after ${scan.done} photos.` : `${aiStore.suggestions.size} photos scanned${scan.failed ? `, ${scan.failed} could not be read` : ''}.`;

    return html`
      <div class="text-xs text-muted">${escapeHtml(status)}</div>
      ${item ? this.renderActive(item.classified, review, suggestion?.alternatives ?? []) : ''}

      <button type="button" class="btn-primary" id="btnAiAcceptAll" ${pending === 0 ? 'disabled' : ''}>
        ${icon('check', { size: 14 })} Accept ${pending} suggestion${pending === 1 ? '' : 's'}
      </button>
      <div style="display: flex; gap: var(--space-2);">
        <button type="button" class="btn-secondary" id="btnAiScan" style="flex: 1;">Scan again</button>
        <button type="button" class="btn-ghost" id="btnAiClear" style="flex: 1;">Clear</button>
      </div>
    `;
  }

  private renderActive(isClassified: boolean, review: AiReview | null, alternatives: [string, number][]): string {
    if (!review) return '<div class="text-xs text-muted">No suggestion for this photo (it was not scanned).</div>';

    const headline =
      review.kind === 'species'
        ? `<strong>${escapeHtml(review.species)}</strong> ${formatPercent(review.score)}${review.count > 1 ? ` · ${review.count} animals` : ''}`
        : review.kind === 'empty'
          ? '<strong>Empty</strong>'
          : `<strong>Not sure</strong> · ${review.count} animal${review.count === 1 ? '' : 's'} seen`;

    const tag = acceptedTag(review);
    const accept = tag
      ? `<button type="button" class="btn-primary btn-sm" id="btnAiAccept">${icon('check', { size: 14 })} Accept${isClassified ? ' (replaces yours)' : ''}</button>`
      : '';
    const chips = alternatives
      .map(([name, score], i) => ({ name, score, i }))
      .filter(({ name, score, i }) => score >= 0.05 && name !== (review.kind === 'species' ? review.species : null) && i >= 0)
      .map(({ name, score, i }) => `<button type="button" class="btn-secondary btn-sm ai-alt" data-index="${i}">${escapeHtml(name)} ${formatPercent(score)}</button>`)
      .join('');

    return html`
      <div style="display: flex; flex-direction: column; gap: 6px; padding: var(--space-2); border: 1px solid var(--color-border); border-radius: var(--radius-sm);">
        <div class="text-sm">${headline}</div>
        ${accept}
        ${chips ? `<div style="display: flex; flex-wrap: wrap; gap: 4px;">${chips}</div>` : ''}
      </div>
    `;
  }

  private bind(): void {
    const on = (id: string, fn: () => void) => this.querySelector(`#${id}`)?.addEventListener('click', fn);
    const modal = () => this.querySelector<AiSetupModal>('ai-setup-modal');

    on('btnAiSetup', () => modal()?.open());
    on('btnAiAbout', () => modal()?.open());
    on('btnAiScan', () => {
      const files = this.scannable().map(i => ({ id: i.id, path: i.path }));
      void aiStore.startScan(files, this.host.knownSpecies(), this.host.save ?? null);
    });
    on('btnAiCancel', () => aiStore.cancelScan());
    on('btnAiClear', () => {
      aiStore.clear();
      void this.host.clearSaved?.();
    });

    on('btnAiAccept', () => {
      const id = this.host.activeId();
      const review = id && this.reviewOf(id);
      const tag = review && acceptedTag(review);
      if (review && tag) this.host.classifyActive(tag.species, confidenceLevel(review.score), tag.count);
    });

    this.querySelectorAll<HTMLButtonElement>('.ai-alt').forEach(btn =>
      btn.addEventListener('click', () => {
        const id = this.host.activeId();
        const suggestion = id ? aiStore.suggestions.get(id) : undefined;
        const alt = suggestion?.alternatives[Number(btn.dataset.index)];
        if (suggestion && alt) this.host.classifyActive(alt[0], confidenceLevel(alt[1]), Math.max(suggestion.animals, 1));
      })
    );

    on('btnAiAcceptAll', async () => {
      const applied = await this.host.applyTags(this.bulkTags());
      showToast(`Accepted ${applied} AI suggestion${applied === 1 ? '' : 's'}`);
    });
  }
}

customElements.define('ai-panel', AiPanel);
