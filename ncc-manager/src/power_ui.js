import { eventBus } from "./eventBus.js";
import { esc, shortenKey, normalizeEventId } from "./utils.js";
import { KINDS, isFallbackRelay } from "./state.js";
import { renderExplorer } from "./ui/explorer.js";
import { renderInspector } from "./ui/inspector.js";
import { renderContent } from "./ui/editor.js";
import {
    toggleCommandPalette,
    renderCommandList,
    executeCommand as paletteExecuteCommand,
    handlePaletteNavigation,
    executeCommand
} from "./ui/palette.js";
import QRCode from 'qrcode';
import nip46 from "./services/nip46.js";

let _getConfig = null;
let currentItemId = null;
let isEditMode = false;
let revisionSourceId = null; 
let searchQuery = "";
let _state = null;
let listenersSetup = false;
let keyboardHooked = false;
const collapsedBranches = new Set();
let _appVersion = "v0.0.0";

const TYPE_LABELS = {
    [KINDS.ncc]: "NCC",
    [KINDS.nsr]: "NSR",
    [KINDS.endorsement]: "Endorsement",
    [KINDS.supporting]: "Supporting"
};

const COMMANDS = [
    { id: "save", title: "Save", kb: "Ctrl+S", run: () => handleSaveShortcut() },
    { id: "new", title: "New NCC Draft", kb: "Ctrl+N", run: () => eventBus.emit('open-new-ncc') },
    { id: "reload", title: "Reload", kb: "Ctrl+R", run: () => window.location.reload() }
];

const DEBUG = true;
function log(...args) {
    if (DEBUG) console.log("%c[PowerUI]", "color: #58a6ff; font-weight: bold", ...args);
}

export function initPowerShell(appState, appVersion, getConfigFunc) {
    _state = appState || {};
    if (appVersion) _appVersion = appVersion;
    if (getConfigFunc) _getConfig = getConfigFunc;
    
    const shell = document.getElementById("shell-power");
    if (!shell) return;
    if (!shell.innerHTML.includes("p-topbar")) {
        log("Rendering base shell structure");
        shell.innerHTML = `
      <header class="p-topbar">
        <div class="p-brand" role="button">
          <span class="p-accent">></span> NCC Console
          <span class="p-version">${_appVersion}</span>
        </div>
        <div class="p-mobile-nav">
            <button class="p-btn-ghost" data-action="toggle-explorer">Explorer</button>
        </div>
        <div class="p-top-center">
          <div class="p-search-wrapper">
            <span class="p-search-icon">></span>
            <input class="p-top-search" id="p-search" placeholder="Search NCCs..." />
            <span class="p-search-kb">Ctrl+K</span>
          </div>
        </div>
          <div class="p-top-right">
             <div class="p-mobile-nav" style="padding-right: 8px">
                <button class="p-btn-ghost" data-action="toggle-inspector">Inspector</button>
             </div>
             <div id="p-top-signer" class="p-signer-status"></div>
          </div>
        </header>

      <div class="p-main">
        <aside class="p-pane p-explorer">
          <div id="p-explorer-body" class="p-scroll"></div>
        </aside>
        <section class="p-pane p-content">
          <div id="p-content-column" class="p-content-inner"></div>
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
      
      <div class="p-bottom-bar"></div>

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
    document.addEventListener("click", async (e) => {
        const shell = document.getElementById("shell-power");
        if (!shell || shell.hidden || shell.style.display === "none") return;

        const target = e.target;
        
        const navItem = target.closest(".p-nav-item");
        if (navItem && navItem.dataset.id) {
            e.preventDefault();
            openItem(navItem.dataset.id);
            return;
        }

        const branchHeader = target.closest(".p-nav-branch-header");
        if (branchHeader && branchHeader.dataset.branch) {
            e.preventDefault();
            toggleBranch(branchHeader.dataset.branch);
            return;
        }

        const brand = target.closest(".p-brand");
        if (brand) {
            currentItemId = null;
            isEditMode = false;
            refreshUI();
            return;
        }

        const paletteItem = target.closest(".p-palette-item");
        if (paletteItem && paletteItem.dataset.cmd) {
            paletteExecuteCommand(paletteItem.dataset.cmd, COMMANDS, () => toggleCommandPalette(false));
            return;
        }

        const inspectorBtn = target.closest("#p-inspector-actions button");
        if (inspectorBtn && inspectorBtn.dataset.action) {
            handleInspectorAction(inspectorBtn.dataset.action, inspectorBtn.dataset.id || currentItemId);
            return;
        }

        const signerTrigger = target.closest("#p-signer-trigger");
        if (signerTrigger) {
            const dropdown = document.getElementById("p-signer-dropdown");
            if (dropdown) dropdown.classList.toggle("is-open");
            return;
        }

        const activeDropdown = document.querySelector(".p-dropdown.is-open");
        if (activeDropdown && !target.closest(".p-signer-wrapper")) {
            activeDropdown.classList.remove("is-open");
        }

        const activeModal = target.closest(".p-modal-overlay");
        if (activeModal && target === activeModal) {
            activeModal.remove();
            return;
        }

        const actionBtn = target.closest("[data-action]");
        if (actionBtn && !target.closest("#p-inspector-actions")) {
            handleGlobalAction(actionBtn.dataset.action, target);
        }
    });

    const searchInput = document.getElementById("p-search");
    searchInput?.addEventListener("input", (e) => {
        searchQuery = e.target.value.toLowerCase();
        refreshUI();
    });

    const paletteInput = document.getElementById("p-palette-input");
    paletteInput?.addEventListener("input", (e) => {
        renderCommandList(e.target.value, COMMANDS);
    });

    document.addEventListener("contextmenu", (e) => {
        const shell = document.getElementById("shell-power");
        if (!shell || shell.hidden || shell.style.display === "none") return;

        const target = e.target;
        const navItem = target.closest(".p-nav-item");
        
        if (navItem && navItem.dataset.id) {
            const item = findItem(navItem.dataset.id);
            const isPublished = item && item.event_id && (item.status || "").toLowerCase() === "published";
            
            if (item && item.kind === KINDS.ncc && isPublished) {
                e.preventDefault();
                renderContextMenu(e.clientX, e.clientY, item);
            }
        }
    });

    let longPressTimer;
    document.addEventListener("touchstart", (e) => {
        const navItem = e.target.closest(".p-nav-item");
        if (navItem && navItem.dataset.id) {
            longPressTimer = setTimeout(() => {
                const item = findItem(navItem.dataset.id);
                const isPublished = item && item.event_id && (item.status || "").toLowerCase() === "published";
                
                if (item && item.kind === KINDS.ncc && isPublished) {
                    e.preventDefault();
                    const touch = e.touches[0];
                    renderContextMenu(touch.clientX, touch.clientY, item);
                }
            }, 500); // 500ms for long press
        }
    });
    document.addEventListener("touchend", () => clearTimeout(longPressTimer));
    document.addEventListener("touchmove", () => clearTimeout(longPressTimer));

    document.addEventListener("click", () => {
        const menu = document.getElementById("p-context-menu");
        if (menu) menu.remove();
    }, { capture: true });

    document.addEventListener("input", (e) => {
        const shell = document.getElementById("shell-power");
        if (!shell || shell.hidden || shell.style.display === "none") return;
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
            
            const arrayTags = ["topics", "authors", "supersedes", "roles", "role", "t"];
            if (arrayTags.includes(tagName)) {
                item.tags[tagName] = target.value.split(",").map(s => s.trim()).filter(Boolean);
            } else {
                item.tags[tagName] = target.value;
            }
        }
    });
}

async function handleInspectorAction(action, id) {
    if (action === "delete-item") {
        eventBus.emit('delete-item', id);
    } else if (action === "withdraw-item") {
        eventBus.emit('withdraw-item', id);
    } else if (action === "edit-item") {
        isEditMode = true;
        const item = findItem(id);
        if (item) {
            renderContent(document.getElementById("p-content-column"), item, { isEditMode, updateStatus, TYPE_LABELS });
            renderInspector(document.getElementById("p-inspector-body"), item, _state, { isEditMode, findItem });
        }
    } else if (action === "publish-item") {
        const item = findItem(id);
        if (item && confirm(`Publish this ${TYPE_LABELS[item.kind]}?`)) {
            eventBus.emit('publish-item', { item, kind: TYPE_LABELS[item.kind].toLowerCase() });
        }
    } else if (action === "revise-item") {
        handleReviseAction(id);
    } else if (action === "save-item") {
        handleSaveShortcut();
    } else if (action === "cancel-item") {
        isEditMode = false;
        
        if (_state?.pendingDrafts?.has(currentItemId)) {
            _state.pendingDrafts.delete(currentItemId);
            currentItemId = null;
            refreshUI();
            return;
        }

        if (revisionSourceId) {
            const sourceId = revisionSourceId;
            const tempDraftId = currentItemId;
            revisionSourceId = null;
            currentItemId = sourceId;
            eventBus.emit('delete-item-silent', tempDraftId);
        } else {
            const found = findItem(currentItemId);
            if (found) {
                renderContent(document.getElementById("p-content-column"), found, { isEditMode, updateStatus, TYPE_LABELS });
                renderInspector(document.getElementById("p-inspector-body"), found, _state, { isEditMode, findItem });
                refreshUI();
            }
        }
    }
}

function handleGlobalAction(action, target) {
    const explorerPane = document.querySelector(".p-explorer");
    const inspectorPane = document.querySelector(".p-inspector");
    const contentPane = document.querySelector(".p-content");

    if (target.closest(".p-dropdown")) {
        target.closest(".p-dropdown").classList.remove("is-open");
    }

    const closePanes = () => {
        explorerPane?.classList.remove("is-open");
        inspectorPane?.classList.remove("is-open");
        document.getElementById("p-content-overlay")?.remove();
    };

    if (action === "toggle-explorer") {
        closePanes();
        explorerPane?.classList.toggle("is-open");
        createContentOverlay(closePanes);
    } else if (action === "toggle-inspector") {
        closePanes();
        inspectorPane?.classList.toggle("is-open");
        createContentOverlay(closePanes);
    } else if (action === "sign-in") {
        openSignInModal();
    } else if (action === "sign-out") {
        eventBus.emit('sign-out');
    } else if (action === "open-settings") {
        renderSettingsModal(_getConfig);
    } else if (action === "close-modal") {
        const modal = target.closest(".p-modal-overlay");
        if (modal) modal.remove();
    }
}

function createContentOverlay(onClick) {
    let overlay = document.getElementById("p-content-overlay");
    if (overlay) return;
    
    overlay = document.createElement("div");
    overlay.id = "p-content-overlay";
    overlay.style.position = "fixed";
    overlay.style.top = "var(--topbar-h)";
    overlay.style.left = "0";
    overlay.style.right = "0";
    overlay.style.bottom = "var(--status-h)";
    overlay.style.background = "rgba(0,0,0,0.5)";
    overlay.style.zIndex = "199";
    
    document.querySelector(".p-main").appendChild(overlay);
    overlay.addEventListener("click", onClick);
}

function refreshUI() {
    // Move signer to bottom bar on mobile
    if (window.innerWidth <= 900) {
        const signer = document.getElementById("p-top-signer");
        const bottomBar = document.querySelector(".p-bottom-bar");
        if (signer && bottomBar && !bottomBar.contains(signer)) {
            bottomBar.appendChild(signer);
        }
    } else {
        const signer = document.getElementById("p-top-signer");
        const topBar = document.querySelector(".p-top-right");
        if (signer && topBar && !topBar.contains(signer)) {
            topBar.appendChild(signer);
        }
    }

    renderExplorer(document.getElementById("p-explorer-body"), _state, {
        searchQuery,
        currentItemId,
        collapsedBranches,
        findItem
    });
    renderTopBar();
    renderStatusBar();
    
    if (currentItemId) {
        const item = findItem(currentItemId);
        if (item) {
            renderContent(document.getElementById("p-content-column"), item, { isEditMode, updateStatus, TYPE_LABELS });
            renderInspector(document.getElementById("p-inspector-body"), item, _state, { isEditMode, findItem });
        } else {
            currentItemId = null;
            renderEmptyState();
        }
    } else {
        renderEmptyState();
    }
}

function renderTopBar() {
    const el = document.getElementById("p-top-signer");
    if (!el || !_state) return;
    
    if (_state.signerPubkey) {
        const profile = _state.signerProfile;
        const name = profile?.name || shortenKey(_state.signerPubkey);
        const pic = profile?.picture;
        
        el.innerHTML = `
            <div class="p-signer-wrapper">
                <button class="p-signer-pill p-clickable" id="p-signer-trigger">
                    <div class="p-signer-avatar">
                        ${pic ? `<img src="${esc(pic)}" alt="" />` : `<span class="p-signer-dot active"></span>`}
                    </div>
                    <span>${esc(name)}</span>
                    <span class="p-caret">▾</span>
                </button>
                <div class="p-dropdown" id="p-signer-dropdown">
                    <button class="p-dropdown-item" data-action="open-settings">
                        <span>~</span> Settings
                    </button>
                    <div class="p-dropdown-divider"></div>
                    <button class="p-dropdown-item p-danger-text" data-action="sign-out">
                        <span>x</span> Sign Out
                    </button>
                </div>
            </div>
        `;
    } else {
        el.innerHTML = `
            <button class="p-btn-accent" data-action="sign-in">
                Sign In
            </button>
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
          <div class="p-empty-icon">_</div>
          <div class="p-empty-text">Select an item from the Explorer to begin</div>
          <div class="p-empty-hint">Press <code>Ctrl+K</code> for commands</div>
        </div>
    `;
    const inspector = document.getElementById("p-inspector-body");
    if (inspector) inspector.innerHTML = "";
}

function findItem(id) {
    if (!_state || !id) return null;
    const pending = _state.pendingDrafts?.get(id);
    if (pending) {
        pending._isLocal = true;
        return pending;
    }
    
    const all = [
        ...(_state.nccLocalDrafts || []), 
        ...(_state.nsrLocalDrafts || []),
        ...(_state.endorsementLocalDrafts || []),
        ...(_state.supportingLocalDrafts || []),
        ...(_state.nccDocs || []),
        ...(_state.remoteDrafts || [])
    ];
    
    const found = all.find(i => i && (i.id === id || i.event_id === id));
    if (!found) return null;

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
    refreshUI();
}

export function focusItem(id, editMode = false) {
    const item = findItem(id);
    if (!item) return;

    currentItemId = id;
    isEditMode = Boolean(editMode);
    refreshUI();
}

function toggleBranch(id) {
    if (!id) return;
    if (collapsedBranches.has(id)) collapsedBranches.delete(id);
    else collapsedBranches.add(id);
    refreshUI();
}

async function handleReviseAction(id) {
    const item = findItem(id);
    if (!item) return;
    
    eventBus.emit('create-revision-draft', item);
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
    
    eventBus.emit('save-item', { id: currentItemId, content, item });
}

function setupKeyboardShortcuts() {
    if (keyboardHooked) return;
    keyboardHooked = true;

    document.addEventListener("keydown", (e) => {
        const paletteOverlay = document.getElementById("p-palette-overlay");
        const paletteActive = paletteOverlay && !paletteOverlay.hidden;

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
            e.preventDefault();
            toggleCommandPalette(undefined, { commands: COMMANDS });
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
            if (handlePaletteNavigation(e.key, COMMANDS, (id) => paletteExecuteCommand(id, COMMANDS, () => toggleCommandPalette(false)))) {
                e.preventDefault();
            }
            return;
        }

        if (e.key === "Escape" && isEditMode) {
            isEditMode = false;
            refreshUI();
        }
    });
}

function renderContextMenu(x, y, item) {
    const existing = document.getElementById("p-context-menu");
    if (existing) existing.remove();

    const menu = document.createElement("div");
    menu.id = "p-context-menu";
    menu.className = "p-context-menu";
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const isPublished = item.event_id && (item.status || "").toLowerCase() === "published";

    menu.innerHTML = `
        <div class="p-context-item" data-action="new-endorsement">
            <span>+</span> New Endorsement
        </div>
        <div class="p-context-item" data-action="new-supporting">
            <span>[</span> New Supporting Doc
        </div>
        ${isPublished ? `
            <div class="p-context-divider"></div>
            <div class="p-context-item" data-action="new-nsr">
                <span>~</span> Create Succession (NSR)
            </div>
        ` : ""}
    `;

    document.body.appendChild(menu);

    menu.addEventListener("click", (e) => {
        const actionBtn = e.target.closest(".p-context-item");
        if (!actionBtn) return;
        const action = actionBtn.dataset.action;

        if (action === "new-endorsement") {
            openEndorsementModal(item);
        } else if (action === "new-supporting") {
            openSupportingDocFlow(item);
        } else if (action === "new-nsr") {
            openNsrModal(item);
        }
        menu.remove();
    });
}

function openSignInModal() {
    const modal = document.createElement("div");
    modal.className = "p-modal-overlay";
    modal.innerHTML = `
        <div class="p-modal">
            <div class="p-modal-header">
                <h2>Sign In</h2>
                <button class="p-ghost-btn" data-action="close-modal">X</button>
            </div>
            <div class="p-modal-body">
                <div class="p-inspector-actions">
                    <button class="p-btn-primary" data-action="signin-nip07">Browser Extension (NIP-07)</button>
                    <button class="p-btn-primary" data-action="signin-qr">QR Code (NIP-46)</button>
                </div>

                <div id="p-qr-container" style="display: none; text-align: center; margin-top: 20px;">
                    <p id="p-qr-status" class="p-muted-text small">Scan with a NIP-46 compatible wallet:</p>
                    <canvas id="p-qr-canvas"></canvas>
                </div>

                <div class="p-modal-section">
                    <div class="p-field" style="margin-top: 20px;">
                        <label>Or connect with a bunker address (NIP-46)</label>
                        <input type="text" id="p-bunker-input" placeholder="bunker://..." />
                        <button class="p-btn-accent" style="margin-top: 8px;" data-action="signin-bunker">Connect</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const handleNip46Connect = (bunkerUrl) => {
        const statusEl = document.getElementById("p-qr-status");
        if (statusEl) statusEl.textContent = "Connecting...";
        
        try {
            const generatedUrl = nip46.connect(bunkerUrl, (pubkey) => {
                actions.updateSignerConfig?.("nip46");
                modal.remove();
            });

            if (generatedUrl) { // QR code flow
                const qrContainer = document.getElementById("p-qr-container");
                const canvas = document.getElementById("p-qr-canvas");
                QRCode.toCanvas(canvas, generatedUrl, { width: 256 }, (error) => {
                    if (error) console.error(error);
                });
                qrContainer.style.display = "block";
                if (statusEl) statusEl.textContent = "Scan with a NIP-46 compatible wallet:";
            }
        } catch (e) {
            if (statusEl) statusEl.textContent = `Error: ${e.message}`;
        }
    };

    modal.addEventListener("click", (e) => {
        const action = e.target.dataset.action;
        if (action === "signin-nip07") {
            actions.promptSigner?.();
            modal.remove();
        } else if (action === "signin-qr") {
            handleNip46Connect(null);
        } else if (action === "signin-bunker") {
            const bunkerUrl = document.getElementById("p-bunker-input").value;
            if (bunkerUrl) {
                handleNip46Connect(bunkerUrl);
            }
        }
    });
}

function openEndorsementModal(nccItem) {
    const modal = document.createElement("div");
    modal.className = "p-modal-overlay";
    modal.innerHTML = `
        <div class="p-modal">
            <div class="p-modal-header">
                <h2>Endorse ${esc(nccItem.d)}</h2>
                <button class="p-ghost-btn" data-action="close-modal">X</button>
            </div>
            <div class="p-modal-body">
                <div class="p-modal-form">
                    <div class="p-field">
                        <label>Roles (comma separated)</label>
                        <input type="text" id="m-end-roles" placeholder="author, client, user" />
                    </div>
                    <div class="p-field">
                        <label>Implementation</label>
                        <input type="text" id="m-end-impl" placeholder="e.g. MyClient v1.0" />
                    </div>
                    <div class="p-field">
                        <label>Note</label>
                        <textarea id="m-end-note" placeholder="Brief rationale..." style="height: 80px"></textarea>
                    </div>
                </div>
                <div class="p-modal-footer">
                    <button class="p-btn-ghost" data-action="close-modal">Cancel</button>
                    <button class="p-btn-accent" id="m-end-submit">Create Endorsement</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById("m-end-submit").onclick = async () => {
        const roles = document.getElementById("m-end-roles").value.split(",").map(s => s.trim()).filter(Boolean);
        const impl = document.getElementById("m-end-impl").value.trim();
        const note = document.getElementById("m-end-note").value.trim();

        const draft = {
            id: crypto.randomUUID(),
            kind: KINDS.endorsement,
            status: "draft",
            author_pubkey: _state.signerPubkey,
            d: nccItem.d,
            content: note,
            tags: {
                endorses: nccItem.event_id || nccItem.id,
                role: roles,
                implementation: impl,
                note: note
            }
        };
        await eventBus.emit('save-item', { id: draft.id, content: draft.content, item: draft });
        openItem(draft.id);
        modal.remove();
    };
}

function openNsrModal(nccItem) {
    const modal = document.createElement("div");
    modal.className = "p-modal-overlay";
    modal.innerHTML = `
        <div class="p-modal">
            <div class="p-modal-header">
                <h2>New Succession Record</h2>
                <button class="p-ghost-btn" data-action="close-modal">X</button>
            </div>
            <div class="p-modal-body">
                <p class="p-muted-text small" style="margin-bottom: 16px">
                    Transferring stewardship for <strong>${esc(nccItem.d)}</strong>.
                </p>
                <div class="p-modal-form">
                    <div class="p-field">
                        <label>Authoritative Event ID</label>
                        <input type="text" id="m-nsr-auth" placeholder="The new canonical event ID" />
                    </div>
                    <div class="p-field">
                        <label>Reason</label>
                        <input type="text" id="m-nsr-reason" placeholder="e.g. Stewardship handover" />
                    </div>
                </div>
                <div class="p-modal-footer">
                    <button class="p-btn-ghost" data-action="close-modal">Cancel</button>
                    <button class="p-btn-accent" id="m-nsr-submit">Create NSR</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById("m-nsr-submit").onclick = async () => {
        const auth = document.getElementById("m-nsr-auth").value.trim();
        const reason = document.getElementById("m-nsr-reason").value.trim();

        if (!auth) return;

        const draft = {
            id: crypto.randomUUID(),
            kind: KINDS.nsr,
            status: "draft",
            author_pubkey: _state.signerPubkey,
            d: nccItem.d,
            content: reason,
            tags: {
                authoritative: auth,
                previous: nccItem.event_id || nccItem.id,
                reason: reason,
                steward: _state.signerPubkey,
                effective_at: Math.floor(Date.now() / 1000).toString()
            }
        };

        await eventBus.emit('save-item', { id: draft.id, content: draft.content, item: draft });
        openItem(draft.id);
        modal.remove();
    };
}

function openSupportingDocFlow(nccItem) {
    const draft = {
        id: crypto.randomUUID(),
        kind: KINDS.supporting,
        status: "draft",
        author_pubkey: _state.signerPubkey,
        d: `guide-${nccItem.d}`,
        title: `Supporting Doc for ${nccItem.d}`,
        content: "",
        tags: {
            for: nccItem.d,
            for_event: nccItem.event_id || nccItem.id,
            type: "guide",
            published_at: Math.floor(Date.now() / 1000).toString()
        }
    };

    eventBus.emit('save-item', { id: draft.id, content: draft.content, item: draft });
    focusItem(draft.id, true);
}

function renderSettingsModal() {
    const modal = document.createElement("div");
    modal.className = "p-modal-overlay";
    modal.innerHTML = `
        <div class="p-modal">
            <div class="p-modal-header">
                <h2>Settings</h2>
                <button class="p-ghost-btn" data-action="close-modal">X</button>
            </div>
            <div class="p-modal-body p-scroll">
                <section class="p-modal-section">
                    <h3>Nostr Relays</h3>
                    <div id="p-settings-relays" class="p-settings-list"></div>
                    <div class="p-settings-input-group">
                        <input type="text" id="p-new-relay" placeholder="wss://relay.example.com" />
                        <button class="p-btn-accent" id="p-add-relay">Add Relay</button>
                    </div>
                </section>

                <section class="p-modal-section">
                    <h3>Display Settings</h3>
                    <div class="p-field">
                        <label>Theme</label>
                        <select id="p-theme-select">
                            <option value="power" ${_state.theme === "power" ? "selected" : ""}>Power (Default)</option>
                            <option value="terminal" ${_state.theme === "terminal" ? "selected" : ""}>Terminal</option>
                        </select>
                    </div>
                </section>

                <section class="p-modal-section">
                    <h3>Signer Configuration</h3>
                    <div class="p-field">
                        <label>Signing Mode</label>
                        <select id="p-signer-mode">
                            <option value="nip07" ${_state.signerMode === "nip07" ? "selected" : ""}>Browser Extension (NIP-07)</option>
                            <option value="nip46" ${_state.signerMode === "nip46" ? "selected" : ""}>Remote Signer (NIP-46)</option>
                            <option value="nsec" ${_state.signerMode === "nsec" ? "selected" : ""}>Local nsec (Session Only)</option>
                        </select>
                    </div>
                    <div id="p-nsec-field" class="p-field" style="display: ${_state.signerMode === "nsec" ? "flex" : "none"}">
                        <label>nsec1...</label>
                        <input type="password" id="p-nsec-input" placeholder="nsec1..." />
                        <p class="p-muted-text small" style="margin-top: 8px; color: var(--warning)">
                            !!! <strong>Security Warning:</strong> Your nsec is kept in memory for this session only. 
                            Never share your nsec or paste it into untrusted applications.
                        </p>
                    </div>
                    <button class="p-btn-primary" id="p-save-signer">Update Signer</button>
                </section>

                <section class="p-modal-section">
                    <h3>Data Management</h3>
                    <div class="p-inspector-actions">
                        <button class="p-btn-ghost" id="p-export-all">Export All Drafts (JSON)</button>
                        <button class="p-btn-ghost" id="p-clear-cache" style="color: var(--danger)">Clear ALL Local Data & Cache</button>
                    </div>
                </section>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const refreshRelays = async () => {
        const container = document.getElementById("p-settings-relays");
        if (!container) return;
        const userRelays = await _getConfig?.("user_relays", []);
        const defaultRelays = _state.FALLBACK_RELAYS || [];
        
        let html = "";
        
        if (userRelays.length) {
            html += `<div class="p-muted-text small" style="margin-bottom: 8px">Custom Relays</div>`;
            html += userRelays.map(r => `
                <div class="p-settings-row">
                    <span>${esc(r)} <small class="p-type-tag" style="margin-left: 8px">USER</small></span>
                    <button class="p-danger-link" data-relay="${esc(r)}">Remove</button>
                </div>
            `).join("");
        }

        html += `<div class="p-muted-text small" style="margin: 16px 0 8px">Built-in Fallbacks</div>`;
        html += defaultRelays.map(r => `
            <div class="p-settings-row" style="opacity: 0.7">
                <span>${esc(r)} <small class="p-type-tag" style="margin-left: 8px; color: var(--muted); background: transparent; border: 1px solid var(--border)">SYSTEM</small></span>
                <span class="small p-muted-text">Managed</span>
            </div>
        `).join("");

        container.innerHTML = html;
        
        container.querySelectorAll(".p-danger-link").forEach(btn => {
            btn.onclick = async () => {
                const next = userRelays.filter(r => r !== btn.dataset.relay);
                eventBus.emit('set-config', { key: "user_relays", value: next });
                refreshRelays();
            };
        });
    };

    refreshRelays();

    const themeSelect = document.getElementById("p-theme-select");
    themeSelect.onchange = async () => {
        const selectedTheme = themeSelect.value;
        eventBus.emit('set-config', { key: "theme", value: selectedTheme });
        document.body.className = `mode-${selectedTheme}`;
        _state.theme = selectedTheme; // Update local state for immediate feedback
    };

    const addBtn = document.getElementById("p-add-relay");
    const relayInput = document.getElementById("p-new-relay");
    addBtn.onclick = async () => {
        const val = relayInput.value.trim();
        if (!val) return;
        const normalized = val.startsWith("ws") ? val : `wss://${val}`;
        const current = await _getConfig?.("user_relays", []);
        if (!current.includes(normalized)) {
            current.push(normalized);
            eventBus.emit('set-config', { key: "user_relays", value: current });
            relayInput.value = "";
            refreshRelays();
        }
    };

    const modeSelect = document.getElementById("p-signer-mode");
    const nsecWrap = document.getElementById("p-nsec-field");
    modeSelect.onchange = () => {
        nsecWrap.style.display = modeSelect.value === "nsec" ? "flex" : "none";
    };

    const saveSignerBtn = document.getElementById("p-save-signer");
    saveSignerBtn.onclick = async () => {
        const mode = modeSelect.value;
        const nsec = document.getElementById("p-nsec-input").value.trim();
        eventBus.emit('update-signer-config', { mode, nsec });
        modal.remove();
    };

    document.getElementById("p-export-all").onclick = () => eventBus.emit('export-all');
    document.getElementById("p-clear-cache").onclick = () => {
        if (confirm("Are you sure you want to clear ALL local data? This cannot be undone.")) {
            eventBus.emit('clear-cache');
            window.location.reload();
        }
    };
}