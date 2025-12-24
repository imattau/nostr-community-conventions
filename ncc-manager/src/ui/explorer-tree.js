import { LitElement, html, css } from 'lit';

export class ExplorerTree extends LitElement {
  static properties = {
    sections: { type: Array },
    currentItemId: { type: String }
  };

  constructor() {
    super();
    this.sections = [];
    this.currentItemId = null;
  }

  static styles = css`
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

customElements.define('explorer-tree', ExplorerTree);