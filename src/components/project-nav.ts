import { projectStore, type ProjectTab } from '../store/project-store';
import { icon } from '../services/icons';
import { html, escapeHtml } from '../utils';
import { enableDragScroll } from '../services/drag-scroll';

/** Project navigation for the top app bar: workspace tabs, then Settings and Guide. */
export class ProjectNav extends HTMLElement {
  private unsubscribe: (() => void) | null = null;
  private lastSignature = '';
  private cleanupScrolling: (() => void) | null = null;

  connectedCallback(): void {
    this.unsubscribe = projectStore.subscribe(() => {
      // The store notifies on every classification; only redraw when the nav itself changes.
      if (this.signature() !== this.lastSignature) this.render();
    });
    this.render();
  }

  disconnectedCallback(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.cleanupScrolling?.();
    this.cleanupScrolling = null;
  }

  private signature(): string {
    return `${projectStore.activeTab}|${projectStore.activeBatchName ?? ''}|${projectStore.batches.length}`;
  }

  private tabButton(tab: ProjectTab, iconName: string, label: string, opts: { utility?: boolean; extra?: string; title?: string; disabledTitle?: string } = {}): string {
    const active = projectStore.activeTab === tab;
    const disabled = opts.disabledTitle !== undefined;
    return `
      <button class="project-tab-btn ${active ? 'active' : ''}" data-tab="${tab}"
        ${disabled ? `disabled title="${escapeHtml(opts.disabledTitle ?? '')}"` : `title="${escapeHtml(opts.title ?? label)}"`}>
        <span>${icon(iconName)}</span>
        <span class="${opts.utility ? 'nav-label-utility' : ''}">${label}</span>
        ${opts.extra ?? ''}
      </button>`;
  }

  private render(): void {
    this.cleanupScrolling?.();
    this.lastSignature = this.signature();
    const batchName = projectStore.activeBatchName;
    const count = projectStore.batches.length;

    this.innerHTML = html`
      <nav class="project-nav" aria-label="Project navigation">
        <div class="project-nav-tabs">
          ${this.tabButton('batches', 'box-seam', 'Projects', {
            extra: count > 0 ? `<span class="badge badge-muted" style="font-size: 10px; padding: 1px 6px;">${count}</span>` : '',
          })}
          ${this.tabButton('classify', 'label-important',
            `Classify${batchName ? ` <span class="tab-batch-name">(${escapeHtml(batchName)})</span>` : ''}`,
            { title: batchName ? `Classify (${batchName})` : 'Classify', disabledTitle: batchName ? undefined : 'Select a folder from the Projects tab to classify' })}
          ${this.tabButton('insights', 'chart', 'Insights')}
          ${this.tabButton('keymap', 'keyboard', 'Species & Keys')}
        </div>
        <div class="project-nav-utils">
          ${this.tabButton('settings', 'settings', 'Settings', { utility: true })}
          ${this.tabButton('help', 'help', 'Guide', { utility: true })}
        </div>
      </nav>
    `;

    this.querySelectorAll<HTMLButtonElement>('.project-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const tab = btn.getAttribute('data-tab') as ProjectTab | null;
        if (tab) projectStore.setActiveTab(tab);
      });
    });

    const nav = this.querySelector<HTMLElement>('.project-nav');
    if (nav) {
      this.cleanupScrolling = enableDragScroll(nav, { fade: true });
      // Keep the active tab in view when the nav is scrolled.
      this.querySelector<HTMLElement>('.project-tab-btn.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }
}

/** Shows the current working folder in the top app bar. */
export class ProjectFolderBadge extends HTMLElement {
  private unsubscribe: (() => void) | null = null;
  private lastFolder: string | null | undefined;

  connectedCallback(): void {
    this.unsubscribe = projectStore.subscribe(() => {
      if (projectStore.workingFolder !== this.lastFolder) this.render();
    });
    this.render();
  }

  disconnectedCallback(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private render(): void {
    const folder = projectStore.workingFolder;
    this.lastFolder = folder;
    const folderName = folder ? (folder.split(/[/\\]/).filter(Boolean).pop() || folder) : null;

    this.innerHTML = folderName
      ? html`
        <span class="badge badge-muted folder-badge" title="${escapeHtml(folder)}">
          ${icon('folder-open')} ${escapeHtml(folderName)}
        </span>`
      : html`<span class="badge badge-warning" style="font-size: 11px;">No Working Folder Set</span>`;
  }
}

customElements.define('project-nav', ProjectNav);
customElements.define('project-folder-badge', ProjectFolderBadge);

declare global {
  interface HTMLElementTagNameMap {
    'project-nav': ProjectNav;
    'project-folder-badge': ProjectFolderBadge;
  }
}
