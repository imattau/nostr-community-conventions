import { esc, renderMarkdown, eventTagValue, shortenKey, normalizeEventId } from "./utils.js";
import { KINDS } from "./state.js";

let actions = {};
let currentItemId = null;
let isEditMode = false;
let searchQuery = "";
let _state = null;
let listenersSetup = false;
let keyboardHooked = false;
let paletteMatches = [];
let paletteIndex = 0;
const collapsedBranches = new Set();

const TYPE_LABELS = {
    [KINDS.ncc]: "NCC",
    [KINDS.nsr]: "NSR",
    [KINDS.endorsement]: "Endorsement",
    [KINDS.supporting]: "Supporting"
};

const REVISION_DESCRIPTORS = ["latest", "previous revision", "earlier revision"];

function ensureTimestamp(value) {
    if (!value) return null;
    return value > 1e12 ? value : value * 1000;
}

function formatShortDate(value) {
    const ts = ensureTimestamp(value);
    if (!ts) return "—";
    return new Date(ts).toLocaleDateString();
}

function formatFullDate(value) {
    const ts = ensureTimestamp(value);
    if (!ts) return "-";
    return new Date(ts).toLocaleString();
}

// Initialization
export function initPowerShell(state, appActions) {
  _state = state;
  actions = appActions || {};
  const shell = document.getElementById("shell-power");
  if (!shell) return;

  if (!shell.innerHTML.includes("p-topbar")) {
    shell.innerHTML = `
      <header class="p-topbar">
        <div class="p-brand" role="button">
          <span class="p-accent">></span> NCC Console
          <span class="p-version">v0.1</span>
        </div>
        <div class="p-top-center">
          <div class="p-search-wrapper">
            <span class="p-search-icon">🔍</span>
            <input class="p-top-search" id="p-search" placeholder="Search NCCs..." />
            <span class="p-search-kb">Ctrl+K</span>
          </div>
        </div>
          <div class="p-top-right">
             <div id="p-top-signer" class="p-signer-status"></div>
          </div>
        </header>

      <div class="p-main">
        <aside class="p-pane p-explorer">
          <div id="p-explorer-body" class="p-scroll"></div>
        </aside>
        <section class="p-pane p-content">
          <div id="p-content-column" class="p-content-inner">
            <div class="p-empty-state">
              <div class="p-empty-icon">📂</div>
              <div class="p-empty-text">Select an item from the Explorer to begin</div>
              <div class="p-empty-hint">Press <code>Ctrl+K</code> for commands</div>
            </div>
          </div>
        </section>
        <aside class="p-pane p-inspector">
          <div id="p-inspector-body" class="p-inspector-inner"></div>
        </aside>
      </div>

      <footer class="p-status">
        <div class="p-status-left">
          <div id="p-status-relays">Relays: 0</div>
        </div>
        <div class="p-status-right">
          <div id="p-status-msg">Ready</div>
          <div id="p-status-online" class="offline">Offline</div>
        </div>
      </footer>

      <div id="p-palette-overlay" class="p-palette-overlay" hidden style="display: none;">
        <div class="p-palette">
          <input class="p-palette-input" id="p-palette-input" placeholder="Type a command or search..." autocomplete="off" />
          <div class="p-palette-list" id="p-palette-list"></div>
        </div>
      </div>
    `;
  }

  if (!listenersSetup) {
    setupGlobalListeners();
    setupKeyboardShortcuts();
    listenersSetup = true;
  }

  refreshUI();
}

function setupGlobalListeners() {
    const searchInput = document.getElementById("p-search");
    searchInput?.addEventListener("input", (e) => {
        searchQuery = e.target.value.toLowerCase();
        renderExplorer();
    });

    const explorerBody = document.getElementById("p-explorer-body");
    explorerBody?.addEventListener("click", (e) => {
        const branch = e.target.closest("[data-branch]");
        if (branch) {
            toggleBranch(branch.dataset.branch);
            return;
        }

        const item = e.target.closest(".p-nav-item");
        if (item && item.dataset.id) {
            openItem(item.dataset.id);
        }
    });

    const brand = document.querySelector(".p-brand");
    brand && (brand.onclick = () => {
        currentItemId = null;
        isEditMode = false;
        renderEmptyState();
        renderExplorer();
        renderInspector();
    });

    const paletteList = document.getElementById("p-palette-list");
    paletteList?.addEventListener("click", (e) => {
        const item = e.target.closest(".p-palette-item");
        if (item && item.dataset.cmd) {
            executeCommand(item.dataset.cmd);
        }
    });

    const overlay = document.getElementById("p-palette-overlay");
    overlay?.addEventListener("click", (e) => {
        if (e.target === overlay) toggleCommandPalette(false);
    });

    const paletteInput = document.getElementById("p-palette-input");
    paletteInput?.addEventListener("input", (e) => {
        renderCommandList(e.target.value);
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
                <span>Signer: ${esc(name)}</span>
            </div>
        `;
    } else {
        el.innerHTML = `
            <div class="p-signer-pill">
                <span class="p-signer-dot"></span>
                <span>Signer: Not connected</span>
            </div>
        `;
    }
}

function renderStatusBar() {
    const r = document.getElementById("p-status-relays");
    if (r && _state) r.textContent = `Relays: ${_state.relayStatus?.relays || 0}`;
    const onlineEl = document.getElementById("p-status-online");
    if (onlineEl) {
        const online = typeof navigator !== "undefined" ? navigator.onLine : true;
        onlineEl.textContent = online ? "Online" : "Offline";
        onlineEl.classList.toggle("online", online);
        onlineEl.classList.toggle("offline", !online);
    }
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
    const inspector = document.getElementById("p-inspector-body");
    if (inspector) inspector.innerHTML = "";
}


// Explorer
function renderExplorer() {
    const el = document.getElementById("p-explorer-body");
    if (!el || !_state) return;

    const query = searchQuery.trim();
    const local = [
        ...(_state.nccLocalDrafts || []),
        ...(_state.nsrLocalDrafts || []),
        ...(_state.endorsementLocalDrafts || []),
        ...(_state.supportingLocalDrafts || [])
    ];
    const published = _state.nccDocs || [];

    const filteredLocal = filterExplorerItems(local, query, true);
    const filteredPublished = filterExplorerItems(published, query, false);

    const sections = [
        { title: "Local Drafts", items: filteredLocal, type: "local" },
        { title: "Published Network", items: filteredPublished, type: "published" }
    ];

    el.innerHTML = sections.map(renderExplorerSection).join("");
}

function filterExplorerItems(items, query, isDraft) {
    if (!items.length) return [];
    return items
        .filter((item) => {
            if (!query) return true;
            const label = (item.d || "").toLowerCase();
            const title = (item.title || eventTagValue(item.tags, "title") || "").toLowerCase();
            return label.includes(query) || title.includes(query);
        })
        .sort((a, b) => {
            const aTs = ensureTimestamp(a.updated_at || a.created_at);
            const bTs = ensureTimestamp(b.updated_at || b.created_at);
            return (bTs || 0) - (aTs || 0);
        });
}

function renderExplorerSection(section) {
    const { title, items, type } = section;
    const groups = buildRevisionGroups(items);
    return `
        <div class="p-nav-group">
            <div class="p-nav-header">
                <span>${title} (${items.length})</span>
            </div>
            ${groups.length ? groups.map((group) => renderExplorerBranch(group, type)).join("") : `<div class="p-nav-empty">No items found</div>`}
        </div>
    `;
}

function buildRevisionGroups(items) {
    const map = new Map();
    items.forEach((item) => {
        const key = (item.d || "").toUpperCase().trim() || "Untitled";
        const bucket = map.get(key) || [];
        bucket.push(item);
        map.set(key, bucket);
    });

    return Array.from(map.entries())
        .map(([key, list]) => {
            return {
                label: key,
                rawKey: key,
                entries: list
                    .map((item) => ({ item, depth: computeRevisionDepth(item, list) }))
                    .sort((a, b) => {
                        if (b.depth !== a.depth) return b.depth - a.depth;
                        const aTs = ensureTimestamp(a.item.updated_at || a.item.created_at);
                        const bTs = ensureTimestamp(b.item.updated_at || b.item.created_at);
                        return (bTs || 0) - (aTs || 0);
                    })
            };
        })
        .sort((a, b) => {
            const aTs = ensureTimestamp(a.entries[0]?.item.updated_at || a.entries[0]?.item.created_at);
            const bTs = ensureTimestamp(b.entries[0]?.item.updated_at || b.entries[0]?.item.created_at);
            return (bTs || 0) - (aTs || 0);
        });
}

function computeRevisionDepth(item, peers) {
    const visited = new Set();
    function depth(current) {
        const key = normalizeEventId(current.event_id || current.id || current.d);
        if (!key || visited.has(key)) return 0;
        visited.add(key);
        let depthValue = 0;
        const supersedes = (current.tags?.supersedes || [])
            .map((val) => normalizeEventId(val))
            .filter(Boolean);
        supersedes.forEach((targetId) => {
            const target = peers.find((entry) => {
                const candidateKey = normalizeEventId(entry.event_id || entry.id || entry.d);
                return candidateKey === targetId;
            });
            if (target) {
                depthValue = Math.max(depthValue, 1 + depth(target));
            }
        });
        visited.delete(key);
        return depthValue;
    }
    return depth(item);
}

function renderExplorerBranch(group, type) {
    const branchKey = `${type}:${group.rawKey}`;
    const isClosed = collapsedBranches.has(branchKey);
    const firstEntry = group.entries[0];
    const status = determineStatus(firstEntry?.item, type);
    const badgeLabel = status === "published" ? "PUB" : status === "withdrawn" ? "WITH" : "DRAFT";
    return `
        <div class="p-nav-tree">
            <button class="p-nav-branch-header" data-branch="${branchKey}">
                <span class="p-nav-branch-icon">${isClosed ? "▸" : "▾"}</span>
                <span>${esc(group.label)}</span>
                <span class="p-badge-mini status-${status}">${badgeLabel}</span>
            </button>
            <div class="p-nav-branch-body ${isClosed ? "" : "is-open"}">
                ${group.entries.map((entry, idx) => renderExplorerItem(entry, idx, status)).join("")}
            </div>
        </div>
    `;
}

function renderExplorerItem(entry, idx, inheritedStatus) {
    const { item } = entry;
    const isActive = item.id === currentItemId ? " active" : "";
    const status = normalizeStatus(item.status || inheritedStatus);
    const statusLabel =
        status === "published" ? "PUB" : status === "withdrawn" ? "WITH" : "DRAFT";
    const baseId = (item.d || "").toUpperCase() || "UNTITLED";
    const title = item.title || eventTagValue(item.tags, "title") || "Untitled";
    const dateStr = formatShortDate(item.updated_at || item.created_at);
    const suffix =
        idx === 0
            ? ""
            : ` (${REVISION_DESCRIPTORS[Math.min(idx, REVISION_DESCRIPTORS.length - 1)]})`;
    return `
        <div class="p-nav-item${isActive}" data-id="${item.id}" title="${esc(title)}">
            <div class="p-nav-meta">
                <span class="p-nav-id">${esc(baseId)}</span>
                <span class="p-badge-mini status-${status}">${statusLabel}</span>
            </div>
            <div class="p-nav-label">${esc(title)}${suffix}</div>
            <div class="p-nav-date">${dateStr}</div>
        </div>
    `;
}

function toggleBranch(id) {
    if (!id) return;
    if (collapsedBranches.has(id)) collapsedBranches.delete(id);
    else collapsedBranches.add(id);
    renderExplorer();
}

function determineStatus(item, type) {
    if (!item) return type === "local" ? "draft" : "published";
    if (item.status) return item.status.toLowerCase();
    return type === "local" ? "draft" : "published";
}

function normalizeStatus(status) {
    if (!status) return "draft";
    const val = status.toLowerCase();
    if (val === "published") return "published";
    if (val === "withdrawn") return "withdrawn";
    return "draft";
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
    const el = document.getElementById("p-inspector-body");
    if (!el) return;
    if (!item) {
        el.innerHTML = `
            <div class="p-section">
                <span class="p-section-title">Inspector</span>
                <p class="p-nav-label">Select an NCC to view metadata and actions.</p>
            </div>
        `;
        return;
    }

    const title = item.title || eventTagValue(item.tags, "title") || "Untitled";
    const status = normalizeStatus(item.status || "published");
    const author = item.author || item.pubkey || "Unknown";
    const updatedAt = formatFullDate(item.updated_at || item.created_at);
    const supersedes = Array.isArray(item.tags?.supersedes) ? item.tags.supersedes : [];
    const badgeLabel = status.toUpperCase();
    const relayStatus = _state?.relayStatus || {};
    const lastSync = relayStatus.at ? new Date(relayStatus.at).toLocaleTimeString() : "-";
    const networkDetails = `
        <div class="p-prop-row"><span class="p-prop-key">Identifier</span><span class="p-prop-val">${esc(item.d || "-")}</span></div>
        <div class="p-prop-row"><span class="p-prop-key">Event</span><span class="p-prop-val">${esc(item.event_id || "Draft")}</span></div>
        <div class="p-prop-row"><span class="p-prop-key">Author</span><span class="p-prop-val" title="${esc(author)}">${shortenKey(author)}</span></div>
        <div class="p-prop-row"><span class="p-prop-key">Updated</span><span class="p-prop-val">${updatedAt}</span></div>
        ${supersedes.length ? `<div class="p-prop-row"><span class="p-prop-key">Supersedes</span><span class="p-prop-val">${esc(supersedes.join(", "))}</span></div>` : ""}
    `;

    el.innerHTML = `
        <div class="p-section">
            <span class="p-section-title">Item Metadata</span>
            <div class="p-prop-row"><span class="p-prop-key">Title</span><span class="p-prop-val">${esc(title)}</span></div>
            <div class="p-prop-row"><span class="p-prop-key">Status</span><span class="p-badge-mini status-${status}">${badgeLabel}</span></div>
            ${networkDetails}
        </div>
        <div class="p-section">
            <span class="p-section-title">Actions</span>
            <div class="p-inspector-actions" id="p-inspector-actions"></div>
        </div>
        <div class="p-section">
            <span class="p-section-title">Relay Status</span>
            <div class="p-prop-row"><span class="p-prop-key">Relays</span><span class="p-prop-val">${relayStatus.relays || 0}</span></div>
            <div class="p-prop-row"><span class="p-prop-key">Events</span><span class="p-prop-val">${relayStatus.events || 0}</span></div>
            <div class="p-prop-row"><span class="p-prop-key">Last sync</span><span class="p-prop-val">${lastSync}</span></div>
        </div>
    `;

    const actionsContainer = document.getElementById("p-inspector-actions");
    if (!actionsContainer) return;
    actionsContainer.innerHTML = "";

    if (item._isLocal) {
        const editBtn = document.createElement("button");
        editBtn.className = isEditMode ? "p-btn-primary" : "p-btn-accent";
        editBtn.textContent = isEditMode ? "View" : "Edit";
        editBtn.onclick = () => {
            isEditMode = !isEditMode;
            renderContent(item);
            renderInspector(item);
        };
        actionsContainer.appendChild(editBtn);

        if (isEditMode) {
            const saveBtn = document.createElement("button");
            saveBtn.className = "p-btn-accent";
            saveBtn.textContent = "Save (Ctrl+S)";
            saveBtn.onclick = handleSaveShortcut;
            actionsContainer.appendChild(saveBtn);

            const cancelBtn = document.createElement("button");
            cancelBtn.className = "p-btn-ghost";
            cancelBtn.textContent = "Cancel";
            cancelBtn.onclick = () => {
                isEditMode = false;
                const found = findItem(currentItemId);
                if (found) {
                    renderContent(found);
                    renderInspector(found);
                }
            };
            actionsContainer.appendChild(cancelBtn);
        }

        const publishBtn = document.createElement("button");
        publishBtn.className = "p-btn-ghost";
        publishBtn.textContent = "Publish";
        publishBtn.onclick = () => {
            if (confirm(`Publish this ${TYPE_LABELS[item.kind]}?`)) {
                actions.publishDraft?.(item, TYPE_LABELS[item.kind].toLowerCase());
            }
        };
        actionsContainer.appendChild(publishBtn);
    } else {
        const reviseBtn = document.createElement("button");
        reviseBtn.className = "p-btn-accent";
        reviseBtn.textContent = "Revise";
        reviseBtn.onclick = async () => {
            const draft = await actions.createRevisionDraft?.(item, _state.nccLocalDrafts);
            if (draft) {
                await actions.saveItem?.(draft.id, draft.content, draft);
                openItem(draft.id);
                isEditMode = true;
                renderContent(draft);
                renderInspector(draft);
            }
        };
        actionsContainer.appendChild(reviseBtn);

        if (actions.withdrawDraft) {
            const withdrawBtn = document.createElement("button");
            withdrawBtn.className = "p-btn-ghost";
            withdrawBtn.textContent = "Withdraw";
            withdrawBtn.onclick = () => actions.withdrawDraft?.(item.id);
            actionsContainer.appendChild(withdrawBtn);
        }
    }
}


// Commands & Palette
const COMMANDS = [
    { id: "save", title: "Save", kb: "Ctrl+S", run: () => handleSaveShortcut() },
    { id: "new", title: "New NCC Draft", kb: "Ctrl+N", run: () => actions.openNewNcc?.() },
    { id: "reload", title: "Reload", kb: "Ctrl+R", run: () => window.location.reload() }
];

function setupKeyboardShortcuts() {
    if (keyboardHooked) return;
    keyboardHooked = true;

    document.addEventListener("keydown", (e) => {
        const paletteOverlay = document.getElementById("p-palette-overlay");
        const paletteActive = paletteOverlay && !paletteOverlay.hidden;

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
            e.preventDefault();
            toggleCommandPalette();
            return;
        }

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
            if (isEditMode) {
                e.preventDefault();
                handleSaveShortcut();
            }
            return;
        }

        if (paletteActive) {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                if (paletteMatches.length) {
                    paletteIndex = (paletteIndex + 1) % paletteMatches.length;
                    highlightPaletteSelection();
                }
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                if (paletteMatches.length) {
                    paletteIndex = (paletteIndex - 1 + paletteMatches.length) % paletteMatches.length;
                    highlightPaletteSelection();
                }
            } else if (e.key === "Enter") {
                e.preventDefault();
                const cmd = paletteMatches[paletteIndex];
                if (cmd) {
                    executeCommand(cmd.id);
                }
            } else if (e.key === "Escape") {
                e.preventDefault();
                toggleCommandPalette(false);
            }
            return;
        }

        if (e.key === "Escape" && isEditMode) {
            isEditMode = false;
            const item = findItem(currentItemId);
            if (item) {
                renderContent(item);
                renderInspector(item);
            }
        }
    });
}

function toggleCommandPalette(show) {
    const overlay = document.getElementById("p-palette-overlay");
    const input = document.getElementById("p-palette-input");
    if (!overlay || !input) return;
    
    const shouldShow = show !== undefined ? show : overlay.hidden;
    overlay.hidden = !shouldShow;
    overlay.style.display = shouldShow ? "flex" : "none";
    
    if (shouldShow) {
        input.value = "";
        renderCommandList("");
        input.focus();
    } else {
        paletteMatches = [];
        paletteIndex = 0;
    }
}

function renderCommandList(query) {
    const list = document.getElementById("p-palette-list");
    if (!list) return;
    const q = (query || "").toLowerCase();
    const matches = COMMANDS.filter((c) => c.title.toLowerCase().includes(q));
    paletteMatches = matches;
    paletteIndex = 0;
    list.innerHTML = matches
        .map(
            (c, index) => `
        <div class="p-palette-item${index === paletteIndex ? " selected" : ""}" data-cmd="${c.id}" data-index="${index}">
            <div class="p-palette-body">
                <span class="p-palette-title">${esc(c.title)}</span>
                <span class="p-palette-id">${c.id}</span>
            </div>
            <span class="p-palette-kb">${c.kb}</span>
        </div>
    `
        )
        .join("");
    highlightPaletteSelection();
}

function highlightPaletteSelection() {
    const items = document.querySelectorAll(".p-palette-item");
    items.forEach((node, index) => {
        node.classList.toggle("selected", index === paletteIndex);
    });
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
    if (!item) return;

    if (!item._isLocal) {
        updateStatus("Saving blocked: Published items are read-only.");
        return;
    }
    
    const editor = document.getElementById("p-editor");
    if (!editor) return;
    
    const content = editor.value;
    updateStatus("Saving...");
    try {
        await actions.saveItem(currentItemId, content, item);
        updateStatus(`Saved at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
        // Refresh local item content in our state if necessary
        item.content = content;
        renderInspector(item);
        renderExplorer();
    } catch (e) {
        updateStatus("Save failed");
    }
}
