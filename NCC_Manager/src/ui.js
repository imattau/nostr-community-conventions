// src/ui.js
import {
  esc,
  shortenKey,
  stripNccNumber,
  nowSeconds,
  eventTagValue,
  normalizeHexId,
  buildNccOptions
} from "./utils.js";

import { getRelays } from "./state.js";
import { getConfig } from "./store.js";

export function hideSignerMenu() {
  const menu = document.getElementById("signer-menu");
  if (!menu) return;
  menu.classList.remove("visible");
  const button = document.getElementById("signer-status");
  if (button) button.setAttribute("aria-expanded", "false");
}

export function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

export function renderSignerStatus(state) {
  const statusEl = document.getElementById("signer-status");
  if (!statusEl) return;
  const avatarSlot = document.getElementById("signer-menu-avatar");
  const nameSlot = document.getElementById("signer-menu-name");
  const pubkeySlot = document.getElementById("signer-menu-pubkey");
  const signoutButton = document.getElementById("signer-menu-signout");
  const profile = state.signerProfile;
  if (state.signerPubkey) {
    const shortKey = `${state.signerPubkey.slice(0, 6)}…${state.signerPubkey.slice(-4)}`;
    const displayName = profile?.name || shortKey;
    const initial = ((profile?.name || shortKey).charAt(0) || shortKey.charAt(0)).toUpperCase();
    const avatarHtml = profile?.picture
      ? `<img src="${esc(profile.picture)}" alt="${esc(profile?.name || "profile")}" />`
      : `<span>${esc(initial)}</span>`;
    statusEl.innerHTML = `
      <span class="signer-icon">${avatarHtml}</span>
      <span class="signer-text">
        ${esc(displayName)}
        <small>${state.signerMode.toUpperCase()}</small>
      </span>
      <span class="caret">▾</span>
    `;
    statusEl.classList.add("connected");
    if (avatarSlot) avatarSlot.innerHTML = avatarHtml;
    if (nameSlot) nameSlot.textContent = profile?.name || "Signed in";
    if (pubkeySlot) pubkeySlot.textContent = shortKey;
    if (signoutButton) signoutButton.disabled = false;
  } else {
    statusEl.innerHTML = `
      <span class="signer-icon"><span>⚡</span></span>
      <span class="signer-text">
        Signer: ${state.signerMode.toUpperCase()}
        <small>Click to connect</small>
      </span>
    `;
    statusEl.classList.remove("connected");
    if (avatarSlot) avatarSlot.innerHTML = `<span>⚡</span>`;
    if (nameSlot) nameSlot.textContent = "Not connected";
    if (pubkeySlot) pubkeySlot.textContent = "";
    if (signoutButton) signoutButton.disabled = true;
    hideSignerMenu();
  }
  statusEl.setAttribute("aria-expanded", "false");
}

export function renderRelays(defaults, userRelays, setConfig) {
  const defaultEl = document.getElementById("default-relays");
  const userEl = document.getElementById("user-relays");

  defaultEl.innerHTML = defaults.length
    ? defaults.map((relay) => `<li>${relay}</li>`).join("")
    : `<li class="muted">Defaults not loaded yet.</li>`;

  userEl.innerHTML = userRelays.length
    ? userRelays
        .map(
          (relay) =>
            `<li><span>${relay}</span> <button class="ghost" data-relay="${relay}">Remove</button></li>`
        )
        .join("")
    : `<li class="muted">No custom relays yet.</li>`;

  userEl.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const next = userRelays.filter((relay) => relay !== btn.dataset.relay);
      await setConfig("user_relays", next);
      renderRelays(defaults, next, setConfig);
    });
  });
}

export function renderForm(kind, draft, state, KINDS) {
  const form = document.getElementById(`${kind}-form`);
  const titleEl = document.getElementById(`${kind}-form-title`);
  const isEdit = Boolean(draft);
  titleEl.textContent = isEdit
    ? `Edit ${kind.toUpperCase()} draft`
    : `Create ${kind.toUpperCase()}`;

  const publishedValue = draft?.published_at ? draft.published_at : nowSeconds();

  if (kind === "ncc") {
    form.innerHTML = `
      <label class="field"><span>NCC number</span><input name="d" required inputmode="numeric" pattern="\\d+" placeholder="00" value="${esc(
        stripNccNumber(draft?.d)
      )}" /></label>
      <p class="muted small">The <code>ncc-</code> prefix is added automatically.</p>
      <label class="field"><span>Title</span><input name="title" required value="${esc(
        draft?.title || ""
      )}" /></label>
      <label class="field"><span>Content (Markdown)</span><textarea name="content">${esc(
        draft?.content || ""
      )}</textarea></label>
      <label class="field"><span>Summary</span><input name="summary" value="${esc(
        draft?.tags?.summary || ""
      )}" /></label>
      <label class="field"><span>Topics (comma)</span><input name="topics" value="${esc(
        (draft?.tags?.topics || []).join(", ")
      )}" /></label>
      <label class="field"><span>Language (BCP-47)</span><input name="lang" value="${esc(
        draft?.tags?.lang || ""
      )}" /></label>
      <label class="field"><span>Version</span><input name="version" value="${esc(
        draft?.tags?.version || ""
      )}" /></label>
      <label class="field"><span>Supersedes (comma)</span><input name="supersedes" value="${esc(
        (draft?.tags?.supersedes || []).join(", ")
      )}" /></label>
      <label class="field"><span>License</span><input name="license" value="${esc(
        draft?.tags?.license || ""
      )}" /></label>
      <label class="field"><span>Authors (comma)</span><input name="authors" value="${esc(
        (draft?.tags?.authors || []).join(", ")
      )}" /></label>
      <label class="field"><span>Published at (unix seconds)</span><input name="published_at" value="${esc(
        publishedValue
      )}" /></label>
      <div class="form-actions">
        <button class="primary" type="submit">${isEdit ? "Save" : "Create"}</button>
        ${
          isEdit
            ? `<button class="ghost" type="button" data-action="save-remote" data-kind="ncc">Save to Relays</button>`
            : ""
        }
      </div>
    `;
  }

  if (kind === "nsr") {
    const effectiveAtValue = draft?.tags?.effective_at || nowSeconds();
    form.innerHTML = `
      <input type="hidden" name="d" value="${esc(draft?.d || "")}" />
      <input type="hidden" name="authoritative" value="${esc(draft?.tags?.authoritative || "")}" />
      <input type="hidden" name="steward" value="${esc(draft?.tags?.steward || "")}" />
      <input type="hidden" name="previous" value="${esc(draft?.tags?.previous || "")}" />
      <div class="muted small">Select an NCC + event above to populate the hidden NCC number &amp; event id.</div>
      <label class="field"><span>Reason</span><input name="reason" value="${esc(
        draft?.tags?.reason || ""
      )}" /></label>
      <label class="field">
        <span>Effective at (unix seconds)</span>
        <input name="effective_at" value="${esc(effectiveAtValue)}" />
      </label>
      <label class="field"><span>Content</span><textarea name="content">${esc(
        draft?.content || ""
      )}</textarea></label>
      <div class="form-actions">
        <button class="primary" type="submit">${isEdit ? "Save" : "Create"}</button>
        ${
          isEdit
            ? `<button class="ghost" type="button" data-action="save-remote" data-kind="nsr">Save to Relays</button>`
            : ""
        }
      </div>
    `;
  }

  if (kind === "endorsement") {
    form.innerHTML = `
      <input type="hidden" name="d" value="${esc(draft?.d || "")}" />
      <input type="hidden" name="endorses" value="${esc(draft?.tags?.endorses || "")}" />
      <div class="muted small">Pick an NCC and event from the helper above; those values are stored in the hidden inputs.</div>
      <label class="field"><span>Roles (comma)</span><input name="roles" value="${esc(
        (draft?.tags?.roles || []).join(", ")
      )}" /></label>
      <label class="field"><span>Implementation</span><input name="implementation" value="${esc(
        draft?.tags?.implementation || ""
      )}" /></label>
      <label class="field"><span>Note</span><input name="note" value="${esc(
        draft?.tags?.note || ""
      )}" /></label>
      <label class="field"><span>Topics (comma)</span><input name="topics" value="${esc(
        (draft?.tags?.topics || []).join(", ")
      )}" /></label>
      <label class="field"><span>Content</span><textarea name="content">${esc(
        draft?.content || ""
      )}</textarea></label>
      <div class="form-actions">
        <button class="primary" type="submit">${isEdit ? "Save" : "Create"}</button>
        ${
          isEdit
            ? `<button class="ghost" type="button" data-action="save-remote" data-kind="endorsement">Save to Relays</button>`
            : ""
        }
      </div>
    `;
  }

  if (kind === "supporting") {
    const publishedValue = draft?.tags?.published_at || nowSeconds();
    form.innerHTML = `
      <div class="supporting-grid">
        <div class="supporting-fields">
          <label class="field"><span>Document ID</span><input name="d" required pattern="\\S+" placeholder="guides-usage" value="${esc(
            draft?.d || ""
          )}" /></label>
          <p class="muted small">Supporting document IDs must be unique per author.</p>
          <label class="field"><span>For NCC</span><input name="for" required value="${esc(
            draft?.tags?.for || ""
          )}" /></label>
          <label class="field"><span>For event (optional)</span><input name="for_event" value="${esc(
            draft?.tags?.for_event || ""
          )}" /></label>
          <label class="field"><span>Title</span><input name="title" required value="${esc(
            draft?.tags?.title || ""
          )}" /></label>
          <label class="field"><span>Type</span>
            <select name="type">
              <option value="">Select a type</option>
              <option value="guide"${draft?.tags?.type === "guide" ? " selected" : ""}>Guide</option>
              <option value="implementation"${draft?.tags?.type === "implementation" ? " selected" : ""}>Implementation</option>
              <option value="faq"${draft?.tags?.type === "faq" ? " selected" : ""}>FAQ</option>
              <option value="migration"${draft?.tags?.type === "migration" ? " selected" : ""}>Migration</option>
              <option value="examples"${draft?.tags?.type === "examples" ? " selected" : ""}>Examples</option>
              <option value="rationale"${draft?.tags?.type === "rationale" ? " selected" : ""}>Rationale</option>
            </select>
          </label>
          <label class="field"><span>Published at (unix seconds)</span><input name="published_at" value="${esc(
            publishedValue
          )}" /></label>
          <label class="field"><span>Language (BCP-47)</span><input name="lang" value="${esc(
            draft?.tags?.lang || ""
          )}" /></label>
          <label class="field"><span>Topics (comma)</span><input name="topics" value="${esc(
            (draft?.tags?.topics || []).join(", ")
          )}" /></label>
          <label class="field"><span>License</span><input name="license" value="${esc(
            draft?.tags?.license || ""
          )}" /></label>
          <label class="field"><span>Authors (comma)</span><input name="authors" value="${esc(
            (draft?.tags?.authors || []).join(", ")
          )}" /></label>
        </div>
        <div class="supporting-content">
          <label class="field"><span>Content (Markdown)</span><textarea name="content">${esc(
            draft?.content || ""
          )}</textarea></label>
        </div>
      </div>
      <div class="form-actions">
        <button class="primary" type="submit" hidden>${isEdit ? "Save" : "Create"}</button>
        ${
          isEdit
            ? `<button class="ghost" type="button" data-action="save-remote" data-kind="supporting" hidden>Save to Relays</button>`
            : ""
        }
      </div>
    `;
  }
}

export function renderDashboard(
  state,
  listDrafts,
  openNccView,
  publishDraft,
  setupEndorsementCounterButtons,
  renderEndorsementDetailsPanel,
  withdrawDraft,
  handleEdit,
  handleRevise
) {
  const listEl = document.getElementById("recent-nccs");
  const localDrafts = state.nccLocalDrafts || [];
  const relayDocs = state.nccDocs || [];
  const remoteDrafts = state.remoteDrafts || [];

  const localMap = new Map(
    localDrafts
      .filter((draft) => draft.source !== "relay")
      .map((draft) => [draft.event_id || draft.id, draft])
  );
  const combined = [];

  for (const draft of localDrafts) {
    const isRelay = draft.source === "relay";
    combined.push({
      id: draft.id,
      d: draft.d,
      title: draft.title || "Untitled",
      status: isRelay ? "published" : draft.status || "draft",
      published_at: draft.published_at || (isRelay ? draft.created_at : null),
      event_id: draft.event_id || "",
      source: isRelay ? "relay" : "local",
      content: draft.content || "",
      tags: draft.tags || {},
      updated_at: draft.updated_at || 0,
      author: draft.author_pubkey || state.signerPubkey || ""
    });
  }

  for (const event of relayDocs) {
    if (localMap.has(event.id)) continue;
    const publishedAtRaw = eventTagValue(event.tags, "published_at");
    const publishedAt =
      publishedAtRaw && String(publishedAtRaw).match(/^\d+$/) ? Number(publishedAtRaw) : null;
    const statusTag = eventTagValue(event.tags, "status");
    combined.push({
      id: event.id,
      d: eventTagValue(event.tags, "d"),
      title: eventTagValue(event.tags, "title") || "Untitled",
      status: statusTag || "published",
      published_at: publishedAt,
      event_id: event.id,
      source: "relay",
      content: event.content || "",
      tags: event.tags || [],
      updated_at: (event.created_at || 0) * 1000,
      author: event.pubkey
    });
  }

  const grouped = new Map();
  for (const item of combined) {
    if (!item.d) continue;
    const key = item.d;
    const existing = grouped.get(key);
    if (!existing || (item.updated_at || 0) > (existing.updated_at || 0)) {
      grouped.set(key, item);
    }
  }
  const sorted = Array.from(grouped.values())
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
    .slice(0, 12);

  const canPublish = Boolean(state.signerPubkey);
  const endorsementCounts = state.endorsementCounts || new Map();

  let html = sorted
    .map((item) => {
      const normalizedEventId = normalizeHexId(item.event_id);
      const endorsementCount = 
        normalizedEventId && normalizedEventId.length
          ? endorsementCounts.get(normalizedEventId) || 0
          : 0;
      const endorsementMeta = normalizedEventId
        ? `<button class="ghost meta-button" type="button" data-action="show-endorsements" data-target="${normalizedEventId}" data-label="${esc(
            item.d
          )}">Endorsements: ${endorsementCount}</button>`
        : `<span>Endorsements: ${endorsementCount}</span>`;
      
      const statusClass = `status-${(item.status || "draft").toLowerCase()}`;
      const statusLabel = (item.status || "DRAFT").toUpperCase();
      
      const isOwner = state.signerPubkey && item.author === state.signerPubkey;
      const canWithdraw = isOwner && item.status !== "withdrawn";

      const isDraft = item.status !== "published" && item.status !== "withdrawn";
      const isPublished = item.status === "published";
      const isLocal = item.source === "local";
      const showPublish = canPublish && isLocal && isDraft;

      let buttons = `<button class="ghost" data-action="view" data-id="${item.id}">View</button>`;

      if (isDraft && isLocal && isOwner) {
         buttons += `<button class="ghost" data-action="edit-dashboard" data-id="${item.id}">Edit</button>`;
      }

      if (isPublished && canPublish) {
         buttons += `<button class="ghost" data-action="revise-dashboard" data-id="${item.id}">Revise</button>`;
      }

      if (showPublish) {
         buttons += `<button class="primary" data-action="publish" data-id="${item.id}" data-kind="ncc">Publish</button>`;
      }

      if (canWithdraw) {
         buttons += `<button class="ghost" data-action="withdraw" data-id="${item.id}" style="color: var(--error);">Withdraw</button>`;
      }

      return `
        <div class="card">
          <strong>${esc(item.d)} - ${esc(item.title)}</strong>
          <div class="meta">
            <span class="badge ${statusClass}">${esc(statusLabel)}</span>
            <span>Published: ${ 
              item.published_at ? new Date(item.published_at * 1000).toLocaleString() : "-"
            }</span>
            <span>Event ID: ${item.event_id ? `${item.event_id.slice(0, 10)}…` : "-"}</span>
            <span>Author: ${esc(item.author ? shortenKey(item.author) : "unknown")}</span>
            ${endorsementMeta}
          </div>
          <div class="actions">
            ${buttons}
          </div>
        </div>
      `;
    })
    .join("");

  if (remoteDrafts.length > 0) {
    html += `<div class="divider"></div><h3>Remote Drafts (on Relays)</h3>`;
    html += remoteDrafts.map((event) => {
      const d = eventTagValue(event.tags, "d").replace(/^draft:/, "");
      const title = eventTagValue(event.tags, "title") || "Untitled Draft";
      const updated = (event.created_at || 0) * 1000;
      const author = event.pubkey;
      
      return `
        <div class="card" style="border-color: var(--accent);">
          <strong>${esc(d)} - ${esc(title)}</strong>
          <div class="meta">
            <span>Source: Remote Draft</span>
            <span>Saved: ${new Date(updated).toLocaleString()}</span>
            <span>Author: ${esc(author ? shortenKey(author) : "unknown")}</span>
          </div>
          <div class="actions">
            <button class="ghost" data-action="import-remote" data-id="${event.id}">Import as Local Draft</button>
          </div>
        </div>
      `;
    }).join("");
  }

  if (!sorted.length && !remoteDrafts.length) {
    listEl.innerHTML = `<div class="card">No NCCs available yet.</div>`;
    return;
  }

  listEl.innerHTML = html;

  setupEndorsementCounterButtons();
  renderEndorsementDetailsPanel(state);

  listEl.querySelectorAll('button[data-action="view"]').forEach((button) => {
    button.addEventListener("click", () => {
      const target = sorted.find((item) => item.id === button.dataset.id);
      if (!target) return;
      openNccView(target, localDrafts);
    });
  });

  listEl.querySelectorAll('button[data-action="publish"]').forEach((button) => {
    button.addEventListener("click", async () => {
      const targetId = button.dataset.id;
      const kind = button.dataset.kind || "ncc";
      const targetDraft = localDrafts.find((draft) => draft.id === targetId);
      if (!targetDraft) return;
      button.disabled = true;
      await publishDraft(targetDraft, kind);
    });
  });

  listEl.querySelectorAll('button[data-action="withdraw"]').forEach((button) => {
    button.addEventListener("click", async () => {
      if (!withdrawDraft) return;
      const targetId = button.dataset.id;
      if (!confirm("Are you sure you want to withdraw this NCC? This will publish a withdrawal update to relays.")) return;
      button.disabled = true;
      await withdrawDraft(targetId);
      button.disabled = false;
    });
  });

  listEl.querySelectorAll('button[data-action="edit-dashboard"]').forEach((button) => {
    button.addEventListener("click", () => {
      if (!handleEdit) return;
      handleEdit(button.dataset.id);
    });
  });

  listEl.querySelectorAll('button[data-action="revise-dashboard"]').forEach((button) => {
    button.addEventListener("click", () => {
      if (!handleRevise) return;
      handleRevise(button.dataset.id);
    });
  });
}

export function renderEndorsementDetailsPanel(state) {
  const panel = document.getElementById("endorsement-details-panel");
  if (!panel) return;
  const targetId = state.selectedEndorsementTarget;
  if (!targetId) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }
  const entries = state.endorsementDetails?.get(targetId) || [];
  const label = state.selectedEndorsementLabel || "this NCC";
  const detailsContent = 
    entries.length > 0
      ? entries
          .map((entry) => {
            const author = entry.author ? shortenKey(entry.author) : "unknown";
            const eventDate = entry.created_at
              ? new Date(entry.created_at * 1000).toLocaleString()
              : "Unknown date";
            const roles = entry.roles?.length
              ? `<span class="muted small">Roles: ${esc(entry.roles.join(", "))}</span>`
              : "";
            const topics = entry.topics?.length
              ? `<span class="muted small">Topics: ${esc(entry.topics.join(", "))}</span>`
              : "";
            const note = entry.note ? `<p>${esc(entry.note)}</p>` : "";
            const implementation = entry.implementation
              ? `<p class="muted small">Implementation: ${esc(entry.implementation)}</p>`
              : "";
            const nccLabel = entry.d ? `<span class="muted small">NCC: ${esc(entry.d)}</span>` : "";
            return `
              <div class="card endorsement-detail">
                <div class="meta">
                  <span>Event: ${shortenKey(entry.id)}</span>
                  <span>Author: ${esc(author)}</span>
                  <span>${eventDate}</span>
                </div>
                <div class="meta">
                  ${nccLabel}
                  ${roles}
                  ${topics}
                </div>
                ${note}
                ${implementation}
              </div>
            `;
          })
          .join("")
      : `<div class="card"><p class="muted small">No endorsement events recorded yet.</p></div>`;
  panel.innerHTML = `
    <div class="endorsement-details-header">
      <strong>Endorsements for ${esc(label)}</strong>
      <button class="ghost meta-button" type="button" data-action="close-endorsement-details">Close</button>
    </div>
    <p class="muted small">${entries.length} event${entries.length === 1 ? "" : "s"} documented.</p>
    ${detailsContent}
  `;
  panel.hidden = false;
}

export function renderNsrHelpers(state) {
  const nccSelect = document.getElementById("nsr-ncc-select");
  const eventSelect = document.getElementById("nsr-event-select");
  const helper = document.getElementById("nsr-helper-text");
  if (!nccSelect || !eventSelect || !helper) return;

  const signerKey = state.signerPubkey?.toLowerCase() || "";
  if (!signerKey) {
    nccSelect.innerHTML = `<option value="">Connect a signer first</option>`;
    eventSelect.innerHTML = `<option value="">Signer required</option>`;
    helper.textContent = "Connect with your signer to load NCC ownership data.";
    return;
  }

  const ownedEvents = (state.nccDocs || []).filter(
    (event) => (event.pubkey || "").toLowerCase() === signerKey
  );
  if (!ownedEvents.length) {
    nccSelect.innerHTML = `<option value="">No owned NCC documents</option>`;
    eventSelect.innerHTML = `<option value="">Select an NCC first</option>`;
    helper.textContent = "Fetch NCC documents from relays to list yours.";
    return;
  }

  const options = buildNccOptions(ownedEvents);
  const eventMap = new Map(ownedEvents.map((event) => [event.id, event]));

  nccSelect.innerHTML = [
    `<option value="">Select your NCC</option>`,
    ...options.map((item) => `<option value="${item.d}">${item.d}</option>`)
  ].join("");

  helper.textContent = "Pick an NCC you control to prefill NSR details.";

  nccSelect.onchange = () => {
    const selected = options.find((item) => item.d === nccSelect.value);
    if (!selected) {
      eventSelect.innerHTML = `<option value="">Select an NCC first</option>`;
      helper.textContent = "Pick an NCC to populate the event list.";
      return;
    }
    eventSelect.innerHTML = selected.events
      .map((event) => {
        const label = event.title
          ? `${event.title} · ${event.id.slice(0, 8)}…`
          : event.id.slice(0, 16) + "…";
        return `<option value="${event.id}">${label}</option>`;
      })
      .join("");
    if (selected.events.length) {
      eventSelect.value = selected.events[0].id;
      eventSelect.dispatchEvent(new Event("change"));
    }
    helper.textContent = "Select the event that is authoritative for this NSR.";
  };

  eventSelect.onchange = () => {
    const selectedEvent = eventMap.get(eventSelect.value);
    const form = document.getElementById("nsr-form");
    if (!form) return;
    const dInput = form.querySelector('input[name="d"]');
    const authoritativeInput = form.querySelector('input[name="authoritative"]');
    const stewardInput = form.querySelector('input[name="steward"]');
    if (selectedEvent) {
      const dTag = eventTagValue(selectedEvent.tags, "d");
      if (dInput && dTag) {
        dInput.value = stripNccNumber(dTag);
      }
      if (authoritativeInput) {
        authoritativeInput.value = selectedEvent.id;
      }
      if (stewardInput && state.signerPubkey) {
        stewardInput.value = state.signerPubkey;
      }
    }
  };
}

export function renderEndorsementHelpers(state) {
  const nccSelect = document.getElementById("endorse-ncc-select");
  const eventSelect = document.getElementById("endorse-event-select");
  const helper = document.getElementById("endorse-helper-text");
  if (!nccSelect || !eventSelect || !helper) return;

  if (!state.nccOptions.length) {
    nccSelect.innerHTML = `<option value="">No NCCs loaded</option>`;
    eventSelect.innerHTML = `<option value="">Select an NCC</option>`;
    helper.textContent = "No NCC documents loaded from relays yet.";
    return;
  }

  nccSelect.innerHTML = [
    `<option value="">Select NCC identifier</option>`,
    ...state.nccOptions.map((item) => `<option value="${item.d}">${item.d}</option>`)
  ].join("");

  nccSelect.onchange = () => {
    const selected = state.nccOptions.find((item) => item.d === nccSelect.value);
    if (!selected) {
      eventSelect.innerHTML = `<option value="">Select an NCC first</option>`;
      helper.textContent = "Pick an NCC to see its latest documents.";
      return;
    }
    eventSelect.innerHTML = selected.events
      .map((event) => {
        const label = event.title
          ? `${event.title} · ${event.id.slice(0, 8)}…`
          : event.id.slice(0, 16) + "…";
        return `<option value="${event.id}">${label}</option>`;
      })
      .join("");
    if (selected.events.length) {
      eventSelect.value = selected.events[0].id;
      eventSelect.dispatchEvent(new Event("change"));
    }
    helper.textContent = "Choose the document event you want to endorse.";
  };

  eventSelect.onchange = () => {
    const selectedD = nccSelect.value;
    if (!selectedD || !eventSelect.value) return;
    const dInput = document.querySelector('#endorsement-form input[name="d"]');
    const endorsesInput = document.querySelector('#endorsement-form input[name="endorses"]');
    if (dInput) dInput.value = stripNccNumber(selectedD);
    if (endorsesInput) endorsesInput.value = eventSelect.value;
  };
}

export function renderDrafts(
  kind,
  state,
  listDrafts,
  KINDS,
  fetchAuthorEndorsements,
  persistRelayEvents,
  payloadToDraft,
  createEventTemplate,
  downloadJson,
  publishDraft,
  verifyDraft,
  showToast
) {
  const listEl = document.getElementById(`${kind}-list`);
  if (!listEl) return;
  listDrafts(KINDS[kind]).then(async (drafts) => {
    let combined = drafts.map((draft) => ({
      id: draft.id,
      d: draft.d,
      status: draft.status,
      updated_at: draft.updated_at,
      event_id: draft.event_id,
      source: "local",
      author: draft.author_pubkey || "",
      content: draft.content || "",
      tags: draft.tags || {}
    }));

    if (kind === "endorsement" && state.signerPubkey) {
      let relays = [];
      try {
        relays = await getRelays(getConfig);
      } catch (error) {
        console.warn("NCC Manager: failed to load relay list for endorsements", error);
      }
      if (relays.length) {
        try {
          const events = await fetchAuthorEndorsements(relays, state.signerPubkey);
          if (events.length) {
            const publishedLocalIds = new Set(
              drafts
                .map((draft) => draft.event_id)
                .filter(Boolean)
                .map((id) => normalizeHexId(id))
            );
            await persistRelayEvents(events);
            combined = combined.concat(
              events
                .filter((event) => !publishedLocalIds.has(normalizeHexId(event.id)))
                .map((event) => ({
                  id: event.id,
                  d: eventTagValue(event.tags, "d") || "",
                  status: "published",
                  updated_at: (event.created_at || 0) * 1000,
                  event_id: event.id,
                  source: "relay",
                  tags: event.tags || [],
                  published_at: event.created_at,
                  content: event.content || "",
                  author: event.pubkey || "",
                  rawEvent: event
                }))
            );
          }
        } catch (error) {
          console.warn("NCC Manager: failed to load published endorsements", error);
        }
      }
    }

    if (!combined.length) {
      state.renderedDrafts = { ...state.renderedDrafts, [kind]: [] };
      listEl.innerHTML = `<div class="card">No drafts yet.</div>`;
      return;
    }

    const aggregateByEvent = new Map();
    const addEntry = (entry) => {
      const key = normalizeHexId(entry.event_id) || entry.id;
      const existing = aggregateByEvent.get(key);
      if (!existing) {
        aggregateByEvent.set(key, entry);
        return;
      }
      if ((entry.updated_at || 0) <= (existing.updated_at || 0)) return;
      aggregateByEvent.set(key, entry);
    };
    combined.forEach(addEntry);
    const finalList = Array.from(aggregateByEvent.values());
    state.renderedDrafts = { ...state.renderedDrafts, [kind]: finalList };
    const renderActions = (item) => {
      const isLocal = item.source === "local";
      const isRelay = item.source === "relay";
      const authorKey = (item.author || "").toLowerCase();
      const ownerKey = state.signerPubkey?.toLowerCase() || "";
      const ownsRelay = ownerKey && authorKey && ownerKey === authorKey;
      if (isRelay && !ownsRelay) {
        const hint = ownerKey ? "" : " — sign in to manage your endorsements";
        return `<span class="muted">Published on relays${hint}</span>`;
      }
      const publishButton = 
        item.status !== "published"
          ? `<button class="primary" data-action="publish" data-id="${item.id}" ${ownerKey ? "" : 'disabled title="Sign in to publish"'}>Publish</button>`
          : "";
      const actions = [];
      if (isLocal) {
        actions.push(`<button class="ghost" data-action="edit" data-id="${item.id}">Edit</button>`);
      }
      actions.push(
        `<button class="ghost" data-action="duplicate" data-id="${item.id}">Duplicate</button>`
      );
      actions.push(
        `<button class="ghost" data-action="export" data-id="${item.id}">Export JSON</button>`
      );
      if (publishButton) actions.push(publishButton);
      actions.push(
        `<button class="ghost" data-action="verify" data-id="${item.id}">Verify</button>`
      );
      if (isLocal) {
        actions.push(
          `<button class="danger" data-action="delete" data-id="${item.id}">Delete</button>`
        );
      }
      return actions.join("");
    };

    listEl.innerHTML = finalList
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
      .map(
        (draft) => `
          <div class="card">
            <strong>${esc(draft.d || "(no identifier)")}</strong>
            <div class="meta">
              <span>Status: ${esc(draft.status)}</span>
              <span>Updated: ${new Date(draft.updated_at || 0).toLocaleString()}</span>
              <span>Event: ${draft.event_id ? draft.event_id.slice(0, 10) + "…" : "-"}</span>
            </div>
            <div class="actions">
              ${renderActions(draft)}
            </div>
          </div>
        `
      )
      .join("");
  });
}
