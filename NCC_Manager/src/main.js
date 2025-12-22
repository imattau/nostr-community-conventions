import "./styles.css";
import {
  saveDraft,
  listDrafts,
  listRecentDrafts,
  deleteDraft,
  getDraft,
  setConfig,
  getConfig
} from "./store.js";
import {
  createEventTemplate,
  payloadToDraft,
  getSigner,
  publishEvent,
  verifyEvent,
  fetchNccDocuments
} from "./nostr.js";

const KINDS = {
  ncc: 30050,
  nsr: 30051,
  endorsement: 30052
};

const state = {
  defaults: [],
  signerMode: "nip07",
  nccOptions: [],
  currentDraft: {
    ncc: null,
    nsr: null,
    endorsement: null
  }
};

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function splitList(value) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniq(list) {
  return [...new Set(list.filter(Boolean))];
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function showToast(message, type = "info") {
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

async function fetchDefaults() {
  try {
    const res = await fetch("/api/defaults");
    const data = await res.json();
    state.defaults = data.relays || [];
    await setConfig("default_relays", state.defaults);
    renderRelays();
  } catch (error) {
    showToast("Failed to load default relays.", "error");
  }
}

async function loadConfig() {
  state.defaults = (await getConfig("default_relays", [])) || [];
  state.signerMode = (await getConfig("signer_mode", "nip07")) || "nip07";
  const modeSelect = document.getElementById("signer-mode");
  modeSelect.value = state.signerMode;
  updateSignerStatus();
}

async function getRelays() {
  const custom = (await getConfig("user_relays", [])) || [];
  return uniq([...state.defaults, ...custom]);
}

async function updateSignerStatus() {
  const statusEl = document.getElementById("signer-status");
  const helpEl = document.getElementById("signer-help");
  const mode = state.signerMode;
  const nsec = sessionStorage.getItem("ncc-manager-nsec");
  try {
    const signer = await getSigner(mode, nsec);
    statusEl.textContent = `Signer: ${signer.type} · ${signer.pubkey.slice(0, 12)}…`;
    helpEl.textContent =
      mode === "nip07"
        ? "Using your browser signer. Keys stay in your extension."
        : "Using a session-only nsec. It is never saved to disk.";
  } catch (error) {
    statusEl.textContent = `Signer: ${mode} not ready`;
    helpEl.textContent =
      mode === "nip07"
        ? "Install a NIP-07 signer (e.g. Alby) to sign events."
        : "Enter a valid nsec to enable local signing.";
  }
}

function switchView(view) {
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", section.dataset.view === view);
  });
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
}

async function renderDashboard() {
  const drafts = await listDrafts();
  const statsEl = document.getElementById("status-stats");
  const recentEl = document.getElementById("recent-drafts");
  const recentPublishedEl = document.getElementById("recent-published");

  const counts = drafts.reduce(
    (acc, draft) => {
      acc.total += 1;
      if (draft.kind === KINDS.ncc) acc.ncc += 1;
      if (draft.kind === KINDS.nsr) acc.nsr += 1;
      if (draft.kind === KINDS.endorsement) acc.endorsement += 1;
      if (draft.status === "published") acc.published += 1;
      return acc;
    },
    { total: 0, ncc: 0, nsr: 0, endorsement: 0, published: 0 }
  );

  statsEl.innerHTML = [
    `<div class="stat"><span>Total drafts</span><strong>${counts.total}</strong></div>`,
    `<div class="stat"><span>NCC drafts</span><strong>${counts.ncc}</strong></div>`,
    `<div class="stat"><span>NSR drafts</span><strong>${counts.nsr}</strong></div>`,
    `<div class="stat"><span>Endorsements</span><strong>${counts.endorsement}</strong></div>`,
    `<div class="stat"><span>Published</span><strong>${counts.published}</strong></div>`
  ].join("");

  const recent = await listRecentDrafts(6);
  if (!recent.length) {
    recentEl.innerHTML = `<div class="card">No drafts yet.</div>`;
  } else {
    recentEl.innerHTML = recent
      .map(
        (draft) => `
        <div class="card">
          <strong>${draft.d || "(no identifier)"}</strong>
          <div class="meta">
            <span>Kind: ${draft.kind}</span>
            <span>Status: ${draft.status}</span>
            <span>Updated: ${new Date(draft.updated_at).toLocaleString()}</span>
          </div>
        </div>
      `
      )
      .join("");
  }

  const published = drafts.filter((draft) => draft.status === "published");
  if (!published.length) {
    recentPublishedEl.innerHTML = `<div class="card">No published drafts yet.</div>`;
  } else {
    recentPublishedEl.innerHTML = published
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
      .slice(0, 6)
      .map(
        (draft) => `
        <div class="card">
          <strong>${draft.d || "(no identifier)"}</strong>
          <div class="meta">
            <span>Kind: ${draft.kind}</span>
            <span>Event: ${draft.event_id ? draft.event_id.slice(0, 10) + "…" : "-"}</span>
            <span>Published: ${new Date(draft.updated_at).toLocaleString()}</span>
          </div>
        </div>
      `
      )
      .join("");
  }
}

function renderQuickActions() {
  const actionsEl = document.getElementById("quick-actions");
  actionsEl.innerHTML = [
    `<button class="ghost" data-view="ncc">Create NCC</button>`,
    `<button class="ghost" data-view="nsr">Create NSR</button>`,
    `<button class="ghost" data-view="endorsement">Create endorsement</button>`
  ].join("");
  actionsEl.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      switchView(button.dataset.view);
    });
  });
}

async function renderRelays() {
  const defaultEl = document.getElementById("default-relays");
  const userEl = document.getElementById("user-relays");
  const userRelays = (await getConfig("user_relays", [])) || [];

  defaultEl.innerHTML = state.defaults.length
    ? state.defaults.map((relay) => `<li>${relay}</li>`).join("")
    : `<li class="muted">Defaults not loaded yet.</li>`;

  userEl.innerHTML = userRelays.length
    ? userRelays
        .map(
          (relay) => `<li><span>${relay}</span> <button class="ghost" data-relay="${relay}">Remove</button></li>`
        )
        .join("")
    : `<li class="muted">No custom relays yet.</li>`;

  userEl.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const next = userRelays.filter((relay) => relay !== btn.dataset.relay);
      await setConfig("user_relays", next);
      renderRelays();
    });
  });
}

async function addRelay() {
  const input = document.getElementById("relay-input");
  const value = input.value.trim();
  if (!value) return;
  const normalized = value.startsWith("ws") ? value : `wss://${value}`;
  const current = (await getConfig("user_relays", [])) || [];
  if (!current.includes(normalized)) {
    current.push(normalized);
    await setConfig("user_relays", current);
  }
  input.value = "";
  renderRelays();
}

async function clearRelays() {
  await setConfig("user_relays", []);
  renderRelays();
}

function renderForm(kind, draft) {
  const form = document.getElementById(`${kind}-form`);
  const titleEl = document.getElementById(`${kind}-form-title`);
  const isEdit = Boolean(draft);
  titleEl.textContent = isEdit ? `Edit ${kind.toUpperCase()} draft` : `Create ${kind.toUpperCase()}`;

  if (kind === "ncc") {
    form.innerHTML = `
      <label class="field"><span>Identifier (d tag)</span><input name="d" required value="${esc(draft?.d)}" /></label>
      <label class="field"><span>Title</span><input name="title" required value="${esc(draft?.title)}" /></label>
      <label class="field"><span>Content (Markdown)</span><textarea name="content">${esc(draft?.content)}</textarea></label>
      <label class="field"><span>Summary</span><input name="summary" value="${esc(draft?.tags?.summary)}" /></label>
      <label class="field"><span>Topics (comma)</span><input name="topics" value="${esc((draft?.tags?.topics || []).join(", "))}" /></label>
      <label class="field"><span>Language (BCP-47)</span><input name="lang" value="${esc(draft?.tags?.lang)}" /></label>
      <label class="field"><span>Version</span><input name="version" value="${esc(draft?.tags?.version)}" /></label>
      <label class="field"><span>Supersedes (comma)</span><input name="supersedes" value="${esc((draft?.tags?.supersedes || []).join(", "))}" /></label>
      <label class="field"><span>License</span><input name="license" value="${esc(draft?.tags?.license)}" /></label>
      <label class="field"><span>Authors (comma)</span><input name="authors" value="${esc((draft?.tags?.authors || []).join(", "))}" /></label>
      <label class="field"><span>Published at (unix seconds)</span><input name="published_at" value="${esc(draft?.published_at)}" /></label>
      <button class="primary" type="submit">${isEdit ? "Save" : "Create"}</button>
    `;
  }

  if (kind === "nsr") {
    form.innerHTML = `
      <label class="field"><span>Identifier (d tag)</span><input name="d" required value="${esc(draft?.d)}" /></label>
      <label class="field"><span>Authoritative event id</span><input name="authoritative" required value="${esc(draft?.tags?.authoritative)}" /></label>
      <label class="field"><span>Steward pubkey/npub</span><input name="steward" value="${esc(draft?.tags?.steward)}" /></label>
      <label class="field"><span>Previous event id</span><input name="previous" value="${esc(draft?.tags?.previous)}" /></label>
      <label class="field"><span>Reason</span><input name="reason" value="${esc(draft?.tags?.reason)}" /></label>
      <label class="field"><span>Effective at (unix seconds)</span><input name="effective_at" value="${esc(draft?.tags?.effective_at)}" /></label>
      <label class="field"><span>Content</span><textarea name="content">${esc(draft?.content)}</textarea></label>
      <button class="primary" type="submit">${isEdit ? "Save" : "Create"}</button>
    `;
  }

  if (kind === "endorsement") {
    form.innerHTML = `
      <label class="field"><span>Identifier (d tag)</span><input name="d" required value="${esc(draft?.d)}" /></label>
      <label class="field"><span>Endorses event id</span><input name="endorses" required value="${esc(draft?.tags?.endorses)}" /></label>
      <label class="field"><span>Roles (comma)</span><input name="roles" value="${esc((draft?.tags?.roles || []).join(", "))}" /></label>
      <label class="field"><span>Implementation</span><input name="implementation" value="${esc(draft?.tags?.implementation)}" /></label>
      <label class="field"><span>Note</span><input name="note" value="${esc(draft?.tags?.note)}" /></label>
      <label class="field"><span>Topics (comma)</span><input name="topics" value="${esc((draft?.tags?.topics || []).join(", "))}" /></label>
      <label class="field"><span>Content</span><textarea name="content">${esc(draft?.content)}</textarea></label>
      <button class="primary" type="submit">${isEdit ? "Save" : "Create"}</button>
    `;
  }
}

function eventTagValue(tags, name) {
  if (!Array.isArray(tags)) return "";
  const found = tags.find((tag) => tag[0] === name);
  return found ? found[1] : "";
}

function buildNccOptions(events) {
  const grouped = {};
  for (const event of events) {
    const dValue = eventTagValue(event.tags, "d");
    if (!dValue) continue;
    if (!grouped[dValue]) grouped[dValue] = [];
    grouped[dValue].push(event);
  }
  return Object.keys(grouped)
    .sort()
    .map((dValue) => ({
      d: dValue,
      events: grouped[dValue]
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
        .map((event) => ({
          id: event.id,
          title: eventTagValue(event.tags, "title"),
          created_at: event.created_at || 0
        }))
    }));
}

function renderEndorsementHelpers() {
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
        const label = event.title ? `${event.title} · ${event.id.slice(0, 8)}…` : event.id.slice(0, 16) + "…";
        return `<option value="${event.id}">${label}</option>`;
      })
      .join("");
    helper.textContent = "Choose the document event you want to endorse.";
  };

  eventSelect.onchange = () => {
    const selectedD = nccSelect.value;
    if (!selectedD || !eventSelect.value) return;
    const dInput = document.querySelector("#endorsement-form input[name=\"d\"]");
    const endorsesInput = document.querySelector("#endorsement-form input[name=\"endorses\"]");
    if (dInput) dInput.value = selectedD;
    if (endorsesInput) endorsesInput.value = eventSelect.value;
  };
}

async function refreshEndorsementHelpers() {
  const helper = document.getElementById("endorse-helper-text");
  if (helper) helper.textContent = "Loading NCC documents from relays...";
  try {
    const relays = await getRelays();
    const events = await fetchNccDocuments(relays);
    state.nccOptions = buildNccOptions(events);
    renderEndorsementHelpers();
  } catch (error) {
    if (helper) helper.textContent = "Failed to load NCC documents from relays.";
  }
}

async function handleFormSubmit(kind) {
  const form = document.getElementById(`${kind}-form`);
  const formData = new FormData(form);

  const base = state.currentDraft[kind] || {};
  const draft = {
    ...base,
    id: base.id || crypto.randomUUID(),
    kind: KINDS[kind],
    status: base.status || "draft",
    d: formData.get("d")?.trim(),
    title: formData.get("title")?.trim() || "",
    content: formData.get("content")?.trim() || "",
    published_at: formData.get("published_at") ? Number(formData.get("published_at")) : base.published_at
  };

  if (kind === "ncc") {
    draft.tags = {
      summary: formData.get("summary")?.trim() || "",
      topics: splitList(formData.get("topics")),
      lang: formData.get("lang")?.trim() || "",
      version: formData.get("version")?.trim() || "",
      supersedes: splitList(formData.get("supersedes")),
      license: formData.get("license")?.trim() || "",
      authors: splitList(formData.get("authors"))
    };
  }

  if (kind === "nsr") {
    draft.tags = {
      authoritative: formData.get("authoritative")?.trim() || "",
      steward: formData.get("steward")?.trim() || "",
      previous: formData.get("previous")?.trim() || "",
      reason: formData.get("reason")?.trim() || "",
      effective_at: formData.get("effective_at")?.trim() || ""
    };
  }

  if (kind === "endorsement") {
    draft.tags = {
      endorses: formData.get("endorses")?.trim() || "",
      roles: splitList(formData.get("roles")),
      implementation: formData.get("implementation")?.trim() || "",
      note: formData.get("note")?.trim() || "",
      topics: splitList(formData.get("topics"))
    };
  }

  await saveDraft(draft);
  state.currentDraft[kind] = draft;
  showToast(`${kind.toUpperCase()} draft saved.`);
  await renderDrafts(kind);
  renderDashboard();
}

async function renderDrafts(kind) {
  const listEl = document.getElementById(`${kind}-list`);
  const drafts = await listDrafts(KINDS[kind]);

  if (!drafts.length) {
    listEl.innerHTML = `<div class="card">No drafts yet.</div>`;
    return;
  }

  listEl.innerHTML = drafts
    .map(
      (draft) => `
        <div class="card">
          <strong>${esc(draft.d || "(no identifier)")}</strong>
          <div class="meta">
            <span>Status: ${draft.status}</span>
            <span>Updated: ${new Date(draft.updated_at).toLocaleString()}</span>
            <span>Event: ${draft.event_id ? draft.event_id.slice(0, 10) + "…" : "-"}</span>
          </div>
          <div class="actions">
            <button class="ghost" data-action="edit" data-id="${draft.id}">Edit</button>
            <button class="ghost" data-action="duplicate" data-id="${draft.id}">Duplicate</button>
            <button class="ghost" data-action="export" data-id="${draft.id}">Export JSON</button>
            <button class="primary" data-action="publish" data-id="${draft.id}">Publish</button>
            <button class="ghost" data-action="verify" data-id="${draft.id}">Verify</button>
            <button class="danger" data-action="delete" data-id="${draft.id}">Delete</button>
          </div>
        </div>
      `
    )
    .join("");
}

async function handleListAction(kind, event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.action;
  const id = target.dataset.id;
  if (!action || !id) return;

  if (action === "delete") {
    await deleteDraft(id);
    showToast("Draft deleted.");
    renderDrafts(kind);
    renderDashboard();
    return;
  }

  const draft = await getDraft(id);
  if (!draft) return;

  if (action === "edit") {
    state.currentDraft[kind] = draft;
    renderForm(kind, draft);
    return;
  }

  if (action === "duplicate") {
    const clone = {
      ...draft,
      id: crypto.randomUUID(),
      status: "draft",
      event_id: "",
      author_pubkey: ""
    };
    if (kind === "ncc" && draft.event_id) {
      const supersedes = new Set(clone.tags?.supersedes || []);
      supersedes.add(`event:${draft.event_id}`);
      clone.tags.supersedes = Array.from(supersedes);
    }
    if (kind === "nsr" && draft.event_id) {
      clone.tags.previous = `event:${draft.event_id}`;
    }
    await saveDraft(clone);
    showToast("Draft duplicated.");
    renderDrafts(kind);
    renderDashboard();
    return;
  }

  if (action === "export") {
    const payload = createEventTemplate(draft);
    payload.event_id = draft.event_id || undefined;
    payload.author_pubkey = draft.author_pubkey || undefined;
    downloadJson(`draft-${draft.d || draft.id}.json`, payload);
    return;
  }

  if (action === "publish") {
    await publishDraft(draft, kind);
    return;
  }

  if (action === "verify") {
    await verifyDraft(draft);
  }
}

async function publishDraft(draft, kind) {
  try {
    const validationError = validateDraft(draft, kind);
    if (validationError) throw new Error(validationError);
    const relays = await getRelays();
    if (!relays.length) throw new Error("No relays configured");
    const signerMode = state.signerMode;
    const nsec = sessionStorage.getItem("ncc-manager-nsec");
    const signer = await getSigner(signerMode, nsec);

    const template = createEventTemplate(draft);
    const event = await signer.signEvent(template);
    const result = await publishEvent(relays, event);

    const updated = {
      ...draft,
      status: "published",
      event_id: event.id,
      author_pubkey: signer.pubkey,
      published_at: draft.published_at || nowSeconds()
    };
    await saveDraft(updated);
    state.currentDraft[kind] = updated;
    renderForm(kind, updated);
    renderDrafts(kind);
    renderDashboard();
    showToast(`Published to ${result.accepted}/${result.total} relays.`);
  } catch (error) {
    showToast(`Publish failed: ${error.message}`, "error");
  }
}

function validateDraft(draft, kind) {
  if (!draft.d) return "Identifier (d tag) is required.";
  if (kind === "ncc") {
    if (!draft.title) return "Title is required.";
    if (!draft.content) return "Content is required.";
  }
  if (kind === "nsr") {
    if (!draft.tags?.authoritative) return "Authoritative event id is required.";
  }
  if (kind === "endorsement") {
    if (!draft.tags?.endorses) return "Endorses event id is required.";
  }
  return "";
}

async function verifyDraft(draft) {
  if (!draft.event_id) {
    showToast("No event id to verify.", "error");
    return;
  }
  try {
    const relays = await getRelays();
    const found = await verifyEvent(relays, draft.event_id);
    showToast(found ? "Event found on relays." : "Event not found yet.");
  } catch (error) {
    showToast("Verification failed.", "error");
  }
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importDraft(file) {
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const draft = payloadToDraft(payload);
    await saveDraft(draft);
    showToast("Draft imported.");
    renderDrafts(kindFromValue(draft.kind));
    renderDashboard();
  } catch (error) {
    showToast("Import failed.", "error");
  }
}

function kindFromValue(kind) {
  if (kind === KINDS.ncc) return "ncc";
  if (kind === KINDS.nsr) return "nsr";
  return "endorsement";
}

async function exportAllDrafts() {
  const drafts = await listDrafts();
  const payloads = drafts.map((draft) => {
    const payload = createEventTemplate(draft);
    payload.event_id = draft.event_id || undefined;
    payload.author_pubkey = draft.author_pubkey || undefined;
    return payload;
  });
  downloadJson("ncc-drafts.json", payloads);
}

async function initForms() {
  renderForm("ncc", null);
  renderForm("nsr", null);
  renderForm("endorsement", null);

  document.getElementById("ncc-form").addEventListener("submit", (event) => {
    event.preventDefault();
    handleFormSubmit("ncc");
  });
  document.getElementById("nsr-form").addEventListener("submit", (event) => {
    event.preventDefault();
    handleFormSubmit("nsr");
  });
  document.getElementById("endorsement-form").addEventListener("submit", (event) => {
    event.preventDefault();
    handleFormSubmit("endorsement");
  });
}

async function initLists() {
  await renderDrafts("ncc");
  await renderDrafts("nsr");
  await renderDrafts("endorsement");

  document.getElementById("ncc-list").addEventListener("click", (event) => handleListAction("ncc", event));
  document.getElementById("nsr-list").addEventListener("click", (event) => handleListAction("nsr", event));
  document
    .getElementById("endorsement-list")
    .addEventListener("click", (event) => handleListAction("endorsement", event));
}

function initNav() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
}

function initNewButtons() {
  document.getElementById("new-ncc").addEventListener("click", () => {
    state.currentDraft.ncc = null;
    renderForm("ncc", null);
  });
  document.getElementById("new-nsr").addEventListener("click", () => {
    state.currentDraft.nsr = null;
    renderForm("nsr", null);
  });
  document.getElementById("new-endorsement").addEventListener("click", () => {
    state.currentDraft.endorsement = null;
    renderForm("endorsement", null);
  });
}

function initSettings() {
  document.getElementById("add-relay").addEventListener("click", addRelay);
  document.getElementById("clear-relays").addEventListener("click", clearRelays);
  document.getElementById("refresh-defaults").addEventListener("click", fetchDefaults);

  const modeSelect = document.getElementById("signer-mode");
  const nsecField = document.getElementById("nsec-field");
  modeSelect.addEventListener("change", () => {
    state.signerMode = modeSelect.value;
    nsecField.style.display = state.signerMode === "nsec" ? "grid" : "none";
  });
  nsecField.style.display = state.signerMode === "nsec" ? "grid" : "none";

  document.getElementById("save-signer").addEventListener("click", async () => {
    const mode = modeSelect.value;
    state.signerMode = mode;
    await setConfig("signer_mode", mode);
    if (mode === "nsec") {
      const nsec = document.getElementById("nsec-input").value.trim();
      if (!nsec) {
        showToast("Enter a valid nsec.", "error");
        return;
      }
      sessionStorage.setItem("ncc-manager-nsec", nsec);
    }
    updateSignerStatus();
    showToast("Signer updated.");
  });

  document.getElementById("clear-signer").addEventListener("click", async () => {
    sessionStorage.removeItem("ncc-manager-nsec");
    await setConfig("signer_mode", "nip07");
    state.signerMode = "nip07";
    modeSelect.value = "nip07";
    document.getElementById("nsec-input").value = "";
    updateSignerStatus();
    showToast("Signer cleared.");
  });

  document.getElementById("import-button").addEventListener("click", async () => {
    const fileInput = document.getElementById("import-file");
    if (fileInput.files?.length) {
      await importDraft(fileInput.files[0]);
      fileInput.value = "";
    }
  });

  document.getElementById("export-all").addEventListener("click", exportAllDrafts);

  const refreshButton = document.getElementById("refresh-endorsement-data");
  if (refreshButton) {
    refreshButton.addEventListener("click", refreshEndorsementHelpers);
  }
}

async function init() {
  initNav();
  initNewButtons();
  initSettings();
  renderQuickActions();
  await loadConfig();
  await fetchDefaults();
  await renderRelays();
  await initForms();
  await initLists();
  await renderDashboard();
  await refreshEndorsementHelpers();
}

init();
