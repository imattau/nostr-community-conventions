import { esc, stripNccNumber, renderMarkdown, eventTagValue, shortenKey } from "./utils.js";
import { KINDS } from "./state.js";

let actions = {};
let currentItemId = null;
let isEditMode = false;
let searchQuery = "";
let _state = null;

const TYPE_LABELS = {
    [KINDS.ncc]: "NCC",
    [KINDS.nsr]: "NSR",
    [KINDS.endorsement]: "Endorsement",
    [KINDS.supporting]: "Supporting"
};

const TYPE_ICONS = {
    [KINDS.ncc]: "📄",
    [KINDS.nsr]: "🔄",
    [KINDS.endorsement]: "✅",
    [KINDS.supporting]: "📚"
};

// Initialization
export function initPowerShell(state, appActions) {
  _state = state;
  actions = appActions || {};
  const shell = document.getElementById("shell-power");
  if (!shell) return;
  
  if (!shell.innerHTML.includes("p-topbar")) {
      shell.innerHTML = `
        <header class="p-topbar">
          <div class="p-brand" style="cursor: pointer;">
            <span class="p-accent">></span> NCC Console
          </div>
          
          <div class="p-top-center">
            <div class="p-search-wrapper">
                <span class="p-search-icon">🔍</span>
                <input class="p-top-search" id="p-search" placeholder="Search docs, drafts, and commands..." />
                <span class="p-search-kb">Ctrl+K</span>
            </div>
          </div>
          
          <div class="p-top-right">
             <div id="p-top-signer" class="p-signer-status"></div>
             <button class="p-ghost-btn" id="p-btn-classic" title="Switch to Classic UI">
                🪟
             </button>
          </div>
        </header>
        
        <div class="p-workspace">
          <aside class="p-pane p-explorer" id="p-explorer">
            <!-- Explorer content -->
          </aside>
          
          <main class="p-pane p-content" id="p-content-column">
            <!-- Content column (Read or Edit) -->
            <div class="p-empty-state">
              <div class="p-empty-icon">📂</div>
              <div class="p-empty-text">Select an item from the Explorer to begin</div>
              <div class="p-empty-hint">Press <code>Ctrl+K</code> for commands</div>
            </div>
          </main>
          
          <aside class="p-pane p-inspector" id="p-inspector">
            <!-- Inspector content -->
          </aside>
        </div>
        
        <footer class="p-status">
           <div class="p-status-left">
              <div id="p-status-relays" title="Connected Relays">🌐 0</div>
              <div id="p-status-item-info"></div>
           </div>
           <div class="p-status-right">
              <div id="p-status-msg">Ready</div>
              <div class="p-status-clock" id="p-status-clock"></div>
           </div>
        </footer>
        
        <div id="p-palette-overlay" class="p-palette-overlay" hidden style="display: none;">
           <div class="p-palette">
              <input class="p-palette-input" id="p-palette-input" placeholder="Type a command or search..." />
              <div class="p-palette-list" id="p-palette-list"></div>
           </div>
        </div>
      `;
      
      setupKeyboardShortcuts();
      setupGlobalListeners();
      
      // Clock update
      setInterval(() => {
          const el = document.getElementById("p-status-clock");
          if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }, 1000);
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
        
        const createBtn = e.target.closest(".p-create-btn");
        if (createBtn && createBtn.dataset.kind) {
            handleCreate(createBtn.dataset.kind);
        }
    });

    // Top bar listeners
    document.getElementById("p-btn-classic").onclick = () => actions.switchShell?.("classic");
    document.querySelector(".p-brand").onclick = () => {
        currentItemId = null;
        isEditMode = false;
        refreshUI();
        renderEmptyState();
    };

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

function handleCreate(kindStr) {
    const kind = parseInt(kindStr);
    if (kind === KINDS.ncc) actions.openNewNcc?.();
    else {
        // For others, we might need more specific actions, but let's assume classic shell handles it
        updateStatus(`New ${TYPE_LABELS[kind]} creation not yet fully implemented in Power UI.`);
    }
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
            updateStatusItemInfo(item);
        } else {
            currentItemId = null;
            renderEmptyState();
        }
    }
}

function renderTopBar() {
    const el = document.getElementById("p-top-signer");
    if (!el || !_state) return;
    
    if (_state.signerPubkey) {
        const profile = _state.signerProfile;
        const name = profile?.name || shortenKey(_state.signerPubkey);
        el.innerHTML = `
            <div class="p-signer-pill">
                <span class="p-signer-dot active"></span>
                <span>${esc(name)}</span>
            </div>
        `;
    } else {
        el.innerHTML = `
            <div class="p-signer-pill">
                <span class="p-signer-dot"></span>
                <span>Not Connected</span>
            </div>
        `;
    }
}

function renderStatusBar() {
    const r = document.getElementById("p-status-relays");
    if (r && _state) r.textContent = `🌐 ${_state.relayStatus?.relays || 0}`;
}

function updateStatusItemInfo(item) {
    const el = document.getElementById("p-status-item-info");
    if (!el) return;
    const type = TYPE_LABELS[item.kind] || "DOC";
    el.textContent = `${type}: ${item.d || "Untitled"}`;
}

function updateStatus(msg) {
    const el = document.getElementById("p-status-msg");
    if (el) el.textContent = msg;
}

function renderEmptyState() {
    const container = document.getElementById("p-content-column");
    if (!container) return;
    container.innerHTML = `
        <div class="p-empty-state">
          <div class="p-empty-icon">📂</div>
          <div class="p-empty-text">Select an item from the Explorer to begin</div>
          <div class="p-empty-hint">Press <code>Ctrl+K</code> for commands</div>
        </div>
    `;
    const inspector = document.getElementById("p-inspector");
    if (inspector) inspector.innerHTML = "";
    const info = document.getElementById("p-status-item-info");
    if (info) info.textContent = "";
}

// Explorer
function renderExplorer() {
    const el = document.getElementById("p-explorer");
    if (!el || !_state) return;
    
    // Group all drafts by kind
    const drafts = [
        ...(_state.nccLocalDrafts || []),
        ...(_state.nsrLocalDrafts || []),
        ...(_state.endorsementLocalDrafts || []),
        ...(_state.supportingLocalDrafts || [])
    ].filter(d => 
        !searchQuery || (d.d || "").toLowerCase().includes(searchQuery) || (d.title || "").toLowerCase().includes(searchQuery)
    );

    const published = (_state.nccDocs || []).filter(d => 
        !searchQuery || (d.d || "").toLowerCase().includes(searchQuery) || eventTagValue(d.tags, "title").toLowerCase().includes(searchQuery)
    );

    let html = "";
    
    // Drafts Section
    html += renderGroup("LOCAL DRAFTS", drafts, true);
    
    // Published Section
    html += renderGroup("PUBLISHED NETWORK", published, false);

    el.innerHTML = html;
}

function renderGroup(title, items, isDraft) {
    if (items.length === 0 && searchQuery) return "";
    
    let html = `<div class="p-nav-group">
        <div class="p-nav-header">
            <span>${title} (${items.length})</span>
            ${isDraft ? `<button class="p-create-btn" data-kind="${KINDS.ncc}" title="New NCC">+</button>` : ""}
        </div>
        <div class="p-nav-list">`;
    
    if (!items.length) {
        html += `<div class="p-nav-empty">No items found</div>`;
    } else {
        items.forEach(item => {
            const active = item.id === currentItemId ? " active" : "";
            const typeIcon = TYPE_ICONS[item.kind] || "📄";
            const id = item.d || "NCC-XX";
            const label = item.title || eventTagValue(item.tags, "title") || "Untitled";
            const status = (item.status || (isDraft ? "draft" : "published")).toLowerCase();
            
            html += `
                <div class="p-nav-item${active}" data-id="${item.id}" title="${esc(label)}">
                    <span class="p-nav-icon">${typeIcon}</span>
                    <div class="p-nav-body">
                        <div class="p-nav-id">${esc(id)}</div>
                        <div class="p-nav-label">${esc(label)}</div>
                    </div>
                    <div class="p-mini-status status-${status}"></div>
                </div>`;
        });
    }
    
    html += `</div></div>`;
    return html;
}

// Item Handling
function findItem(id) {
    if (!_state) return null;
    const all = [
        ...(_state.nccLocalDrafts || []), 
        ...(_state.nsrLocalDrafts || []),
        ...(_state.endorsementLocalDrafts || []),
        ...(_state.supportingLocalDrafts || []),
        ...(_state.nccDocs || [])
    ];
    const found = all.find(i => i && i.id === id);
    if (found) {
        found._isLocal = [
            ...(_state.nccLocalDrafts || []), 
            ...(_state.nsrLocalDrafts || []),
            ...(_state.endorsementLocalDrafts || []),
            ...(_state.supportingLocalDrafts || [])
        ].some(d => d.id === id) || (found.status === "draft");
    }
    return found;
}

function openItem(id) {
    const item = findItem(id);
    if (!item) return;
    
    currentItemId = id;
    isEditMode = false; 
    
    renderExplorer(); 
    renderContent(item);
    renderInspector(item);
    updateStatusItemInfo(item);
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
            <textarea class="p-editor-textarea" id="p-editor" spellcheck="false" placeholder="Write NCC content in Markdown..."></textarea>
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
        
        let headerHtml = `<div class="p-content-header">
            <h1>${esc(item.title || eventTagValue(item.tags, "title") || "Untitled")}</h1>
            <div class="p-content-meta">
                <span class="p-badge">${TYPE_LABELS[item.kind]}</span>
                <span class="p-badge status-${(item.status || "published").toLowerCase()}">${(item.status || "published").toUpperCase()}</span>
                <span>${item.d || ""}</span>
            </div>
        </div>`;
        
        view.innerHTML = headerHtml + renderMarkdown(item.content || "_No content available._");
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
    const author = item.author || item.pubkey || "Unknown";
    const publishedAt = item.published_at ? new Date(item.published_at * 1000).toLocaleString() : "Not published";
    
    el.innerHTML = `
        <div class="p-inspector-header">Inspector</div>
        
        <div class="p-section">
            <span class="p-section-title">Properties</span>
            <div class="p-prop-list">
                <div class="p-prop-row"><span class="p-prop-key">Type</span><span class="p-prop-val">${TYPE_LABELS[item.kind] || "Unknown"}</span></div>
                <div class="p-prop-row"><span class="p-prop-key">Identifier</span><span class="p-prop-val">${esc(item.d || "-")}</span></div>
                <div class="p-prop-row"><span class="p-prop-key">Status</span><span class="p-badge status-${status.toLowerCase()}">${status}</span></div>
                <div class="p-prop-row"><span class="p-prop-key">Author</span><span class="p-prop-val" title="${author}">${shortenKey(author)}</span></div>
                <div class="p-prop-row"><span class="p-prop-key">Published</span><span class="p-prop-val">${publishedAt}</span></div>
            </div>
        </div>
        
        <div class="p-section">
            <span class="p-section-title">Actions</span>
            <div class="p-inspector-actions" id="p-inspector-actions"></div>
        </div>
        
        ${item.tags ? `
        <div class="p-section">
            <span class="p-section-title">Tags</span>
            <div class="p-tag-cloud">
                ${renderTags(item)}
            </div>
        </div>` : ""}
        
        <div class="p-section">
            <span class="p-section-title">Nostr Network</span>
            <div class="p-network-info">
                ${item.event_id 
                    ? `<div class="p-event-id"><code>${item.event_id}</code></div>` 
                    : `<div class="p-muted-text">Not indexed on relays</div>`}
            </div>
        </div>
    `;
    
    const actionsContainer = document.getElementById("p-inspector-actions");
    
    if (item._isLocal) {
        // LOCAL DRAFT ACTIONS
        const editBtn = document.createElement("button");
        editBtn.className = isEditMode ? "p-btn-primary" : "p-btn-ghost";
        editBtn.innerHTML = isEditMode ? "💾 Save Changes (Ctrl+S)" : "✎ Edit Draft";
        editBtn.onclick = () => {
            if (isEditMode) handleSaveShortcut();
            else {
                isEditMode = true;
                renderContent(item);
                renderInspector(item);
            }
        };
        actionsContainer.appendChild(editBtn);
        
        if (isEditMode) {
            const cancelBtn = document.createElement("button");
            cancelBtn.className = "p-btn-ghost";
            cancelBtn.textContent = "Cancel Edit";
            cancelBtn.onclick = () => { isEditMode = false; renderContent(item); renderInspector(item); };
            actionsContainer.appendChild(cancelBtn);
        }

        const publishBtn = document.createElement("button");
        publishBtn.className = "p-btn-accent";
        publishBtn.textContent = "🚀 Publish to Relays";
        publishBtn.onclick = () => { if(confirm("Publish this " + TYPE_LABELS[item.kind] + "?")) actions.publishDraft?.(item, TYPE_LABELS[item.kind].toLowerCase()); };
        actionsContainer.appendChild(publishBtn);
    } else {
        // PUBLISHED ITEM ACTIONS
        const reviseBtn = document.createElement("button");
        reviseBtn.className = "p-btn-accent";
        reviseBtn.textContent = "🔄 Create Revision";
        reviseBtn.onclick = async () => {
            const draft = actions.createRevisionDraft?.(item, _state.nccLocalDrafts);
            if (draft) {
                await actions.saveItem?.(draft.id, draft.content, draft);
                openItem(draft.id);
                isEditMode = true;
                renderContent(draft);
                renderInspector(draft);
            }
        };
        actionsContainer.appendChild(reviseBtn);
        
        const endorseBtn = document.createElement("button");
        endorseBtn.className = "p-btn-ghost";
        endorseBtn.textContent = "✅ Endorse this NCC";
        endorseBtn.onclick = () => {
            // Logic to switch to endorsement creation
            updateStatus("Switching to endorsement mode...");
        };
        actionsContainer.appendChild(endorseBtn);
    }
}

function renderTags(item) {
    if (!item.tags) return "";
    if (Array.isArray(item.tags)) {
        return item.tags.map(t => `<span class="p-tag-pill"><b>${t[0]}</b>: ${t[1]}</span>`).join("");
    }
    return Object.entries(item.tags).map(([k, v]) => {
        const val = Array.isArray(v) ? v.join(", ") : v;
        return val ? `<span class="p-tag-pill"><b>${k}</b>: ${esc(val)}</span>` : "";
    }).join("");
}

// Commands & Palette
const COMMANDS = [
    { id: "save", title: "Save Current Draft", kb: "Ctrl+S", run: () => handleSaveShortcut() },
    { id: "new", title: "New NCC Draft", kb: "Ctrl+N", run: () => actions.openNewNcc?.() },
    { id: "classic", title: "Switch to Classic UI", kb: "", run: () => actions.switchShell?.("classic") },
    { id: "refresh", title: "Refresh Data", kb: "Ctrl+R", run: () => window.location.reload() },
    { id: "clear", title: "Clear Console", kb: "Esc", run: () => renderEmptyState() }
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
            if (document.getElementById("p-palette-overlay").style.display !== "none") {
                toggleCommandPalette(false);
            } else if (isEditMode) {
                isEditMode = false;
                const item = findItem(currentItemId);
                if (item) {
                    renderContent(item);
                    renderInspector(item);
                }
            }
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
            <div class="p-palette-body">
                <span class="p-palette-title">${esc(c.title)}</span>
                <span class="p-palette-id">${c.id}</span>
            </div>
            <span class="p-palette-kb">${c.kb}</span>
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
        updateStatus("Cannot save: Published items are read-only.");
        return;
    }
    
    const editor = document.getElementById("p-editor");
    if (!editor) return;
    
    const content = editor.value;
    updateStatus("Saving...");
    await actions.saveItem(currentItemId, content, item);
    updateStatus(`Saved at ${new Date().toLocaleTimeString()}`);
    
    // Refresh inspector to show it's saved/not editing status if needed
    // Actually, keep editing mode but clear unsaved mark
}
