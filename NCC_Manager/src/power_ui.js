
import { esc, stripNccNumber, renderMarkdown } from "./utils.js";

let actions = {};
let currentItemId = null;

export function initPowerShell(state, appActions) {
  actions = appActions || {};
  const shell = document.getElementById("shell-power");
  if (!shell) return;
  
  if (!shell.innerHTML.includes("p-topbar")) {
      shell.innerHTML = `
        <header class="p-topbar">
          <div style="font-weight: 600; display: flex; gap: 12px; align-items: center;">
            <span>> NCC Console</span>
            <span class="p-badge status-published" style="opacity: 0.7;">v0.1</span>
          </div>
          <input class="p-top-search" id="p-search" placeholder="Search NCCs..." />
          <div style="display: flex; gap: 16px; align-items: center;">
             <div style="font-size: 0.8rem; color: var(--muted);" id="p-signer-status">Signer: ...</div>
             <div style="font-size: 0.8rem; color: var(--muted);">Ctrl+K</div>
          </div>
        </header>
        
        <nav class="p-nav" id="p-nav">
          <!-- Nav Tree -->
        </nav>
        
        <main class="p-workspace">
          <div class="p-split" id="p-split">
             <!-- Left: Editor -->
             <div class="p-editor-container">
                <div class="p-pane-header">
                   <span id="p-file-name">No file selected</span>
                   <span id="p-file-status" style="font-size: 0.7rem;"></span>
                </div>
                <div class="p-editor-body">
                   <div class="p-gutter" id="p-gutter">1</div>
                   <textarea class="p-editor-textarea" id="p-editor" placeholder="// Select a file from the sidebar..."></textarea>
                </div>
             </div>
             
             <!-- Right: Details/Preview -->
             <div class="p-details">
                <div class="p-details-header">
                   <div>
                      <div class="p-details-title" id="p-detail-title">Select an item</div>
                      <span class="p-badge" id="p-detail-badge" style="display: none;"></span>
                   </div>
                   <div class="actions" id="p-detail-actions">
                      <!-- Actions injected here -->
                   </div>
                </div>
                <div class="p-tabs-bar" id="p-tabs">
                   <button class="p-tab-btn active" data-tab="preview">Preview</button>
                   <button class="p-tab-btn" data-tab="relays">Relays</button>
                </div>
                <div class="p-tab-content active" id="p-tab-preview">
                   <div style="color: var(--muted); padding-top: 40px; text-align: center;">Preview will appear here</div>
                </div>
                <div class="p-tab-content" id="p-tab-relays">
                   <p class="muted">Relay status and results will appear here.</p>
                </div>
             </div>
          </div>
        </main>
        
        <footer class="p-status">
           <div id="p-status-relays">Relays: ${state.relayStatus?.relays || 0}</div>
           <div id="p-status-msg">Ready</div>
        </footer>
        
        <div id="p-palette-overlay" class="p-palette-overlay" hidden style="display: none;">
           <div class="p-palette">
              <input class="p-palette-input" id="p-palette-input" placeholder="Type a command..." />
              <div class="p-palette-list" id="p-palette-list"></div>
           </div>
        </div>
      `;
      
      setupKeyboardShortcuts();
      setupEventListeners();
  }
  
  renderNavTree(state);
  updateSignerIndicator(state);
}

function setupEventListeners() {
    const editor = document.getElementById("p-editor");
    const gutter = document.getElementById("p-gutter");
    const preview = document.getElementById("p-tab-preview");
    
    // Editor sync
    editor.addEventListener("input", () => {
        // Update gutter
        const lines = editor.value.split("\n").length;
        gutter.innerHTML = Array(lines).fill(0).map((_, i) => i + 1).join("<br>");
        
        // Update preview
        if (preview) {
            preview.innerHTML = renderMarkdown(editor.value);
        }
        
        // Dirty state
        document.getElementById("p-file-status").textContent = "• Unsaved";
    });
    
    editor.addEventListener("scroll", () => {
        gutter.scrollTop = editor.scrollTop;
    });
    
    // Tabs
    document.getElementById("p-tabs").addEventListener("click", (e) => {
        if (!e.target.classList.contains("p-tab-btn")) return;
        
        // Switch active tab btn
        document.querySelectorAll(".p-tab-btn").forEach(b => b.classList.remove("active"));
        e.target.classList.add("active");
        
        // Switch content
        const tab = e.target.dataset.tab;
        document.querySelectorAll(".p-tab-content").forEach(c => c.classList.remove("active"));
        document.getElementById(`p-tab-${tab}`).classList.add("active");
    });
    
    // Palette
    const overlay = document.getElementById("p-palette-overlay");
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) toggleCommandPalette(false);
    });
    
    document.getElementById("p-palette-input").addEventListener("input", (e) => {
        renderCommandList(e.target.value);
    });

    // Nav
    document.getElementById("p-nav").addEventListener("click", (e) => {
        const item = e.target.closest(".p-nav-item");
        if (item && item.dataset.id) {
            // Need access to state? We passed it to init but it's not global here.
            // We need to fetch item from main state.
            // Hack: Trigger a custom event or use a global store if available.
            // Or just pass ID to openItem and let it find it via a callback or exported state?
            // `actions.openItem`? No, `openItem` is local.
            // `initPowerShell` takes state.
            // We can re-fetch state from `actions` if we modify it to include a getter?
            // Or just rely on the fact that `renderNavTree` rendered the ID.
            // We need the data.
            // Let's attach the data to the DOM element? No, too big.
            // We'll expose `openItem` which finds it in the passed state?
            // State is updated on re-render.
            // Let's store a reference to the latest state.
            window.nccState = window.nccState || {}; 
            // Better: use the imported utils/store if possible?
            // `state` arg in initPowerShell is the snapshot.
            // We can attach it to the module scope variable?
            // `latestState = state;`
            openItem(item.dataset.id);
        }
    });
}

let latestState = null; // Module-scoped state reference

const COMMANDS = [
    { id: "save", title: "Save Current File", shortcut: "Ctrl+S", run: () => handleSaveShortcut() },
    { id: "new-ncc", title: "New NCC Draft", run: () => actions.openNewNcc?.() },
    { id: "switch-classic", title: "Switch to Classic Mode", run: () => actions.switchShell?.("classic") },
    { id: "reload", title: "Reload Window", run: () => window.location.reload() }
];

function setupKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "k") {
            e.preventDefault();
            toggleCommandPalette();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === "s") {
            e.preventDefault();
            handleSaveShortcut();
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
    overlay.style.display = shouldShow ? 'flex' : 'none';
    
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
    
    window.runCommand = (id) => {
        const cmd = COMMANDS.find(c => c.id === id);
        if (cmd) {
            cmd.run();
            toggleCommandPalette(false);
        }
    };
}

function toggleBottomPanel() {
    // Deprecated in this layout
}

function renderNavTree(state) {
  latestState = state;
  const nav = document.getElementById("p-nav");
  if (!nav) return;
  
  const drafts = state.nccLocalDrafts || [];
  const published = state.nccDocs || [];
  
  let html = "";
  
  html += `<div class="p-nav-group"><div class="p-nav-header">Local Drafts (${drafts.length})</div><div class="p-nav-list">`;
  if (!drafts.length) html += `<div class="p-empty-state">No drafts</div>`;
  drafts.forEach(draft => {
      const active = draft.id === currentItemId ? " active" : "";
      const updated = new Date(draft.updated_at || 0).toLocaleDateString();
      html += `<div class="p-nav-item${active}" data-id="${draft.id}">
        <div>
           <div>${esc(draft.d)}</div>
           <div class="meta">${esc(draft.title)}</div>
        </div>
        <div style="text-align: right;">
           <span class="p-badge status-draft">DRAFT</span>
           <div class="meta">${updated}</div>
        </div>
      </div>`;
  });
  html += `</div></div>`;
  
  html += `<div class="p-nav-group"><div class="p-nav-header">Published Network (${published.length})</div><div class="p-nav-list">`;
  if (!published.length) html += `<div class="p-empty-state">No published items</div>`;
  published.forEach(doc => {
      const active = doc.id === currentItemId ? " active" : "";
      html += `<div class="p-nav-item${active}" data-id="${doc.id}">
        <div>
           <div>${esc(doc.d || "unknown")}</div>
           <div class="meta">${esc(eventTagValue(doc.tags, "title") || "Untitled")}</div>
        </div>
        <div><span class="p-badge status-published">PUB</span></div>
      </div>`;
  });
  html += `</div></div>`;
  
  nav.innerHTML = html;
}

function openItem(id) {
    if (!latestState) return;
    const drafts = latestState.nccLocalDrafts || [];
    const published = latestState.nccDocs || [];
    
    let item = drafts.find(d => d.id === id);
    if (!item) {
        item = published.find(d => d.id === id);
    }
    
    if (!item) return;
    
    currentItemId = id;
    
    // Update active state in nav
    document.querySelectorAll(".p-nav-item").forEach(el => {
        el.classList.toggle("active", el.dataset.id === id);
    });
    
    const editor = document.getElementById("p-editor");
    const preview = document.getElementById("p-tab-preview");
    const filename = document.getElementById("p-file-name");
    const status = document.getElementById("p-file-status");
    const gutter = document.getElementById("p-gutter");
    
    // Details pane updates
    document.getElementById("p-detail-title").textContent = item.d + " - " + (item.title || eventTagValue(item.tags, "title"));
    const badge = document.getElementById("p-detail-badge");
    badge.textContent = (item.status || "draft").toUpperCase();
    badge.className = `p-badge status-${(item.status || "draft").toLowerCase()}`;
    badge.style.display = "inline-block";
    
    // Actions
    const actionsDiv = document.getElementById("p-detail-actions");
    const canPublish = latestState.signerPubkey && (item.source === "local" || !item.source); // Simplify check
    
    actionsDiv.innerHTML = "";
    if (canPublish) {
       // Using window.publish wrapper or directly actions.publishDraft?
       // actions.publishDraft needs (draft, kind).
       // We can bind a button.
       const btn = document.createElement("button");
       btn.className = "primary meta-button";
       btn.textContent = "Publish";
       btn.onclick = () => {
           if (confirm("Publish this NCC?")) {
               actions.publishDraft?.(item, "ncc");
           }
       };
       actionsDiv.appendChild(btn);
    }
    
    if (editor && preview) {
        editor.value = item.content || "";
        preview.innerHTML = renderMarkdown(item.content || "");
        filename.textContent = item.d || "Untitled";
        status.textContent = "";
        
        // Trigger input event to update gutter
        editor.dispatchEvent(new Event("input"));
    }
    
    const msg = document.getElementById("p-status-msg");
    if (msg) msg.textContent = `Opened: ${item.d || item.id}`;
}

async function handleSaveShortcut() {
    if (!currentItemId || !actions.saveItem) return;
    const content = document.getElementById("p-editor").value;
    const msg = document.getElementById("p-status-msg");
    if (msg) msg.textContent = "Saving...";
    await actions.saveItem(currentItemId, content);
    const status = document.getElementById("p-file-status");
    if (status) status.textContent = "";
    if (msg) msg.textContent = `Saved at ${new Date().toLocaleTimeString()}`;
}

function updateSignerIndicator(state) {
    const el = document.getElementById("p-signer-status");
    if (el) {
        el.textContent = state.signerPubkey 
            ? `Signer: ${state.signerPubkey.slice(0,6)}...` 
            : "Signer: Not connected";
        el.style.color = state.signerPubkey ? "var(--accent)" : "var(--muted)";
    }
}

function eventTagValue(tags, name) {
  if (!Array.isArray(tags)) return "";
  const found = tags.find((tag) => tag[0] === name);
  return found ? found[1] : "";
}
