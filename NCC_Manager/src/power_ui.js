import { esc, stripNccNumber, renderMarkdown, eventTagValue } from "./utils.js";

let actions = {};
let currentItemId = null;
let currentItemSource = null;
let lastLineCount = 0;
let _currentState = null;

export function initPowerShell(state, appActions) {
    _currentState = state;
    renderPowerShell(state, appActions);
}

function renderPowerShell(state, appActions) {
  actions = appActions || {};
  const shell = document.getElementById("shell-power");
  if (!shell) return;
  
  // Initial render if empty
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
           <div>Relays: <span id="p-status-relays"></span></div>
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
  refreshFooter(state);
  
  if (currentItemId) {
      const item = findItem(currentItemId, state);
      if (item) refreshDetails(item, state);
  }
}

function refreshFooter(state) {
    const el = document.getElementById("p-status-relays");
    if (el) el.textContent = state.relayStatus?.relays || 0;
}

function findItem(id, state) {
    const drafts = state.nccLocalDrafts || [];
    const published = state.nccDocs || [];
    let item = drafts.find(d => d.id === id);
    if (item) {
        item._source = "local";
        return item;
    }
    item = published.find(d => d.id === id);
    if (item) {
        item._source = "remote";
        return item;
    }
    return null;
}

function setupEventListeners() {
    const editor = document.getElementById("p-editor");
    const gutter = document.getElementById("p-gutter");
    const preview = document.getElementById("p-tab-preview");
    
    if (!editor || !gutter || !preview) return;
    
    editor.addEventListener("input", (e) => {
        const val = editor.value;
        const lines = val.split("\n").length;
        if (lines !== lastLineCount) {
            gutter.innerHTML = Array(lines).fill(0).map((_, i) => i + 1).join("<br>");
            lastLineCount = lines;
        }
        
        const isPreviewActive = document.getElementById("p-tab-preview").classList.contains("active");
        if (isPreviewActive) {
            preview.innerHTML = renderMarkdown(val);
        }
        
        if (!e.isTrusted) return;
        
        document.getElementById("p-file-status").textContent = "• Unsaved";
    });
    
    editor.addEventListener("scroll", () => {
        gutter.scrollTop = editor.scrollTop;
    });
    
    document.getElementById("p-tabs").addEventListener("click", (e) => {
        if (!e.target.classList.contains("p-tab-btn")) return;
        
        document.querySelectorAll(".p-tab-btn").forEach(b => b.classList.remove("active"));
        e.target.classList.add("active");
        
        const tab = e.target.dataset.tab;
        document.querySelectorAll(".p-tab-content").forEach(c => c.classList.remove("active"));
        document.getElementById(`p-tab-${tab}`).classList.add("active");
        
        if (tab === "preview") {
             preview.innerHTML = renderMarkdown(editor.value);
        }
    });
    
    const overlay = document.getElementById("p-palette-overlay");
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) toggleCommandPalette(false);
    });
    
    document.getElementById("p-palette-list").addEventListener("click", (e) => {
        const item = e.target.closest(".p-palette-item");
        if (item && item.dataset.cmd) {
            const cmdId = item.dataset.cmd;
            const cmd = COMMANDS.find(c => c.id === cmdId);
            if (cmd) {
                cmd.run();
                toggleCommandPalette(false);
            }
        }
    });
    
    document.getElementById("p-palette-input").addEventListener("input", (e) => {
        renderCommandList(e.target.value);
    });

    document.getElementById("p-nav").addEventListener("click", (e) => {
        const navItem = e.target.closest(".p-nav-item");
        if (navItem && navItem.dataset.id) {
            openItem(navItem.dataset.id);
        }
    });
}

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
        <div class="p-palette-item ${i === 0 ? 'selected' : ''}" data-cmd="${c.id}">
            <span>${esc(c.title)}</span>
            <span class="shortcut">${esc(c.shortcut || "")}</span>
        </div>
    `).join("");
}

function renderNavTree(state) {
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
           <div class="meta">${esc(getItemTitle(draft))}</div>
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
           <div class="meta">${esc(getItemTitle(doc))}</div>
        </div>
        <div><span class="p-badge status-published">PUB</span></div>
      </div>`;
  });
  html += `</div></div>`;
  
  nav.innerHTML = html;
}

function getItemTitle(item) {
    if (!item) return "Untitled";
    return item.title || eventTagValue(item.tags, "title") || item.d || "Untitled";
}

function openItem(id) {
    if (!_currentState) return;
    const item = findItem(id, _currentState);
    if (!item) return;
    
    currentItemId = id;
    currentItemSource = item._source;
    
    document.querySelectorAll(".p-nav-item").forEach(el => {
        el.classList.toggle("active", el.dataset.id === id);
    });
    
    const editor = document.getElementById("p-editor");
    const filename = document.getElementById("p-file-name");
    const status = document.getElementById("p-file-status");
    
    if (editor) {
        editor.value = item.content || "";
        const lines = editor.value.split("\n").length;
        document.getElementById("p-gutter").innerHTML = Array(lines).fill(0).map((_, i) => i + 1).join("<br>");
        lastLineCount = lines;
        
        if (document.getElementById("p-tab-preview").classList.contains("active")) {
             document.getElementById("p-tab-preview").innerHTML = renderMarkdown(editor.value);
        }
    }
    
    if (filename) filename.textContent = getItemTitle(item);
    if (status) status.textContent = "";
    
    refreshDetails(item, _currentState);
    
    const msg = document.getElementById("p-status-msg");
    if (msg) msg.textContent = `Opened: ${item.d}`;
}

function refreshDetails(item, state) {
    document.getElementById("p-detail-title").textContent = getItemTitle(item);
    const badge = document.getElementById("p-detail-badge");
    const status = (item.status || "draft").toUpperCase();
    badge.textContent = status;
    badge.className = `p-badge status-${status.toLowerCase()}`;
    badge.style.display = "inline-block";
    
    const actionsDiv = document.getElementById("p-detail-actions");
    actionsDiv.innerHTML = "";
    
    const canPublish = state.signerPubkey && (item._source === "local");
    
    if (canPublish) {
       const btn = document.createElement("button");
       btn.className = "primary";
       btn.textContent = "Publish";
       btn.onclick = () => {
           if (confirm("Publish this NCC?")) {
               actions.publishDraft?.(item, "ncc");
           }
       };
       actionsDiv.appendChild(btn);
    }
}

async function handleSaveShortcut() {
    if (!currentItemId || !actions.saveItem) return;
    
    if (currentItemSource !== "local") {
        document.getElementById("p-status-msg").textContent = "Cannot save published item. Create a draft first.";
        return;
    }

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