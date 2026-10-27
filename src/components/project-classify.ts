import './classifier-view';
import { html } from '../utils';

export class ProjectClassify extends HTMLElement {
  connectedCallback(): void {
    this.innerHTML = html`
      <classifier-view mode="project" style="display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; overflow: hidden;"></classifier-view>
    `;
  }
}

customElements.define('project-classify', ProjectClassify);

declare global {
  interface HTMLElementTagNameMap {
    'project-classify': ProjectClassify;
  }
}
