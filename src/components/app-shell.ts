import { revealWindow } from '../services/startup';
import './quick-workspace';
import './project-workspace';
import './welcome-modal';
import './guide-modal';
import './project-nav';
import type { WelcomeModal, WelcomeSelectEventDetail } from './welcome-modal';
import type { GuideModal } from './guide-modal';
import { getShowWelcomeOnStartup } from '../services/welcome-pref';
import { quickStore } from '../store/quick-store';
import { projectStore } from '../store/project-store';
import { isTauriEnvironment, selectFolderDialog, askConfirm, ipc } from '../services/tauri-bridge';
import { toggleFullscreen } from '../services/fullscreen';
import { initUiScale, applyZoom, getSavedUiScale, showToast } from '../services/ui-scale';
import { icon } from '../services/icons';
import { html } from '../utils';
import { kakapoLogoUrl, KAKAPO_CREDIT_TEXT } from '../services/credits';
import { APP_VERSION } from '../services/app-info';
import type { WorkspaceMode } from '../types';

export class AppShell extends HTMLElement {
  private activeMode: WorkspaceMode = 'project';
  private currentTheme: 'dark' | 'light' = 'dark';
  private keydownListener: ((e: KeyboardEvent) => void) | null = null;
  private selectModeListener: ((e: Event) => void) | null = null;
  private openWelcomeListener: (() => void) | null = null;

  connectedCallback(): void {
    // Restore theme from localStorage
    const savedTheme = localStorage.getItem('traaace_theme') as 'dark' | 'light' | null;
    if (savedTheme) {
      this.currentTheme = savedTheme;
    }
    document.documentElement.setAttribute('data-theme', this.currentTheme);

    // Initialize UI scaling from previous app settings
    initUiScale();

    this.setupGlobalShortcuts();

    this.selectModeListener = async (e: Event) => {
      const detail = (e as CustomEvent<WelcomeSelectEventDetail>).detail;
      if (!detail) return;

      if (detail.mode === 'quick') {
        this.setWorkspaceMode('quick');
      } else if (detail.mode === 'project') {
        this.setWorkspaceMode('project');
        if (detail.promptFolder && !projectStore.workingFolder) {
          try {
            const folder = await selectFolderDialog('Select Project Working Folder');
            if (folder) {
              await projectStore.setWorkingFolder(folder);
            }
          } catch (err) {
            console.error('Error selecting working folder from welcome modal:', err);
          }
        }
      }
    };
    this.addEventListener('select-mode', this.selectModeListener);

    // Closing a Quick session, or "Switch workspace" in Settings, brings the workspace chooser back.
    this.openWelcomeListener = () => this.openWelcomeModal();
    this.addEventListener('session-closed', this.openWelcomeListener);
    this.addEventListener('open-welcome', this.openWelcomeListener);

    this.render();

    // The welcome screen is where the workspace is chosen, so it opens on every launch unless turned off in Settings.
    // The window is shown only once this first screen (with the welcome dialog, if any) is in place.
    if (getShowWelcomeOnStartup()) {
      setTimeout(() => {
        this.openWelcomeModal();
        void revealWindow();
      }, 120);
    } else {
      void revealWindow();
    }
  }

  disconnectedCallback(): void {
    if (this.keydownListener) {
      window.removeEventListener('keydown', this.keydownListener);
      this.keydownListener = null;
    }
    if (this.selectModeListener) {
      this.removeEventListener('select-mode', this.selectModeListener);
      this.selectModeListener = null;
    }
    if (this.openWelcomeListener) {
      this.removeEventListener('session-closed', this.openWelcomeListener);
      this.removeEventListener('open-welcome', this.openWelcomeListener);
      this.openWelcomeListener = null;
    }
  }

  private setupGlobalShortcuts(): void {
    this.keydownListener = (e: KeyboardEvent) => {
      // F11 toggles full screen (hides the window's title bar).
      if (e.key === 'F11' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        void toggleFullscreen().then(on => {
          if (on !== null) showToast(on ? 'Full screen: press F11 to exit' : 'Full screen off');
        });
        return;
      }

      // Zoom shortcuts: Cmd/Ctrl/Win + (+, -, 0)
      if (e.metaKey || e.ctrlKey) {
        if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd' || e.code === 'Equal') {
          e.preventDefault();
          const newScale = applyZoom(getSavedUiScale() + 0.1, true);
          showToast(`Zoom: ${Math.round(newScale * 100)}%`);
        } else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract' || e.code === 'Minus') {
          e.preventDefault();
          const newScale = applyZoom(getSavedUiScale() - 0.1, true);
          showToast(`Zoom: ${Math.round(newScale * 100)}%`);
        } else if (e.key === '0' || e.code === 'Numpad0' || e.code === 'Digit0') {
          e.preventDefault();
          applyZoom(1.0, true);
          showToast('Zoom reset to 100%');
        }
      }
    };

    window.addEventListener('keydown', this.keydownListener);
  }

  public async setWorkspaceMode(mode: WorkspaceMode): Promise<void> {
    if (this.activeMode === mode) return;

    // Safety check if leaving dirty quick session
    if (this.activeMode === 'quick' && quickStore.isDirty) {
      const confirmSwitch = await askConfirm(
        `You have ${quickStore.classifiedCount} classified photos in your Quick session.\n\nSwitching workspace will not export them. Are you sure you want to switch?`,
        { title: 'Switch Workspace', kind: 'warning' }
      );
      if (!confirmSwitch) return;
    }

    this.activeMode = mode;
    this.render();
  }

  private toggleTheme(): void {
    this.currentTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', this.currentTheme);
    localStorage.setItem('traaace_theme', this.currentTheme);
    this.render();
  }

  private render(): void {
    const isQuick = this.activeMode === 'quick';

    this.innerHTML = html`
      <header class="shell-header" data-tauri-drag-region>
        <div class="brand-section" data-tauri-drag-region>
          <div class="brand-title" data-tauri-drag-region>
            <img class="brand-logo" src="${kakapoLogoUrl}" alt="Kakapo" title="${KAKAPO_CREDIT_TEXT}" draggable="false" />
            <span>TRAAACE</span>
            <span class="brand-tag">v${APP_VERSION}</span>
          </div>

          ${isQuick ? '' : '<project-folder-badge data-no-drag></project-folder-badge>'}
        </div>

        <div class="shell-actions" data-no-drag>
          ${isQuick
            ? html`<button class="btn-ghost" id="btnShowGuide" title="Guide">${icon('help')} Guide</button>`
            : '<project-nav></project-nav>'}
          <button class="btn-ghost" id="btnToggleTheme" title="Toggle Dark/Light Theme">
            ${this.currentTheme === 'dark' ? `${icon('sun')} Light` : `${icon('moon')} Dark`}
          </button>
        </div>
      </header>

      <div class="shell-content">
        ${isQuick ? '<quick-workspace></quick-workspace>' : '<project-workspace></project-workspace>'}
      </div>

      <welcome-modal id="welcomeModal"></welcome-modal>
      <guide-modal id="guideModal"></guide-modal>
    `;

    // Interactive event listeners
    this.querySelector('#btnShowGuide')?.addEventListener('click', () => {
      this.querySelector<GuideModal>('#guideModal')?.open();
    });
    this.querySelector('#btnToggleTheme')?.addEventListener('click', () => this.toggleTheme());

    // Native window dragging on header mousedown
    const header = this.querySelector<HTMLElement>('.shell-header');
    header?.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('button, input, select, a, [data-no-drag]')) return;
      if (isTauriEnvironment()) {
        ipc.startDrag().catch(() => { });
      }
    });
  }

  public openWelcomeModal(): void {
    const modal = this.querySelector<WelcomeModal>('#welcomeModal');
    modal?.open();
  }
}

customElements.define('app-shell', AppShell);

declare global {
  interface HTMLElementTagNameMap {
    'app-shell': AppShell;
  }
}
