import { esc, eventTagValue, shortenKey } from "../utils.js";
import { KINDS } from "../state.js";

const LICENSE_OPTIONS = [
    { value: "MIT", label: "MIT" },
    { value: "Apache-2.0", label: "Apache 2.0" },
    { value: "GPL-3.0-only", label: "GPL 3.0" },
    { value: "GPL-2.0-only", label: "GPL 2.0" },
    { value: "LGPL-3.0-only", label: "LGPL 3.0" },
    { value: "AGPL-3.0-only", label: "AGPL 3.0" },
    { value: "BSD-3-Clause", label: "BSD 3-Clause" },
    { value: "BSD-2-Clause", label: "BSD 2-Clause" },
    { value: "ISC", label: "ISC" },
    { value: "MPL-2.0", label: "MPL 2.0" },
    { value: "Unlicense", label: "Unlicense" },
    { value: "CC0-1.0", label: "CC0 (Public Domain)" },
    { value: "CC-BY-4.0", label: "CC BY 4.0" }
];

const LANGUAGE_OPTIONS = [
    { value: "en", label: "English" },
    { value: "es", label: "Spanish" },
    { value: "fr", label: "French" },
    { value: "de", label: "German" },
    { value: "zh", label: "Chinese" },
    { value: "ja", label: "Japanese" },
    { value: "ru", label: "Russian" },
    { value: "pt", label: "Portuguese" },
    { value: "it", label: "Italian" },
    { value: "ko", label: "Korean" },
    { value: "ar", label: "Arabic" }
];

export function renderInspector(container, item, state, options = {}) {
    const { 
        isEditMode = false, 
    } = options;

    if (!container) return;
    if (!item) {
        const relayStatus = state?.relayStatus || {};
        const lastSync = relayStatus.at ? new Date(relayStatus.at).toLocaleTimeString() : "Never";
        const signer = state?.signerPubkey ? (state.signerProfile?.name || shortenKey(state.signerPubkey)) : "Guest";
        const totalPublished = state?.nccDocs?.length || 0;
        const totalDrafts = (state?.nccLocalDrafts?.length || 0) + 
                           (state?.nsrLocalDrafts?.length || 0) + 
                           (state?.endorsementLocalDrafts?.length || 0) + 
                           (state?.supportingLocalDrafts?.length || 0);

        container.innerHTML = `
            <div class="p-section">
                <span class="p-section-title">Session Overview</span>
                <div class="p-prop-row"><span class="p-prop-key">User</span><span class="p-prop-val">${esc(signer)}</span></div>
                <div class="p-prop-row"><span class="p-prop-key">Signer Mode</span><span class="p-prop-val">${state?.signerMode || 'None'}</span></div>
            </div>
            <div class="p-section">
                <span class="p-section-title">Network</span>
                <div class="p-prop-row"><span class="p-prop-key">Active Relays</span><span class="p-prop-val">${relayStatus.relays || 0}</span></div>
                <div class="p-prop-row"><span class="p-prop-key">Indexed Events</span><span class="p-prop-val">${relayStatus.events || 0}</span></div>
                <div class="p-prop-row"><span class="p-prop-key">Last Sync</span><span class="p-prop-val">${lastSync}</span></div>
            </div>
            <div class="p-section">
                <span class="p-section-title">Workspace</span>
                <div class="p-prop-row"><span class="p-prop-key">Published NCCs</span><span class="p-prop-val">${totalPublished}</span></div>
                <div class="p-prop-row"><span class="p-prop-key">Local Drafts</span><span class="p-prop-val">${totalDrafts}</span></div>
            </div>
            <div class="p-section" style="border-style: dashed; background: transparent; opacity: 0.7">
                <span class="p-section-title">Did you know?</span>
                <p style="font-size: 0.75rem; color: var(--muted); margin: 0; line-height: 1.4">
                    Right-click on an NCC in the explorer to quickly create endorsements or succession records.
                </p>
            </div>
        `;
        return;
    }

    const title = item.title || eventTagValue(item.tags, "title") || "Untitled";
    const status = normalizeStatus(item.status || "published");
    const author = item.author_pubkey || item.author || item.pubkey || (item._isLocal ? state.signerPubkey : "") || "Unknown";
    const ensureTs = (val) => (val > 1e12 ? val : val * 1000) || 0;
    const ts = ensureTs(item.updated_at || item.created_at);
    const updatedAt = ts ? new Date(ts).toLocaleString() : "-";
    const badgeLabel = status.toUpperCase();
    const relayStatus = state?.relayStatus || {};
    const lastSync = relayStatus.at ? new Date(relayStatus.at).toLocaleTimeString() : "-";

    const isPublished = item.event_id && (item.status || "").toLowerCase() === "published";

    let metadataContent = "";
    
    const coreFields = `
        <div class="p-prop-row"><span class="p-prop-key">Status</span><span class="p-badge-mini status-${status}">${badgeLabel}</span></div>
        <div class="p-prop-row"><span class="p-prop-key">Author</span><span class="p-prop-val" title="${esc(author)}">${shortenKey(author)}</span></div>
        <div class="p-prop-row" style="margin-bottom: 12px"><span class="p-prop-key">Updated</span><span class="p-prop-val">${updatedAt}</span></div>
    `;

    if (isEditMode && !isPublished) {
        metadataContent = coreFields + renderEditFields(item);
    } else {
        const rows = [];
        const addRow = (key, val) => {
            if (val) rows.push(`<div class="p-prop-row"><span class="p-prop-key">${key}</span><span class="p-prop-val">${esc(val)}</span></div>`);
        };

        addRow("Title", title);
        addRow("Identifier", item.d);
        if (item.event_id) addRow("Event ID", item.event_id);

        if (item.kind === KINDS.ncc) {
            addRow("Version", item.tags?.version);
            addRow("Summary", item.tags?.summary);
            addRow("Topics", (item.tags?.topics || []).join(", "));
            addRow("Authors", (item.tags?.authors || []).join(", "));
            addRow("Language", item.tags?.lang);
            addRow("License", item.tags?.license);
            addRow("Supersedes", (item.tags?.supersedes || []).join(", "));
        } else if (item.kind === KINDS.nsr) {
            addRow("Authoritative", item.tags?.authoritative);
            addRow("Previous", item.tags?.previous);
            addRow("Steward", item.tags?.steward);
            addRow("Reason", item.tags?.reason);
            addRow("Effective", item.tags?.effective_at);
        } else if (item.kind === KINDS.endorsement) {
            addRow("Endorses", item.tags?.endorses);
            addRow("Roles", (item.tags?.roles || item.tags?.role || []).join(", "));
            addRow("Implementation", item.tags?.implementation);
            addRow("Topics", (item.tags?.topics || []).join(", "));
            addRow("Note", item.tags?.note);
        } else if (item.kind === KINDS.supporting) {
            addRow("For NCC", item.tags?.for);
            addRow("For Event", item.tags?.for_event);
            addRow("Type", item.tags?.type);
            addRow("Topics", (item.tags?.topics || []).join(", "));
            addRow("Authors", (item.tags?.authors || []).join(", "));
            addRow("Language", item.tags?.lang);
            addRow("License", item.tags?.license);
        }

        metadataContent = coreFields + rows.join("");
    }

    container.innerHTML = `
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

    renderActions(document.getElementById("p-inspector-actions"), item, isPublished, isEditMode);
}

function renderActions(container, item, isPublished, isEditMode) {
    if (!container) return;
    container.innerHTML = "";

    if (!isEditMode) {
        // VIEW MODE ACTIONS
        if (!isPublished) {
            // It's a DRAFT (local or remote)
            const editBtn = document.createElement("button");
            editBtn.className = "p-btn-accent";
            editBtn.textContent = "Edit";
            editBtn.dataset.action = "edit-item";
            editBtn.dataset.id = item.id;
            container.appendChild(editBtn);

            const publishBtn = document.createElement("button");
            publishBtn.className = "p-btn-ghost";
            publishBtn.textContent = "Publish";
            publishBtn.dataset.action = "publish-item";
            publishBtn.dataset.id = item.id;
            container.appendChild(publishBtn);

            const announceWrap = document.createElement("label");
            announceWrap.className = "p-checkbox-label";
            announceWrap.style.marginTop = "4px";
            announceWrap.innerHTML = `
                <input type="checkbox" id="p-announce-check" />
                <span>Post Announcement</span>
            `;
            container.appendChild(announceWrap);

            // DELETE or WITHDRAW logic for draft
            if (!item.event_id) {
                const deleteBtn = document.createElement("button");
                deleteBtn.className = "p-btn-ghost";
                deleteBtn.style.color = "var(--danger)";
                deleteBtn.textContent = "Delete";
                deleteBtn.dataset.action = "delete-item";
                deleteBtn.dataset.id = item.id;
                container.appendChild(deleteBtn);
            } else if (item.status !== "withdrawn") {
                const withdrawBtn = document.createElement("button");
                withdrawBtn.className = "p-btn-ghost";
                withdrawBtn.style.color = "var(--danger)";
                withdrawBtn.textContent = "Withdraw";
                withdrawBtn.dataset.action = "withdraw-item";
                withdrawBtn.dataset.id = item.id;
                container.appendChild(withdrawBtn);
            }
        } else {
            // Published Item
            const reviseBtn = document.createElement("button");
            reviseBtn.className = "p-btn-accent";
            reviseBtn.textContent = "Revise";
            reviseBtn.dataset.action = "revise-item";
            reviseBtn.dataset.id = item.id;
            container.appendChild(reviseBtn);

            if (item.status !== "withdrawn") {
                const withdrawBtn = document.createElement("button");
                withdrawBtn.className = "p-btn-ghost";
                withdrawBtn.style.color = "var(--danger)";
                withdrawBtn.textContent = "Withdraw";
                withdrawBtn.dataset.action = "withdraw-item";
                withdrawBtn.dataset.id = item.id;
                container.appendChild(withdrawBtn);
            }
        }
    } else {
        // EDIT MODE ACTIONS
        if (!isPublished) {
            const saveBtn = document.createElement("button");
            saveBtn.className = "p-btn-accent";
            saveBtn.textContent = "Save (Ctrl+S)";
            saveBtn.dataset.action = "save-item";
            container.appendChild(saveBtn);
        }
        else {
            const saveMsg = document.createElement("span");
            saveMsg.className = "p-muted-text small";
            saveMsg.style.padding = "6px 0";
            saveMsg.textContent = "Published items are read-only";
            container.appendChild(saveMsg);
        }

        const cancelBtn = document.createElement("button");
        cancelBtn.className = "p-btn-ghost";
        cancelBtn.textContent = "Cancel";
        cancelBtn.dataset.action = "cancel-item";
        container.appendChild(cancelBtn);
    }
}

function renderEditFields(item) {
    const fields = [];
    
    const addField = (label, name, value, placeholder = "", mandatory = false) => {
        fields.push(`
            <div class="p-field">
                <label>${label}${mandatory ? " <span class=\"p-danger-text\">*</span>" : ""}</label>
                <input type="text" name="${name}" value="${esc(value)}" placeholder="${placeholder}" autocomplete="off" />
            </div>
        `);
    };

    const addDatalistField = (label, name, value, options, placeholder = "", mandatory = false) => {
        const listId = `list-${name.replace(/:/g, "-")}`;
        const optionHtml = options
            .map((opt) => `<option value="${esc(opt.value)}">${esc(opt.label)}</option>`)
            .join("");
        fields.push(`
            <div class="p-field">
                <label>${label}${mandatory ? " <span class=\"p-danger-text\">*</span>" : ""}</label>
                <input type="text" name="${name}" value="${esc(value)}" list="${listId}" placeholder="${placeholder}" autocomplete="off" />
                <datalist id="${listId}">
                    ${optionHtml}
                </datalist>
            </div>
        `);
    };

    addField("Title", "title", item.title || "", "", true);
    
    if (item.kind === KINDS.ncc) {
        addField("NCC Number", "d", item.d ? item.d.replace(/^ncc-/, "") : "", "e.g. 00", true);
        addField("Summary", "tag:summary", item.tags?.summary || "");
        addField("Topics", "tag:topics", (item.tags?.topics || []).join(", "));
        addField("Authors", "tag:authors", (item.tags?.authors || []).join(", "));
        addField("Version", "tag:version", item.tags?.version || "");
        addDatalistField("Language", "tag:lang", item.tags?.lang || "", LANGUAGE_OPTIONS, "e.g. en");
        addDatalistField("License", "tag:license", item.tags?.license || "", LICENSE_OPTIONS, "e.g. MIT");
        
        const supersedesDisplay = (item.tags?.supersedes || [])
            .map(s => s.replace(/^event:/i, ""))
            .join(", ");
        addField("Supersedes", "tag:supersedes", supersedesDisplay, "ncc-XX or event hex");
    }

    if (item.kind === KINDS.nsr) {
        addField("Authoritative ID", "tag:authoritative", (item.tags?.authoritative || "").replace(/^event:/i, ""), "Event hex", true);
        addField("Reason", "tag:reason", item.tags?.reason || "", "", true);
        addField("Effective At", "tag:effective_at", item.tags?.effective_at || "");
    }

    if (item.kind === KINDS.endorsement) {
        addField("Endorses", "tag:endorses", (item.tags?.endorses || "").replace(/^event:/i, ""), "Event hex", true);
        addField("Roles", "tag:role", (item.tags?.roles || item.tags?.role || []).join(", "));
        addField("Implementation", "tag:implementation", item.tags?.implementation || "");
        addField("Note", "tag:note", item.tags?.note || "");
        addField("Topics", "tag:topics", (item.tags?.topics || []).join(", "));
    }

    if (item.kind === KINDS.supporting) {
        addField("Type", "tag:type", item.tags?.type || "", "e.g. guide", true);
        addField("For NCC", "tag:for", item.tags?.for || "", "ncc-XX", true);
        addField("For Event", "tag:for_event", (item.tags?.for_event || "").replace(/^event:/i, ""), "Event hex");
        addField("Topics", "tag:topics", (item.tags?.topics || []).join(", "));
        addField("Authors", "tag:authors", (item.tags?.authors || []).join(", "));
        addDatalistField("Language", "tag:lang", item.tags?.lang || "", LANGUAGE_OPTIONS, "e.g. en");
        addDatalistField("License", "tag:license", item.tags?.license || "", LICENSE_OPTIONS, "e.g. MIT");
    }

    return fields.join("");
}

function normalizeStatus(status) {
    if (!status) return "draft";
    const val = status.toLowerCase();
    if (val === "published") return "published";
    if (val === "withdrawn") return "withdrawn";
    return "draft";
}
