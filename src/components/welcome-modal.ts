import { BaseModal } from './base-modal';
import { icon } from '../services/icons';
import { html } from '../utils';
import { getShowWelcomeOnStartup, setShowWelcomeOnStartup } from '../services/welcome-pref';
import { kakapoLogoUrl, kakapoCreditHtml, bindExternalLinks } from '../services/credits';
import type { WorkspaceMode } from '../types';

export interface WelcomeSelectEventDetail {
  mode: WorkspaceMode;
  promptFolder?: boolean;
}

export class WelcomeModal extends BaseModal {
  private handleSelect(mode: WorkspaceMode, promptFolder = false): void {
    const dontShowAgain = this.querySelector<HTMLInputElement>('#chkDontShowAgain')?.checked;
    setShowWelcomeOnStartup(!dontShowAgain);

    this.dispatchEvent(
      new CustomEvent<WelcomeSelectEventDetail>('select-mode', {
        detail: { mode, promptFolder },
        bubbles: true,
        composed: true,
      })
    );
    this.close();
  }

  protected render(): void {
    if (!this.isOpen) {
      this.innerHTML = '';
      return;
    }

    const isDismissed = !getShowWelcomeOnStartup();

    this.innerHTML = html`
      <div class="modal-backdrop welcome-modal-backdrop">
        <div class="modal-dialog welcome-modal-dialog" role="dialog" aria-modal="true" aria-label="Welcome to TRAAACE">
          <div class="modal-header welcome-modal-header">
            <div class="welcome-header-title">
              <img class="welcome-logo" src="${kakapoLogoUrl}" alt="" draggable="false" />
              <h2>Welcome to TRAAACE</h2>
            </div>
            <button class="btn-ghost btn-icon" id="btnCloseWelcome" title="Close" aria-label="Close dialog">
              ${icon('x')}
            </button>
          </div>
      
          <div class="modal-body welcome-modal-body">
            <p class="welcome-intro-text">
              How would you like to get started today? Choose an operating mode below:
            </p>
      
            <div class="welcome-card-grid">
              <!-- Quick Classify Card -->
              <div class="welcome-option-card quick-option" id="cardQuick">
                <div class="welcome-card-top">
                  <div class="welcome-card-icon quick-icon">
                    ${icon('bolt')}
                  </div>
                  <span class="welcome-badge quick-badge">Fast & Ephemeral</span>
                </div>
                <h3 class="welcome-card-title">Quick Classify</h3>
                <p class="welcome-card-summary">
                  Jump right into classifying, tagging, and editing your media using hotkeys and preset comments.<br>
                  You can export your data as CSV, XLSX, JSON, or TXT.<br>
                  Images can be exported organized by species.<br>
                  Nothing is stored or saved on Traaace once you export.
                </p>
                <button class="btn-primary welcome-action-btn quick-action" id="btnSelectQuick">
                  ${icon('bolt')} Quick Classify
                </button>
              </div>
      
              <!-- Start Work Folder Card -->
              <div class="welcome-option-card project-option" id="cardProject">
                <div class="welcome-card-top">
                  <div class="welcome-card-icon project-icon">
                    ${icon('folder-open')}
                  </div>
                  <span class="welcome-badge project-badge">Persistent Library</span>
                </div>
                <h3 class="welcome-card-title">Start Work Folder</h3>
                <p class="welcome-card-summary">
                  Manage your folders, projects, and media in one space. <br>
                  Visualise and search your data with filters and charts.<br>
                  Export and sync your files in all formats as with quick classify.
                  Advanced control with customisable hotkeys and comments saved to your profile.
                </p>
                <button class="btn-primary welcome-action-btn project-action" id="btnSelectProject">
                  ${icon('folder-open')} Start Work Folder
                </button>
              </div>
            </div>
          </div>
      
          <div class="modal-footer welcome-modal-footer">
            <label class="welcome-checkbox-label">
              <input type="checkbox" id="chkDontShowAgain" ${isDismissed ? 'checked' : ''} />
              <span>Don't show this on startup</span>
            </label>
            <div class="welcome-footer-hint">
              To switch later, close your Quick session or use Settings in a project
            </div>
          </div>
          <div class="welcome-credit">${kakapoCreditHtml()}</div>
        </div>
      </div>
    `;

    // Event listeners
    bindExternalLinks(this);
    this.querySelector('#btnCloseWelcome')?.addEventListener('click', () => this.close());

    // Quick option clicks
    this.querySelector('#btnSelectQuick')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleSelect('quick', false);
    });
    this.querySelector('#cardQuick')?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;
      this.handleSelect('quick', false);
    });

    // Project option clicks
    this.querySelector('#btnSelectProject')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleSelect('project', true);
    });
    this.querySelector('#cardProject')?.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;
      this.handleSelect('project', true);
    });
  }
}

customElements.define('welcome-modal', WelcomeModal);

declare global {
  interface HTMLElementTagNameMap {
    'welcome-modal': WelcomeModal;
  }
}
