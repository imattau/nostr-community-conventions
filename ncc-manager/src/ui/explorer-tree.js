import { LitElement, html, css } from 'lit';
import { renderExplorerSection } from './explorer.js';

export class ExplorerTree extends LitElement {
  static properties = {
    sections: { type: Array },
    currentItemId: { type: String },
    context: { type: Object }
  };

  static shadowRootOptions = { mode: 'open', delegatesFocus: true }; // Add delegatesFocus: true

  constructor() {
    super();
    this.sections = [];
    this.currentItemId = null;
    this.context = {};
  }

  static styles = css`
    :host {
      display: block;
      padding: 12px;
      color: var(--text); /* Set text color from variable */
      background: var(--panel); /* Explicitly set panel background */
    }

    /* Explorer Styling */
    .p-nav-group { margin-bottom: 24px; background-color: var(--panel); }
    .p-nav-header {
      font-size: 0.75rem;
      text-transform: uppercase;
      color: var(--muted);
      padding-bottom: 8px;
      letter-spacing: 0.05em;
      font-weight: 600;
      background-color: transparent; /* Ensure transparent to show group background */
    }

    .p-nav-tree { margin-bottom: 4px; background-color: transparent; }
    .p-nav-branch-header {
      width: 100%;
      background: transparent; /* Override button default white background */
      border: none;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      cursor: pointer;
      color: var(--text); /* Use theme text color */
      font-size: 0.9rem;
      text-align: left;
    }
    .p-nav-branch-title {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      overflow: hidden;
    }
    .p-type-tag {
      font-size: 0.6rem;
      font-weight: 800;
      color: var(--accent);
      background: rgba(88, 166, 255, 0.1);
      padding: 1px 4px;
      border-radius: 3px;
      text-transform: uppercase;
      flex-shrink: 0;
    }
    .p-muted-type {
      font-size: 0.65rem;
      color: var(--muted);
      font-weight: normal;
      text-transform: uppercase;
    }
    .p-nav-branch-body { display: none; padding-left: 16px; }
    .p-nav-branch-body.is-open { display: block; }

    .p-nav-subtree {
      margin-top: 4px;
    }
    .p-nav-subtree .p-nav-branch-header {
      padding: 4px 0;
      opacity: 0.8;
    }
    .p-nav-subtree .p-nav-branch-title {
      font-size: 0.8rem;
    }

    .p-nav-item {
      padding: 6px 8px;
      border-radius: 4px;
      cursor: pointer;
      margin: 2px 0;
      border-left: 2px solid transparent;
      background-color: var(--panel); /* Ensure background is set */
    }
    .p-nav-item:hover { background: var(--accent-soft); }
    .p-nav-item.active { background: var(--accent-soft); border-left-color: var(--accent); }

    .p-nav-meta { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px; pointer-events: none; }
    .p-nav-id { font-weight: 600; font-size: 0.8rem; letter-spacing: 0.02em; pointer-events: none; }
    .p-nav-label { font-size: 0.8rem; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
    .p-nav-date { font-size: 0.7rem; color: var(--muted); opacity: 0.6; margin-top: 2px; pointer-events: none; }

    /* Badges (Moved from power.css) */
    .p-badge-mini { font-size: 0.65rem; font-weight: 700; padding: 1px 6px; border-radius: 3px; text-transform: uppercase; }
    .status-published { color: var(--success); border: 1px solid rgba(63, 185, 80, 0.4); }
    .status-draft { color: var(--warning); border: 1px solid rgba(210, 153, 34, 0.4); }
    .status-withdrawn { color: var(--danger); border: 1px solid rgba(248, 81, 73, 0.4); }
  `;

  render() {
    const { expandedBranches, state, findItem } = this.context;
    let renderedHtml;
    try {
        renderedHtml = html`
          ${this.sections.map(section => 
            html`${renderExplorerSection(section, { 
              expandedBranches, 
              currentItemId: this.currentItemId, 
              state,
              findItem 
            })}`
          )}
        `;
    } catch (e) {
        console.error("ExplorerTree: Error in renderHtml calculation:", e);
        renderedHtml = html`<div>Error rendering explorer tree. Check console.</div>`;
    }
    return renderedHtml;
  }
}

customElements.define('explorer-tree', ExplorerTree);