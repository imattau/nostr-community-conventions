import { esc, eventTagValue, shortenKey, normalizeEventId } from "../utils.js";
import { KINDS } from "../state.js";
import { payloadToDraft } from "../nostr.js";

const REVISION_DESCRIPTORS = ["latest", "previous revision", "earlier revision"];

export function renderExplorer(container, state, options = {}) {
    const { 
        searchQuery = "", 
        currentItemId = null, 
        collapsedBranches = new Set(),
        onToggleBranch,
        onOpenItem,
        findItem
    } = options;

    if (!container || !state) return;

    const query = searchQuery.trim().toLowerCase();
    
    // Pool all items with conceptual de-duplication
    const conceptualMap = new Map();
    
    const addToPool = (items) => {
        (items || []).forEach(rawItem => {
            if (!rawItem) return;
            
            let item = rawItem;
            if (!item.d && rawItem.tags) {
                item = payloadToDraft(rawItem);
            }

            let identity = item.event_id || item.id;
            const isDraft = (item.status || "").toLowerCase() !== "published";
            
            if (isDraft) {
                const cleanD = (item.d || "").replace(/^draft:/, "");
                if (cleanD) {
                    identity = `draft-group:${item.kind}:${cleanD}`;
                } else {
                    identity = `draft:${item.id}`;
                }
            }

            const existing = conceptualMap.get(identity);
            
            if (!existing) {
                conceptualMap.set(identity, item);
            } else {
                const ensureTs = (val) => (val > 1e12 ? val : val * 1000) || 0;
                const existingTs = ensureTs(existing.updated_at || existing.created_at);
                const newTs = ensureTs(item.updated_at || item.created_at);
                
                const isLocalBetter = item.source === "local" && existing.source !== "local";
                const isNewerBetter = newTs > existingTs;
                
                if (isLocalBetter || (isNewerBetter && item.source === existing.source)) {
                    conceptualMap.set(identity, item);
                }
            }
        });
    };

    addToPool(state.nccLocalDrafts);
    addToPool(state.nsrLocalDrafts);
    addToPool(state.endorsementLocalDrafts);
    addToPool(state.supportingLocalDrafts);
    addToPool(state.nccDocs);
    addToPool(state.remoteDrafts);

    const allItems = Array.from(conceptualMap.values());

    const publishedPool = allItems.filter(i => 
        i.event_id && (i.status || "").toLowerCase() === "published"
    );
    const withdrawnPool = allItems.filter(i => 
        (i.status || "").toLowerCase() === "withdrawn"
    );
    const draftsPool = allItems.filter(i => 
        (i.status || "").toLowerCase() !== "published" && (i.status || "").toLowerCase() !== "withdrawn" || !i.event_id
    );

    const sections = [
        { title: "Drafts", items: filterExplorerItems(draftsPool, query), type: "drafts" },
        { title: "Published", items: filterExplorerItems(publishedPool, query), type: "published" },
        { title: "Withdrawn", items: filterExplorerItems(withdrawnPool, query), type: "withdrawn" }
    ];

    container.innerHTML = sections.map(section => renderExplorerSection(section, { 
        collapsedBranches, 
        currentItemId, 
        state,
        findItem 
    })).join("");
}

function filterExplorerItems(items, query) {
    if (!items.length) return [];
    const ensureTs = (val) => (val > 1e12 ? val : val * 1000) || 0;
    return items
        .filter((item) => {
            if (!query) return true;
            const label = (item.d || "").toLowerCase();
            const title = (item.title || eventTagValue(item.tags, "title") || "").toLowerCase();
            return label.includes(query) || title.includes(query);
        })
        .sort((a, b) => {
            const aTs = ensureTs(a.updated_at || a.created_at);
            const bTs = ensureTs(b.updated_at || b.created_at);
            return (bTs || 0) - (aTs || 0);
        });
}

function renderExplorerSection(section, context) {
    const { title, items, type: sectionType } = section;
    const groups = buildRevisionGroups(items);
    return `
        <div class="p-nav-group">
            <div class="p-nav-header">
                <span>${title} (${items.length})</span>
            </div>
            ${groups.length ? groups.map((group) => renderExplorerBranch(group, sectionType, context)).join("") : `<div class="p-nav-empty">No items found</div>`}
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

    const ensureTs = (val) => (val > 1e12 ? val : val * 1000) || 0;

    return Array.from(dMap.entries())
        .map(([d, groupItems]) => {
            const byKind = {
                [KINDS.ncc]: groupItems.filter(i => i.kind === KINDS.ncc),
                [KINDS.nsr]: groupItems.filter(i => i.kind === KINDS.nsr),
                [KINDS.endorsement]: groupItems.filter(i => i.kind === KINDS.endorsement),
                [KINDS.supporting]: groupItems.filter(i => i.kind === KINDS.supporting)
            };

            const sortItems = (list) => {
                return list.map(item => ({ 
                    item, 
                    depth: computeRevisionDepth(item, list) 
                })).sort((a, b) => {
                    if (b.depth !== a.depth) return b.depth - a.depth;
                    const aTs = ensureTs(a.item.updated_at || a.item.created_at);
                    const bTs = ensureTs(b.item.updated_at || b.item.created_at);
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
                latestTs: Math.max(...groupItems.map(i => ensureTs(i.updated_at || i.created_at)))
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

function renderExplorerBranch(group, sectionType, context) {
    const { collapsedBranches, currentItemId, state, findItem } = context;
    const branchKey = `${sectionType}:${group.rawKey}`;
    const isClosed = collapsedBranches.has(branchKey);
    
    const mainNcc = group.kinds.ncc[0]?.item;
    const title = mainNcc ? (mainNcc.title || eventTagValue(mainNcc.tags, "title")) : group.label;
    const status = determineStatus(mainNcc || group.kinds.endorsement[0]?.item || group.kinds.supporting[0]?.item || group.kinds.nsr[0]?.item, sectionType, currentItemId, findItem);
    const badgeLabel = status === "published" ? "PUB" : status === "withdrawn" ? "WITH" : "DRAFT";

    let bodyHtml = "";
    const isDraftSection = sectionType === "drafts";
    
    if (group.kinds.ncc.length) {
        const nccItems = isDraftSection ? [group.kinds.ncc[0]] : group.kinds.ncc;
        bodyHtml += nccItems.map((entry, idx) => renderExplorerItem(entry, idx, status, currentItemId, state)).join("");
    }

    const subTrees = [
        { key: "endorsement", label: "Endorsements", items: group.kinds.endorsement },
        { key: "nsr", label: "Succession", items: group.kinds.nsr },
        { key: "supporting", label: "Supporting Docs", items: group.kinds.supporting }
    ];

    subTrees.forEach(sub => {
        if (sub.items.length) {
            const subKey = `${branchKey}:${sub.key}`;
            const subClosed = collapsedBranches.has(subKey);
            const itemsToShow = isDraftSection ? [sub.items[0]] : sub.items;

            bodyHtml += `
                <div class="p-nav-tree p-nav-subtree">
                    <button class="p-nav-branch-header" data-branch="${subKey}">
                        <span class="p-nav-branch-icon">${subClosed ? "▸" : "▾"}</span>
                        <span class="p-nav-branch-title">
                            <span class="p-type-tag">${sub.label}</span>
                            <small class="p-muted-text">(${itemsToShow.length})</small>
                        </span>
                    </button>
                    <div class="p-nav-branch-body ${subClosed ? "" : "is-open"}">
                        ${itemsToShow.map((entry, idx) => renderExplorerItem(entry, idx, "published", currentItemId, state)).join("")}
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

function renderExplorerItem(entry, idx, inheritedStatus, currentItemId, state) {
    const { item } = entry;
    const isActive = item.id === currentItemId ? " active" : "";
    const status = normalizeStatus(item.status || inheritedStatus);
    const statusLabel =
        status === "published" ? "PUB" : status === "withdrawn" ? "WITH" : "DRAFT";
    
    const title = item.title || eventTagValue(item.tags, "title") || "Untitled";
    const ensureTs = (val) => (val > 1e12 ? val : val * 1000) || 0;
    const ts = ensureTs(item.updated_at || item.created_at);
    const dateStr = ts ? new Date(ts).toLocaleDateString() : "—";
    
    let label = title;
    if (item.kind === KINDS.ncc) {
        if (idx > 0) label = REVISION_DESCRIPTORS[Math.min(idx, REVISION_DESCRIPTORS.length - 1)];
    } else {
        const author = item.author_pubkey || item.author || item.pubkey || (item._isLocal ? state.signerPubkey : "") || "";
        label = `${shortenKey(author)} · ${dateStr}`;
    }

    return `
        <div class="p-nav-item${isActive}" data-id="${item.id}" title="${esc(title)}">
            <div class="p-nav-meta">
                <span class="p-nav-label">${esc(label)}</span>
                <span class="p-badge-mini status-${status}">${statusLabel}</span>
            </div>
            <div class="p-nav-date">${dateStr}</div>
        </div>
    `;
}

function determineStatus(item, type, currentItemId, findItem) {
    if (item && item.status) return item.status.toLowerCase();
    if (currentItemId && typeof findItem === 'function') {
        const active = findItem(currentItemId);
        if (active && active.d === item?.d) return active.status.toLowerCase();
    }
    return type === "published" ? "published" : "draft";
}

function normalizeStatus(status) {
    if (!status) return "draft";
    const val = status.toLowerCase();
    if (val === "published") return "published";
    if (val === "withdrawn") return "withdrawn";
    return "draft";
}
