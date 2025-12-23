
import { esc, stripNccNumber } from "./utils.js";

let actions = {};

export function initPowerShell(state, appActions) {
  actions = appActions || {};
  const shell = document.getElementById("shell-power");
  if (!shell) return;
  
  // Check if already initialized (look for topbar class)
  if (!shell.innerHTML.includes("p-topbar")) {
      shell.innerHTML = `
        <header class="p-topbar">
          <div style="font-weight: 600;">> NCC Console</div>
          <div style="font-size: 0.8rem; color: var(--muted);">Ctrl+K for commands</div>
        </header>
        <nav class="p-nav" id="p-nav">
          <!-- Nav Tree -->
        </nav>
        <main class="p-workspace">
          <div class="p-split" id="p-split">
             <textarea class="p-editor" id="p-editor" placeholder="// Select a file to edit..."></textarea>
             <div class="p-preview" id="p-preview">
               <div style="color: var(--muted); padding-top: 40px; text-align: center;">Select an item to view</div>
             </div>
          </div>
          <div class="p-bottom" id="p-bottom">
             <div class="p-bottom-header">
               <button class="p-tab active">Logs</button>
               <button class="p-tab">Relay Results</button>
             </div>
             <div class="p-bottom-content" id="p-logs">
               <div>[System] Console initialized.</div>
             </div>
          </div>
        </main>
        <footer class="p-status">
           <div id="p-status-signer">Signer: ${state.signerPubkey ? "Connected" : "Disconnected"}</div>
           <div id="p-status-relays">Relays: ${state.relayStatus?.relays || 0}</div>
           <div id="p-status-msg">Ready</div>
        </footer>
        <div id="p-palette-overlay" class="p-palette-overlay" hidden>
           <div class="p-palette">
              <input class="p-palette-input" id="p-palette-input" placeholder="Type a command..." />
              <div class="p-palette-list" id="p-palette-list"></div>
           </div>
        </div>
      `;
      
      setupKeyboardShortcuts();
      
      // Close palette on click outside
      const overlay = document.getElementById("p-palette-overlay");
      overlay.addEventListener("click", (e) => {
          if (e.target === overlay) toggleCommandPalette(false);
      });
      
      // Palette input listener
      document.getElementById("p-palette-input").addEventListener("input", (e) => {
          renderCommandList(e.target.value);
      });
  }
  
  renderNavTree(state);
}

const COMMANDS = [
    { id: "new-ncc", title: "New NCC Draft", run: () => console.log("New NCC") },
    { id: "toggle-bottom", title: "Toggle Bottom Panel", run: () => toggleBottomPanel() },
    { id: "switch-classic", title: "Switch to Classic Mode", run: () => actions.switchShell?.("classic") },
    { id: "reload", title: "Reload Window", run: () => window.location.reload() }
];

function setupKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "k") {
            e.preventDefault();
            toggleCommandPalette();
        }
        if (e.key === "Escape") {
            toggleCommandPalette(false);
        }
    });
}

function toggleCommandPalette(show) {
    const overlay = document.getElementById("p-palette-overlay");
    const input = document.getElementById("p-palette-input");
    if (!overlay) return;
    
    const isHidden = overlay.hidden;
    const shouldShow = show !== undefined ? show : isHidden;
    
    overlay.hidden = !shouldShow;
    if (shouldShow) {
        input.value = "";
        renderCommandList("");
        input.focus();
    }
}

function renderCommandList(query) {
    const list = document.getElementById("p-palette-list");
    if (!list) return;
    
    const q = query.toLowerCase();
    const matches = COMMANDS.filter(c => 
        c.title.toLowerCase().includes(q) || c.id.includes(q)
    );
    
    list.innerHTML = matches.map((c, i) => `
        <div class="p-palette-item ${i === 0 ? 'selected' : ''}" onclick="window.runCommand('${c.id}')">
            <span>${esc(c.title)}</span>
            <span class="shortcut">${c.id}</span>
        </div>
    `).join("");
    
    // Hack for onclick exposure
    window.runCommand = (id) => {
        const cmd = COMMANDS.find(c => c.id === id);
        if (cmd) {
            cmd.run();
            toggleCommandPalette(false);
        }
    };
}

function toggleBottomPanel() {
    const panel = document.getElementById("p-bottom");
    if (panel) panel.classList.toggle("open");
}

function renderNavTree(state) {
  const nav = document.getElementById("p-nav");
  if (!nav) return;
  
  const drafts = state.nccLocalDrafts || [];
  const published = state.nccDocs || [];
  
  // Simple grouping
  let html = "";
  
  html += `<div class="p-nav-group"><div class="p-nav-header">Local Drafts (${drafts.length})</div><div class="p-nav-list">`;
  drafts.forEach(draft => {
      html += `<div class="p-nav-item" data-id="${draft.id}">
        <span>${esc(draft.d)}</span>
        <span class="p-badge status-draft">DRAFT</span>
      </div>`;
  });
  html += `</div></div>`;
  
  html += `<div class="p-nav-group"><div class="p-nav-header">Published Network (${published.length})</div><div class="p-nav-list">`;
  published.forEach(doc => {
      html += `<div class="p-nav-item" data-id="${doc.id}">
        <span>${esc(doc.d || "unknown")}</span>
        <span class="p-badge status-published">PUB</span>
      </div>`;
  });
  html += `</div></div>`;
  
  nav.innerHTML = html;
}
