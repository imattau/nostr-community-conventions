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
    const shell = document.getElementById("shell-power");
    if (!shell) return;

    // Use delegation on the root shell for dynamic parts
    shell.addEventListener("click", (e) => {
        // Explorer Item Click
        const navItem = e.target.closest(".p-nav-item");
        if (navItem && navItem.dataset.id) {
            openItem(navItem.dataset.id);
            return;
        }

        // Explorer Branch Toggle
        const branch = e.target.closest("[data-branch]");
        if (branch) {
            toggleBranch(branch.dataset.branch);
            return;
        }

        // Brand Click (Reset)
        const brand = e.target.closest(".p-brand");
        if (brand) {
            currentItemId = null;
            isEditMode = false;
            renderEmptyState();
            renderExplorer();
            renderInspector();
            return;
        }

        // Command Palette Item Click
        const paletteItem = e.target.closest(".p-palette-item");
        if (paletteItem && paletteItem.dataset.cmd) {
            executeCommand(paletteItem.dataset.cmd);
            return;
        }

        // Command Palette Overlay Click (Close)
        const overlay = document.getElementById("p-palette-overlay");
        if (e.target === overlay) {
            toggleCommandPalette(false);
            return;
        }
    });

    const searchInput = document.getElementById("p-search");
    searchInput?.addEventListener("input", (e) => {
        searchQuery = e.target.value.toLowerCase();
        renderExplorer();
    });

    const paletteInput = document.getElementById("p-palette-input");
    paletteInput?.addEventListener("input", (e) => {
        renderCommandList(e.target.value);
    });

    // Inspector input syncing (Delegation)
    const inspector = document.getElementById("p-inspector-body");
    shell.addEventListener("input", (e) => {
        if (!isEditMode || !currentItemId) return;
        
        const target = e.target;
        if (!target.closest("#p-inspector-body")) return;
        
        const item = findItem(currentItemId);
        if (!item) return;

        const key = target.name;
        if (!key) return;

        updateStatus("• Unsaved changes");

        if (key === "title") {
            item.title = target.value;
        } else if (key === "d") {
            item.d = target.value.startsWith("ncc-") ? target.value : `ncc-${target.value.replace(/\D/g, "")}`;
        } else if (key.startsWith("tag:")) {
            const tagName = key.split(":")[1];
            item.tags = item.tags || {};
            
            const arrayTags = ["topics", "authors", "supersedes", "roles", "t"];
            if (arrayTags.includes(tagName)) {
                item.tags[tagName] = target.value.split(",").map(s => s.trim()).filter(Boolean);
            } else {
                item.tags[tagName] = target.value;
            }
        }
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
    
    // Pool all items with conceptual de-duplication
    // Conceptual Identity = event_id if it exists, otherwise internal id
    const conceptualMap = new Map();
    
    const addToPool = (items) => {
        (items || []).forEach(rawItem => {
            if (!rawItem) return;
            
            let item = rawItem;
            // If it looks like a raw Nostr event, convert it
            if (!item.d && rawItem.tags) {
                item = payloadToDraft(rawItem);
            }

            const identity = item.event_id || item.id;
            const existing = conceptualMap.get(identity);
            
            if (!existing) {
                conceptualMap.set(identity, item);
            } else {
                // Prefer local source or newer timestamp
                const existingTs = ensureTimestamp(existing.updated_at || existing.created_at) || 0;
                const newTs = ensureTimestamp(item.updated_at || item.created_at) || 0;
                
                if (item.source === "local" || newTs > existingTs) {
                    conceptualMap.set(identity, item);
                }
            }
        });
    };

    addToPool(_state.nccLocalDrafts);
    addToPool(_state.nsrLocalDrafts);
    addToPool(_state.endorsementLocalDrafts);
    addToPool(_state.supportingLocalDrafts);
    addToPool(_state.nccDocs);
    addToPool(_state.remoteDrafts);

    const allItems = Array.from(conceptualMap.values());

    const publishedPool = allItems.filter(i => 
        i.event_id && (i.status || "").toLowerCase() === "published"
    );
    const draftsPool = allItems.filter(i => 
        (i.status || "").toLowerCase() !== "published" || !i.event_id
    );

    const sections = [
        { title: "Drafts", items: filterExplorerItems(draftsPool, query), type: "drafts" },
        { title: "Published", items: filterExplorerItems(publishedPool, query), type: "published" }
    ];

    el.innerHTML = sections.map(renderExplorerSection).join("");
}

function filterExplorerItems(items, query) {
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
    const { title, items, type: sectionType } = section;
    const groups = buildRevisionGroups(items);
    return `
        <div class="p-nav-group">
            <div class="p-nav-header">
                <span>${title} (${items.length})</span>
            </div>
            ${groups.length ? groups.map((group) => renderExplorerBranch(group, sectionType)).join("") : `<div class="p-nav-empty">No items found</div>`}
        </div>
    `;
}

function buildRevisionGroups(items) {
    const dMap = new Map();
    items.forEach((item) => {
        const d = (item.d || "").toUpperCase().trim() || "UNTITLED";
        const bucket = dMap.get(d) || [];
        bucket.push(item);
        dMap.set(d, bucket);
    });

    return Array.from(dMap.entries())
        .map(([d, groupItems]) => {
            const byKind = {
                [KINDS.ncc]: groupItems.filter(i => i.kind === KINDS.ncc),
                [KINDS.nsr]: groupItems.filter(i => i.kind === KINDS.nsr),
                [KINDS.endorsement]: groupItems.filter(i => i.kind === KINDS.endorsement),
                [KINDS.supporting]: groupItems.filter(i => i.kind === KINDS.supporting)
            };

            // Sort helper for internal versions
            const sortItems = (list) => {
                return list.map(item => ({ 
                    item, 
                    depth: computeRevisionDepth(item, list) 
                })).sort((a, b) => {
                    if (b.depth !== a.depth) return b.depth - a.depth;
                    const aTs = ensureTimestamp(a.item.updated_at || a.item.created_at);
                    const bTs = ensureTimestamp(b.item.updated_at || b.item.created_at);
                    return (bTs || 0) - (aTs || 0);
                });
            };

            return {
                label: d,
                rawKey: d,
                kinds: {
                    ncc: sortItems(byKind[KINDS.ncc]),
                    nsr: sortItems(byKind[KINDS.nsr]),
                    endorsement: sortItems(byKind[KINDS.endorsement]),
                    supporting: sortItems(byKind[KINDS.supporting])
                },
                // Use the latest NCC or the latest item overall for the group timestamp
                latestTs: Math.max(...groupItems.map(i => ensureTimestamp(i.updated_at || i.created_at) || 0))
            };
        })
        .sort((a, b) => b.latestTs - a.latestTs);
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

function renderExplorerBranch(group, sectionType) {
    const branchKey = `${sectionType}:${group.rawKey}`;
    const isClosed = collapsedBranches.has(branchKey);
    
    // Main group identity comes from the latest NCC item if it exists
    const mainNcc = group.kinds.ncc[0]?.item;
    const title = mainNcc ? (mainNcc.title || eventTagValue(mainNcc.tags, "title")) : group.label;
    const status = determineStatus(mainNcc || group.kinds.endorsement[0]?.item || group.kinds.supporting[0]?.item || group.kinds.nsr[0]?.item, sectionType);
    const badgeLabel = status === "published" ? "PUB" : status === "withdrawn" ? "WITH" : "DRAFT";

    let bodyHtml = "";
    
    // 1. NCC Revisions (Directly under the branch)
    if (group.kinds.ncc.length) {
        bodyHtml += group.kinds.ncc.map((entry, idx) => renderExplorerItem(entry, idx, status)).join("");
    }

    // 2. Sub-trees for other types
    const subTrees = [
        { key: "endorsement", label: "Endorsements", items: group.kinds.endorsement },
        { key: "nsr", label: "Succession", items: group.kinds.nsr },
        { key: "supporting", label: "Supporting Docs", items: group.kinds.supporting }
    ];

    subTrees.forEach(sub => {
        if (sub.items.length) {
            const subKey = `${branchKey}:${sub.key}`;
            const subClosed = collapsedBranches.has(subKey);
            bodyHtml += `
                <div class="p-nav-tree p-nav-subtree">
                    <button class="p-nav-branch-header" data-branch="${subKey}">
                        <span class="p-nav-branch-icon">${subClosed ? "▸" : "▾"}</span>
                        <span class="p-nav-branch-title">
                            <span class="p-type-tag">${sub.label}</span>
                            <small class="p-muted-text">(${sub.items.length})</small>
                        </span>
                    </button>
                    <div class="p-nav-branch-body ${subClosed ? "" : "is-open"}">
                        ${sub.items.map((entry, idx) => renderExplorerItem(entry, idx, "published")).join("")}
                    </div>
                </div>
            `;
        }
    });

    return `
        <div class="p-nav-tree">
            <button class="p-nav-branch-header" data-branch="${branchKey}">
                <span class="p-nav-branch-icon">${isClosed ? "▸" : "▾"}</span>
                <span class="p-nav-branch-title">${esc(group.label)} <small class="p-nav-label-muted" style="margin-left:8px">${esc(shortenKey(title, 20, 0))}</small></span>
                <span class="p-badge-mini status-${status}">${badgeLabel}</span>
            </button>
            <div class="p-nav-branch-body ${isClosed ? "" : "is-open"}">
                ${bodyHtml}
            </div>
        </div>
    `;
}

function renderExplorerItem(entry, idx, inheritedStatus) {
    const { item } = entry;
    const identity = item.event_id || item.id;
    const isActive = identity === currentItemId ? " active" : "";
    const status = normalizeStatus(item.status || inheritedStatus);
    const statusLabel =
        status === "published" ? "PUB" : status === "withdrawn" ? "WITH" : "DRAFT";
    
    const title = item.title || eventTagValue(item.tags, "title") || "Untitled";
    const dateStr = formatShortDate(item.updated_at || item.created_at);
    
    // Simplified label for revisions
    let label = title;
    if (item.kind === KINDS.ncc) {
        if (idx > 0) label = REVISION_DESCRIPTORS[Math.min(idx, REVISION_DESCRIPTORS.length - 1)];
    } else {
        // For sub-tree items, show the author or a short summary
        const author = item.author_pubkey || item.author || item.pubkey || "";
        label = `${shortenKey(author)} · ${formatShortDate(item.updated_at || item.created_at)}`;
    }

    return `
        <div class="p-nav-item${isActive}" data-id="${identity}" title="${esc(title)}">
            <div class="p-nav-meta">
                <span class="p-nav-label">${esc(label)}</span>
                <span class="p-badge-mini status-${status}">${statusLabel}</span>
            </div>
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
    if (item && item.status) return item.status.toLowerCase();
    return type === "published" ? "published" : "draft";
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
    if (!_state || !id) return null;
    
    // Pool everything together
    const all = [
        ...(_state.nccLocalDrafts || []), 
        ...(_state.nsrLocalDrafts || []),
        ...(_state.endorsementLocalDrafts || []),
        ...(_state.supportingLocalDrafts || []),
        ...(_state.nccDocs || []),
        ...(_state.remoteDrafts || [])
    ];
    
    // Find the item by its identity (event_id or local id)
    const found = all.find(i => i && (i.id === id || i.event_id === id));
    if (!found) return null;

    // To determine if it's local, we need to see if it exists in our local draft sets
    // regardless of whether we found it by its UUID or its event_id.
    const localPool = [
        ...(_state.nccLocalDrafts || []), 
        ...(_state.nsrLocalDrafts || []),
        ...(_state.endorsementLocalDrafts || []),
        ...(_state.supportingLocalDrafts || [])
    ];
    
    found._isLocal = localPool.some(d => d.id === found.id || (d.event_id && d.event_id === found.event_id));
    
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
                <p class="p-nav-label">Select an item to view metadata and actions.</p>
            </div>
        `;
        return;
    }

    const title = item.title || eventTagValue(item.tags, "title") || "Untitled";
    const status = normalizeStatus(item.status || "published");
    const author = item.author || item.pubkey || "Unknown";
    const updatedAt = formatFullDate(item.updated_at || item.created_at);
    const badgeLabel = status.toUpperCase();
    const relayStatus = _state?.relayStatus || {};
    const lastSync = relayStatus.at ? new Date(relayStatus.at).toLocaleTimeString() : "-";

    const isLocalDraft = item._isLocal;

    let metadataContent = "";
    if (isEditMode && isLocalDraft) {
        metadataContent = renderEditFields(item);
    } else {
        const supersedes = Array.isArray(item.tags?.supersedes) ? item.tags.supersedes : [];
        metadataContent = `
            <div class="p-prop-row"><span class="p-prop-key">Title</span><span class="p-prop-val">${esc(title)}</span></div>
            <div class="p-prop-row"><span class="p-prop-key">Status</span><span class="p-badge-mini status-${status}">${badgeLabel}</span></div>
            <div class="p-prop-row"><span class="p-prop-key">Identifier</span><span class="p-prop-val">${esc(item.d || "-")}</span></div>
            <div class="p-prop-row"><span class="p-prop-key">Event</span><span class="p-prop-val">${esc(item.event_id || "Draft")}</span></div>
            <div class="p-prop-row"><span class="p-prop-key">Author</span><span class="p-prop-val" title="${esc(author)}">${shortenKey(author)}</span></div>
            <div class="p-prop-row"><span class="p-prop-key">Updated</span><span class="p-prop-val">${updatedAt}</span></div>
            ${supersedes.length ? `<div class="p-prop-row"><span class="p-prop-key">Supersedes</span><span class="p-prop-val">${esc(supersedes.join(", "))}</span></div>` : ""}
        `;
    }

    el.innerHTML = `
        <div class="p-section">
            <span class="p-section-title">Item Metadata</span>
            ${metadataContent}
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

    if (isLocalDraft) {
        const editBtn = document.createElement("button");
        editBtn.className = isEditMode ? "p-btn-primary" : "p-btn-accent";
        editBtn.textContent = isEditMode ? "View Mode" : "Edit";
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
                    renderExplorer();
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

function renderEditFields(item) {
    const fields = [];
    
    const addField = (label, name, value, placeholder = "") => {
        fields.push(`
            <div class="p-field">
                <label>${label}</label>
                <input type="text" name="${name}" value="${esc(value)}" placeholder="${placeholder}" autocomplete="off" />
            </div>
        `);
    };

    addField("Title", "title", item.title || "");
    
    if (item.kind === KINDS.ncc) {
        addField("NCC Number", "d", item.d ? item.d.replace(/^ncc-/, "") : "", "e.g. 00");
        addField("Summary", "tag:summary", item.tags?.summary || "");
        addField("Topics", "tag:topics", (item.tags?.topics || []).join(", "));
        addField("Authors", "tag:authors", (item.tags?.authors || []).join(", "));
        addField("Version", "tag:version", item.tags?.version || "");
        addField("Language", "tag:lang", item.tags?.lang || "");
        addField("License", "tag:license", item.tags?.license || "");
        addField("Supersedes", "tag:supersedes", (item.tags?.supersedes || []).join(", "));
    }

    if (item.kind === KINDS.nsr) {
        addField("Reason", "tag:reason", item.tags?.reason || "");
        addField("Effective At", "tag:effective_at", item.tags?.effective_at || "");
    }

    if (item.kind === KINDS.endorsement) {
        addField("Roles", "tag:roles", (item.tags?.roles || []).join(", "));
        addField("Implementation", "tag:implementation", item.tags?.implementation || "");
        addField("Note", "tag:note", item.tags?.note || "");
        addField("Topics", "tag:topics", (item.tags?.topics || []).join(", "));
    }

    if (item.kind === KINDS.supporting) {
        addField("Type", "tag:type", item.tags?.type || "");
        addField("For NCC", "tag:for", item.tags?.for || "");
        addField("Authors", "tag:authors", (item.tags?.authors || []).join(", "));
    }

    return fields.join("");
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
        const updatedItem = await actions.saveItem(currentItemId, content, item);
        updateStatus(`Saved at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
        
        // Refresh local item content and event_id from the returned update
        if (updatedItem) {
            Object.assign(item, updatedItem);
        } else {
            item.content = content;
        }
        
        isEditMode = false; // Transition out of edit mode on successful save
        renderContent(item);
        renderInspector(item);
        renderExplorer();
    } catch (e) {
        updateStatus("Save failed");
        console.error("Save error:", e);
    }
}
