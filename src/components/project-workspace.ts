import './project-batches';
import './project-classify';
import './project-insights';
import './project-keymap';
import './project-settings';
import './project-help';
import './batch-export-modal';
import type { BatchExportModal } from './batch-export-modal';
import { projectStore, type ProjectTab } from '../store/project-store';
import { icon } from '../services/icons';
import { html, escapeHtml } from '../utils';

export class ProjectWorkspace extends HTMLElement {
  private unsubscribe: (() => void) | null = null;
  private currentRenderedTab: ProjectTab | null = null;
  private currentBatchName: string | null = null;

  connectedCallback(): void {
    this.unsubscribe = projectStore.subscribe(() => this.handleStoreUpdate());
    this.render();
  }

  disconnectedCallback(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private handleStoreUpdate(): void {
    const nextTab = projectStore.activeTab;
    const nextBatch = projectStore.activeBatchName;

    // Only remount the sub-page if activeTab or activeBatchName changed
    if (nextTab !== this.currentRenderedTab || nextBatch !== this.currentBatchName) {
      this.currentRenderedTab = nextTab;
      this.currentBatchName = nextBatch;
      this.updateContentPane();
      this.mountActiveComponent();
    }

    this.updateCompletionPrompt();
  }

  private render(): void {
    this.currentRenderedTab = projectStore.activeTab;
    this.currentBatchName = projectStore.activeBatchName;

    const isClassify = this.currentRenderedTab === 'classify';

    this.innerHTML = html`
      <div class="project-layout"
        style="display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; overflow: hidden;">
        <!-- Sub-Page Content Pane -->
        <main class="project-content-pane ${isClassify ? 'classify-mode' : ''}" id="projectContentPane">
          <!-- Active component mounted here dynamically -->
        </main>

        <!-- Completion Modal Container for Project Classify -->
        <div id="projectCompletionModalContainer"></div>
        <batch-export-modal id="projectWorkspaceExportModal"></batch-export-modal>
      </div>
    `;

    this.mountActiveComponent();
    this.updateCompletionPrompt();
  }

  /** Classify needs a fixed-height stage; every other sub-page scrolls. */
  private updateContentPane(): void {
    const pane = this.querySelector<HTMLElement>('#projectContentPane');
    if (!pane) return;
    if (this.currentRenderedTab === 'classify') {
      pane.style.overflow = 'hidden';
    } else {
      pane.style.overflowY = 'auto';
    }
  }

  private mountActiveComponent(): void {
    const pane = this.querySelector('#projectContentPane');
    if (!pane) return;

    const tab = this.currentRenderedTab || projectStore.activeTab;

    // Clear and mount only the active sub-component
    pane.innerHTML = '';
    let element: HTMLElement;
    switch (tab) {
      case 'batches':
        element = document.createElement('project-batches');
        break;
      case 'classify':
        element = document.createElement('project-classify');
        break;
      case 'insights':
        element = document.createElement('project-insights');
        break;
      case 'keymap':
        element = document.createElement('project-keymap');
        break;
      case 'settings':
        element = document.createElement('project-settings');
        break;
      case 'help':
        element = document.createElement('project-help');
        break;
      default:
        element = document.createElement('project-batches');
    }

    pane.appendChild(element);
  }

  private updateCompletionPrompt(): void {
    const container = this.querySelector('#projectCompletionModalContainer');
    if (!container) return;

    if (!projectStore.showCompletionPrompt || projectStore.activeTab !== 'classify') {
      container.innerHTML = '';
      return;
    }

    if (container.querySelector('.modal-backdrop')) {
      return;
    }

    const batchName = projectStore.activeBatchName || 'Batch';
    const total = projectStore.activeBatchMedia?.items.length || 0;

    container.innerHTML = html`
      <div class="modal-backdrop" style="background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(4px);">
        <div class="modal-dialog" style="max-width: 460px; text-align: center; border-radius: var(--radius-xl, 16px); overflow: hidden; box-shadow: 0 20px 40px -8px rgba(0,0,0,0.4);">
          <div class="modal-body" style="align-items: center; padding: var(--space-6) var(--space-6) var(--space-4);">
            <div style="width: 52px; height: 52px; border-radius: 50%; background: rgba(34, 197, 94, 0.12); border: 2px solid rgba(34, 197, 94, 0.28); display: flex; align-items: center; justify-content: center; margin-bottom: var(--space-3); color: #22c55e;">
              ${icon('check', { size: 30 })}
            </div>
            <h2 style="font-size: var(--text-xl, 20px); font-weight: 700; color: var(--color-text-main); margin: 0 0 var(--space-1);">
              Batch Classification Complete!
            </h2>
            <p style="color: var(--color-text-muted); font-size: var(--text-sm); line-height: 1.5; margin: 0 0 var(--space-5);">
              All <strong>${total}</strong> photos in <strong>${escapeHtml(batchName)}</strong> are classified and saved.
              Where would you like to go next?
            </p>

            <div style="display: flex; flex-direction: column; gap: var(--space-3); width: 100%;">
              <button id="btnBackToProjectsPrompt" class="btn-primary" style="display: flex; align-items: center; justify-content: space-between; padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); font-weight: 600; cursor: pointer; text-align: left; width: 100%;">
                <div style="display: flex; align-items: center; gap: var(--space-3);">
                  <span style="display: flex;">${icon('box-seam', { size: 20 })}</span>
                  <div>
                    <div style="font-size: var(--text-sm); font-weight: 600;">Go to Project Library</div>
                    <div style="font-size: 11px; font-weight: 400; opacity: 0.85;">View all batches, progress & status</div>
                  </div>
                </div>
                <span style="font-size: 16px; font-weight: bold; margin-left: auto;">&rarr;</span>
              </button>

              <button id="btnGoToInsightsPrompt" class="btn-secondary" style="display: flex; align-items: center; justify-content: space-between; padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); font-weight: 600; cursor: pointer; text-align: left; width: 100%; border: 1px solid var(--color-border); background: var(--color-bg-surface-raised);">
                <div style="display: flex; align-items: center; gap: var(--space-3);">
                  <span style="display: flex; color: #6366f1;">${icon('insights', { size: 20 })}</span>
                  <div>
                    <div style="font-size: var(--text-sm); font-weight: 600; color: var(--color-text-main);">Go to Insights</div>
                    <div style="font-size: 11px; font-weight: 400; color: var(--color-text-muted);">Explore species breakdown, charts & trends</div>
                  </div>
                </div>
                <span style="font-size: 16px; font-weight: bold; color: var(--color-text-muted); margin-left: auto;">&rarr;</span>
              </button>
            </div>
          </div>

          <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center; padding: var(--space-3) var(--space-5); background: var(--color-bg-base); border-top: 1px solid var(--color-border);">
            <button class="btn-ghost" id="btnExportBatchPrompt" style="font-size: var(--text-xs); color: var(--color-text-muted); display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3);">
              ${icon('table-export')} Export Batch...
            </button>
            <button class="btn-secondary" id="btnDismissProjectPrompt" style="font-size: var(--text-xs); padding: var(--space-2) var(--space-4); font-weight: 500;">
              Stay in Classify
            </button>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#btnDismissProjectPrompt')?.addEventListener('click', () => {
      projectStore.dismissCompletionPrompt();
    });
    container.querySelector('#btnBackToProjectsPrompt')?.addEventListener('click', () => {
      projectStore.dismissCompletionPrompt();
      projectStore.setActiveTab('batches');
    });
    container.querySelector('#btnGoToInsightsPrompt')?.addEventListener('click', () => {
      projectStore.dismissCompletionPrompt();
      projectStore.setActiveTab('insights');
    });
    container.querySelector('#btnExportBatchPrompt')?.addEventListener('click', () => {
      projectStore.dismissCompletionPrompt();
      const exportModal = this.querySelector<BatchExportModal>('#projectWorkspaceExportModal');
      if (batchName) {
        exportModal?.open([batchName]);
      }
    });
  }
}

customElements.define('project-workspace', ProjectWorkspace);

declare global {
  interface HTMLElementTagNameMap {
    'project-workspace': ProjectWorkspace;
  }
}
