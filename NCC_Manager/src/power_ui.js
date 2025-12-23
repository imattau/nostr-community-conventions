import { esc, stripNccNumber, renderMarkdown, eventTagValue } from "./utils.js";

let actions = {};
let currentItemId = null;
let isEditMode = false;
let searchQuery = "";
let _state = null;

// Initialization
export function initPowerShell(state, appActions) {
  _state = state;
  actions = appActions || {};
  const shell = document.getElementById("shell-power");
  if (!shell) return;
  
  if (!shell.innerHTML.includes("p-topbar")) {
      shell.innerHTML = `
        <header class="p-topbar">
          <div style="font-weight: 700; display: flex; gap: 8px; align-items: center; white-space: nowrap;">
            <span style="color: var(--accent);">></span> NCC Console
            <span class="p-badge" style="opacity: 0.5;">v0.1</span>
          </div>
          <input class="p-top-search" id="p-search" placeholder="Search NCCs..." />
          <div style="flex: 1;"></div>
          <div style="display: flex; gap: 20px; align-items: center; white-space: nowrap;">
             <div id="p-top-signer" style="font-size: 0.8rem; color: var(--muted);"></div>
             <div style="font-size: 0.7rem; color: var(--muted); opacity: 0.6; font-family: var(--mono);">Ctrl+K</div>
          </div>
        </header>
        
        <div class="p-workspace">
          <aside class="p-pane p-explorer" id="p-explorer">
            <!-- Explorer content -->
          </aside>
          
          <main class="p-pane p-content" id="p-content-column">
            <!-- Content column (Read or Edit) -->
            <div style="color: var(--muted); padding: 40px; text-align: center; font-style: italic;">
              Select an item from the Explorer to begin.
            </div>
          </main>
          
          <aside class="p-pane p-inspector" id="p-inspector">
            <!-- Inspector content -->
          </aside>
        </div>
        
        <footer class="p-status">
           <div id="p-status-relays">Relays: 0</div>
           <div id="p-status-msg">Ready</div>
        </footer>
        
        <div id="p-palette-overlay" class="p-palette-overlay" hidden style="display: none;">
           <div class="p-palette">
              <input class="p-palette-input" id="p-palette-input" placeholder="Search commands..." />
              <div class="p-palette-list" id="p-palette-list"></div>
           </div>
        </div>
      `;
      
      setupKeyboardShortcuts();
      setupGlobalListeners();
  }
  
  refreshUI();
}

function setupGlobalListeners() {
    // Search filter
    document.getElementById("p-search").addEventListener("input", (e) => {
        searchQuery = e.target.value.toLowerCase();
        renderExplorer();
    });

    // Explorer delegation
    document.getElementById("p-explorer").addEventListener("click", (e) => {
        const item = e.target.closest(".p-nav-item");
        if (item && item.dataset.id) {
            openItem(item.dataset.id);
        }
    });

    // Command palette delegation
    document.getElementById("p-palette-list").addEventListener("click", (e) => {
        const item = e.target.closest(".p-palette-item");
        if (item && item.dataset.cmd) {
            executeCommand(item.dataset.cmd);
        }
    });

    // Palette overlay close
    const overlay = document.getElementById("p-palette-overlay");
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) toggleCommandPalette(false);
    });
}

// UI Refreshers
function refreshUI() {
    renderExplorer();
    renderTopBar();
    renderStatusBar();
    
    if (currentItemId) {
        const item = findItem(currentItemId);
        if (item) {
            renderInspector(item);
            // We don't force re-render content here to avoid losing scroll/cursor 
            // unless item ID changed or explicitly needed.
        }
    }
}

function renderTopBar() {
    const el = document.getElementById("p-top-signer");
    if (!el || !_state) return;
    el.textContent = _state.signerPubkey 
        ? `Signer: ${_state.signerPubkey.slice(0, 12)}...` 
        : "Signer: Not connected";
    el.style.color = _state.signerPubkey ? "var(--accent)" : "var(--muted)";
}

function renderStatusBar() {
    const r = document.getElementById("p-status-relays");
    if (r && _state) r.textContent = `Relays: ${_state.relayStatus?.relays || 0}`;
}

function updateStatus(msg) {
    const el = document.getElementById("p-status-msg");
    if (el) el.textContent = msg;
}

// Explorer
function renderExplorer() {
    const el = document.getElementById("p-explorer");
    if (!el || !_state) return;
    
    const drafts = (_state.nccLocalDrafts || []).filter(d => 
        !searchQuery || d.d.toLowerCase().includes(searchQuery) || d.title?.toLowerCase().includes(searchQuery)
    );
    const published = (_state.nccDocs || []).filter(d => 
        !searchQuery || (d.d || "").toLowerCase().includes(searchQuery) || eventTagValue(d.tags, "title").toLowerCase().includes(searchQuery)
    );

    let html = "";
    
    // Drafts
    html += `<div class="p-nav-group"><div class="p-nav-header">Local Drafts (${drafts.length})</div><div class="p-nav-list">`;
    if (!drafts.length) html += `<div style="padding: 8px 12px; opacity: 0.4; font-size: 0.75rem;">None</div>`;
    drafts.forEach(item => {
        const active = item.id === currentItemId ? " active" : "";
        html += `
            <div class="p-nav-item${active}" data-id="${item.id}">
                <div style="flex: 1; min-width: 0;">
                    <div>${esc(item.d)}</div>
                    <div class="title">${esc(item.title || "Untitled")}</div>
                </div>
                <div class="p-badge status-draft">DRAFT</div>
            </div>`;
    });
    html += `</div></div>`;

    // Published
    html += `<div class="p-nav-group"><div class="p-nav-header">Published Network (${published.length})</div><div class="p-nav-list">`;
    if (!published.length) html += `<div style="padding: 8px 12px; opacity: 0.4; font-size: 0.75rem;">None</div>`;
    published.forEach(item => {
        const active = item.id === currentItemId ? " active" : "";
        const title = eventTagValue(item.tags, "title") || "Untitled";
        html += `
            <div class="p-nav-item${active}" data-id="${item.id}">
                <div style="flex: 1; min-width: 0;">
                    <div>${esc(item.d || "NCC-XX")}</div>
                    <div class="title">${esc(title)}</div>
                </div>
                <div class="p-badge status-published">PUB</div>
            </div>`;
    });
    html += `</div></div>`;

    el.innerHTML = html;
}

// Item Handling
function findItem(id) {
    if (!_state) return null;
    const all = [...(_state.nccLocalDrafts || []), ...(_state.nccDocs || [])];
    const found = all.find(i => i.id === id);
    if (found) {
        found._isLocal = (_state.nccLocalDrafts || []).some(d => d.id === id);
    }
    return found;
}

function openItem(id) {
    const item = findItem(id);
    if (!item) return;
    
    currentItemId = id;
    isEditMode = false; // Reset to read mode on open
    
    renderExplorer(); // Refresh active state
    renderContent(item);
    renderInspector(item);
    updateStatus(`Opened ${item.d || "item"}`);
}

function renderContent(item) {
    const container = document.getElementById("p-content-column");
    if (!container) return;
    
    container.innerHTML = "";
    container.scrollTop = 0;

    if (isEditMode) {
        const wrap = document.createElement("div");
        wrap.className = "p-edit-view";
        wrap.innerHTML = `
            <div class="p-gutter" id="p-gutter">1</div>
            <textarea class="p-editor-textarea" id="p-editor" spellcheck="false"></textarea>
        `;
        container.appendChild(wrap);
        
        const textarea = wrap.querySelector("textarea");
        textarea.value = item.content || "";
        
        textarea.oninput = (e) => {
            if (e.isTrusted) updateStatus("• Unsaved changes");
            syncGutter(textarea);
        };
        textarea.onscroll = () => {
            document.getElementById("p-gutter").scrollTop = textarea.scrollTop;
        };
        syncGutter(textarea);
        textarea.focus();
    } else {
        const view = document.createElement("article");
        view.className = "p-read-view";
        view.innerHTML = renderMarkdown(item.content || "_No content_");
        container.appendChild(view);
    }
}

function syncGutter(textarea) {
    const gutter = document.getElementById("p-gutter");
    if (!gutter) return;
    const lines = textarea.value.split("\n").length;
    gutter.innerHTML = Array.from({length: lines}, (_, i) => i + 1).join("<br>");
}

function renderInspector(item) {
    const el = document.getElementById("p-inspector");
    if (!el) return;
    
    const title = item.title || eventTagValue(item.tags, "title") || "Untitled";
    const status = (item.status || "published").toUpperCase();
    
    el.innerHTML = `
        <div class="p-section">
            <span class="p-section-title">Item Metadata</span>
            <div style="font-weight: 600; margin-bottom: 8px;">${esc(title)}</div>
            <div class="p-metadata-row">
                <span>Identifier</span>
                <span style="font-family: var(--mono);">${esc(item.d || "-")}</span>
            </div>
            <div class="p-metadata-row">
                <span>Status</span>
                <span class="p-badge status-${status.toLowerCase()}">${status}</span>
            </div>
            <div class="p-metadata-row">
                <span>Author</span>
                <span style="font-family: var(--mono);">${esc(item.author?.slice(0,8) || "relay")}...</span>
            </div>
        </div>
        
        <div class="p-inspector-actions" id="p-inspector-actions">
            <!-- Buttons -->
        </div>
        
        <div class="p-section">
            <span class="p-section-title">Relay Network</span>
            <div style="font-size: 0.8rem; color: var(--muted);">
                ${item.event_id ? `Event ID: <span style="font-family: var(--mono);">${item.event_id.slice(0,12)}...</span>` : "Not published to relays."} 
            </div>
        </div>
    `;
    
    const actionsContainer = document.getElementById("p-inspector-actions");
    
    if (item._isLocal) {
        // LOCAL DRAFT ACTIONS
        const editBtn = document.createElement("button");
        editBtn.className = isEditMode ? "primary" : "ghost";
        editBtn.textContent = isEditMode ? "Currently Editing" : "Edit Draft";
        editBtn.disabled = isEditMode;
        editBtn.onclick = () => { isEditMode = true; renderContent(item); renderInspector(item); };
        actionsContainer.appendChild(editBtn);
        
        const publishBtn = document.createElement("button");
        publishBtn.className = "primary";
        publishBtn.textContent = "Publish to Relays";
        publishBtn.onclick = () => { if(confirm("Publish this NCC?")) actions.publishDraft?.(item, "ncc"); };
        actionsContainer.appendChild(publishBtn);
    } else {
        // PUBLISHED ITEM ACTIONS
        const reviseBtn = document.createElement("button");
        reviseBtn.className = "primary";
        reviseBtn.textContent = "Create Revision";
        reviseBtn.onclick = async () => {
            const draft = actions.createRevisionDraft?.(item, _state.nccLocalDrafts);
            if (draft) {
                await actions.saveItem?.(draft.id, draft.content, draft);
                // The above should trigger state refresh and UI update
                openItem(draft.id);
                isEditMode = true;
                renderContent(draft);
                renderInspector(draft);
            }
        };
        actionsContainer.appendChild(reviseBtn);
    }
}

// Commands & Palette
const COMMANDS = [
    { id: "save", title: "Save Current Draft", run: () => handleSaveShortcut() },
    { id: "new", title: "New NCC Draft", run: () => actions.openNewNcc?.() },
    { id: "classic", title: "Switch to Classic UI", run: () => actions.switchShell?.("classic") },
    { id: "reload", title: "Reload System", run: () => window.location.reload() }
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
    
    const shouldShow = show !== undefined ? show : overlay.hidden;
    overlay.hidden = !shouldShow;
    overlay.style.display = shouldShow ? "flex" : "none";
    
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
    const matches = COMMANDS.filter(c => c.title.toLowerCase().includes(q));
    
    list.innerHTML = matches.map(c => `
        <div class="p-palette-item" data-cmd="${c.id}">
            <span>${esc(c.title)}</span>
            <span style="font-size: 0.7rem; opacity: 0.5; font-family: var(--mono);">${c.id.toUpperCase()}</span>
        </div>
    `).join("");
}

function executeCommand(id) {
    const cmd = COMMANDS.find(c => c.id === id);
    if (cmd) {
        cmd.run();
        toggleCommandPalette(false);
    }
}

async function handleSaveShortcut() {
    if (!currentItemId || !isEditMode) return;
    const item = findItem(currentItemId);
    if (!item || !item._isLocal) {
        updateStatus("Cannot save: Published items are read-only. Create a revision.");
        return;
    }
    
    const content = document.getElementById("p-editor").value;
    updateStatus("Saving...");
    await actions.saveItem(currentItemId, content, item);
    updateStatus(`Saved at ${new Date().toLocaleTimeString()}`);
}
