import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('explorer-tree')
export class ExplorerTree extends LitElement {
  @property({ type: Array })
  sections = [];

  @property({ type: String })
  currentItemId = null;

  static styles = css`
    /* Styles will be moved here from power.css */
    :host {
      display: block;
      padding: 12px;
    }
  `;

  render() {
    return html`
      ${this.sections.map(section => html`
        <div class="p-nav-group">
          <div class="p-nav-header">
            <span>${section.title} (${section.items.length})</span>
          </div>
          <!-- TODO: Render groups and items -->
        </div>
      `)}
    `;
  }
}
