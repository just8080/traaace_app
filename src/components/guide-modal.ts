import './project-help';
import { BaseModal } from './base-modal';
import { icon } from '../services/icons';
import { html } from '../utils';

/** The user guide in a dialog, for Quick Classify where there is no project navigation. */
export class GuideModal extends BaseModal {
  protected render(): void {
    if (!this.isOpen) {
      this.innerHTML = '';
      return;
    }

    this.innerHTML = html`
      <div class="modal-backdrop">
        <div class="modal-dialog guide-modal-dialog" role="dialog" aria-modal="true" aria-label="Guide">
          <div class="modal-header">
            <h2>Guide</h2>
            <button class="btn-ghost btn-icon" id="btnCloseGuide" title="Close" aria-label="Close dialog">
              ${icon('x')}
            </button>
          </div>
          <div class="modal-body guide-modal-body">
            <project-help></project-help>
          </div>
        </div>
      </div>
    `;

    this.querySelector('#btnCloseGuide')?.addEventListener('click', () => this.close());
  }
}

customElements.define('guide-modal', GuideModal);

declare global {
  interface HTMLElementTagNameMap {
    'guide-modal': GuideModal;
  }
}
