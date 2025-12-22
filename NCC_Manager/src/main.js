import "./styles.css";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
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
  fetchNccDocuments,
  fetchProfile
} from "./nostr.js";

const KINDS = {
  ncc: 30050,
  nsr: 30051,
  endorsement: 30052
};

const FALLBACK_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://nostr.wine",
  "wss://relay.primal.net",
  "wss://nostr-01.yakihonne.com"
];

const state = {
  defaults: [],
  signerMode: "nip07",
  nccOptions: [],
  nccDocs: [],
  relayStatus: null,
  signerPubkey: null,
  signerProfile: null,
  selectedNcc: null,
  nccLocalDrafts: [],
  editDraft: null,
  currentDraft: {
    ncc: null,
    nsr: null,
    endorsement: null
  }
};

const NCC_CACHE_KEY_BASE = "ncc-manager-ncc-cache";
const NCC_CACHE_TTL_MS = 5 * 60 * 1000;
const hasLocalStorage = typeof window !== "undefined" && !!window.localStorage;

function buildRelayCacheKey(relays) {
  if (!relays || !relays.length) return `${NCC_CACHE_KEY_BASE}:default`;
  const sorted = [...relays].map((relay) => relay.trim()).sort();
  return `${NCC_CACHE_KEY_BASE}:${sorted.join("|")}`;
}

function readCachedNcc(key) {
  if (!hasLocalStorage) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.warn("Failed to read NCC cache", error);
    return null;
  }
}

function writeCachedNcc(key, events) {
  if (!hasLocalStorage) return;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        at: Date.now(),
        items: events || []
      })
    );
  } catch (error) {
    console.warn("Failed to write NCC cache", error);
  }
}

function formatCacheAge(timestamp) {
  if (!timestamp) return "just now";
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

const markdownOptions = {
  headerIds: false,
  mangle: false
};

const markdownSanitizeOptions = {
  allowedTags: [
    "a",
    "p",
    "br",
    "strong",
    "em",
    "ul",
    "ol",
    "li",
    "blockquote",
    "code",
    "pre",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr"
  ],
  allowedAttributes: {
    a: ["href", "name", "target", "rel"],
    code: ["class"]
  }
};

function renderMarkdown(content) {
  if (!content) return "";
  const raw = marked.parse(content, markdownOptions);
  return sanitizeHtml(raw, markdownSanitizeOptions);
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
function stripNccNumber(value) {
  if (!value) return "";
  const trimmed = String(value).trim().toLowerCase();
  const withoutPrefix = trimmed.replace(/^ncc-/, "");
  return withoutPrefix.replace(/\D/g, "");
}

function buildNccIdentifier(numberValue) {
  const digits = stripNccNumber(numberValue);
  if (!digits) return "";
  return `ncc-${digits}`;
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

async function refreshSignerProfile() {
  if (!state.signerPubkey) {
    state.signerProfile = null;
    return;
  }
  try {
    const relays = await getRelays();
    const targets = relays.length ? relays : FALLBACK_RELAYS;
    if (!targets.length) return;
    state.signerProfile = await fetchProfile(state.signerPubkey, targets);
  } catch (error) {
    console.error("NCC Manager: signer profile fetch failed", error);
    state.signerProfile = null;
  }
}

function hideSignerMenu() {
  const menu = document.getElementById("signer-menu");
  if (!menu) return;
  menu.classList.remove("visible");
  const button = document.getElementById("signer-status");
  if (button) button.setAttribute("aria-expanded", "false");
}

async function promptSignerConnection() {
  if (state.signerMode === "nip07") {
    if (!window.nostr) {
      showToast("Install a NIP-07 signer to sign in.", "error");
      return;
    }
    try {
      await window.nostr.getPublicKey();
    } catch (error) {
      showToast("Signer denied access.", "error");
      return;
    }
  } else {
    const nsecField = document.getElementById("nsec-input");
    const provided = nsecField?.value.trim();
    if (!provided) {
      showToast("Enter your local nsec before signing in.", "error");
      return;
    }
    sessionStorage.setItem("ncc-manager-nsec", provided);
  }
  await updateSignerStatus();
}

async function signOutSigner() {
  sessionStorage.removeItem("ncc-manager-nsec");
  await setConfig("signer_mode", "nip07");
  state.signerMode = "nip07";
  const modeSelect = document.getElementById("signer-mode");
  if (modeSelect) modeSelect.value = "nip07";
  const nsecField = document.getElementById("nsec-input");
  if (nsecField) nsecField.value = "";
  await updateSignerStatus();
  showToast("Signer cleared.");
  hideSignerMenu();
}

function renderSignerStatus() {
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

function setupSignerMenu() {
  const button = document.getElementById("signer-status");
  const menu = document.getElementById("signer-menu");
  if (!button || !menu) return;
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (!state.signerPubkey) {
      await promptSignerConnection();
      return;
    }
    const isVisible = menu.classList.toggle("visible");
    button.setAttribute("aria-expanded", isVisible.toString());
  });
  document.addEventListener("click", (event) => {
    if (!menu.classList.contains("visible")) return;
    if (menu.contains(event.target) || button.contains(event.target)) return;
    hideSignerMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideSignerMenu();
    }
  });
  const signoutButton = document.getElementById("signer-menu-signout");
  if (signoutButton) {
    signoutButton.addEventListener("click", async (event) => {
      event.preventDefault();
      await signOutSigner();
    });
  }
}

async function fetchDefaults() {
  try {
    const res = await fetch("/api/defaults");
    const data = await res.json();
    state.defaults = data.relays || [];
    await setConfig("default_relays", state.defaults);
    renderRelays();
  } catch (error) {
    state.defaults = FALLBACK_RELAYS;
    await setConfig("default_relays", state.defaults);
    renderRelays();
    showToast("Using fallback default relays (server unavailable).", "error");
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
  const helpEl = document.getElementById("signer-help");
  const mode = state.signerMode;
  const nsec = sessionStorage.getItem("ncc-manager-nsec");
  try {
    const signer = await getSigner(mode, nsec);
    state.signerPubkey = signer.pubkey;
    if (helpEl) {
      helpEl.textContent =
        mode === "nip07"
          ? "Using your browser signer. Keys stay in your extension."
          : "Using a session-only nsec. It is never saved to disk.";
    }
    await refreshSignerProfile();
  } catch (error) {
    state.signerPubkey = null;
    state.signerProfile = null;
    if (helpEl) {
      helpEl.textContent =
        mode === "nip07"
          ? "Install a NIP-07 signer (e.g. Alby) to sign events."
          : "Enter a valid nsec to enable local signing.";
    }
  }
  renderSignerStatus();
  renderNsrHelpers();
}

function switchView(view) {
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", section.dataset.view === view);
  });
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  if (view === "dashboard") {
    renderDashboard();
  }
}

async function renderDashboard() {
  const listEl = document.getElementById("recent-nccs");
  const localDrafts = await listDrafts(KINDS.ncc);
  const relayDocs = state.nccDocs || [];

  const localMap = new Map(localDrafts.map((draft) => [draft.event_id || draft.id, draft]));
  const combined = [];

  for (const draft of localDrafts) {
    combined.push({
      id: draft.id,
      d: draft.d,
      title: draft.title || "Untitled",
      status: draft.status || "draft",
      published_at: draft.status === "published" ? draft.published_at : null,
      event_id: draft.event_id || "",
      source: "local",
      content: draft.content || "",
      tags: draft.tags || {},
      updated_at: draft.updated_at || 0
    });
  }

  for (const event of relayDocs) {
    if (localMap.has(event.id)) continue;
    const publishedAtRaw = eventTagValue(event.tags, "published_at");
    const publishedAt = publishedAtRaw && String(publishedAtRaw).match(/^\d+$/) ? Number(publishedAtRaw) : null;
    combined.push({
      id: event.id,
      d: eventTagValue(event.tags, "d"),
      title: eventTagValue(event.tags, "title") || "Untitled",
      status: publishedAt ? "published" : "proposal",
      published_at: publishedAt,
      event_id: event.id,
      source: "relay",
      content: event.content || "",
      tags: event.tags || [],
      updated_at: (event.created_at || 0) * 1000
    });
  }

  const sorted = combined
    .filter((item) => item.d)
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
    .slice(0, 12);

  if (!sorted.length) {
    listEl.innerHTML = `<div class="card">No NCCs available yet.</div>`;
    return;
  }

  listEl.innerHTML = sorted
    .map(
      (item) => `
        <div class="card">
          <strong>${esc(item.d)} · ${esc(item.title)}</strong>
          <div class="meta">
            <span>Status: ${esc(item.status)}</span>
            <span>Published: ${item.published_at ? new Date(item.published_at * 1000).toLocaleString() : "-"}</span>
            <span>Event: ${item.event_id ? item.event_id.slice(0, 10) + "…" : "-"}</span>
          </div>
          <div class="actions">
            <button class="ghost" data-action="view" data-id="${item.id}">View</button>
            ${
              item.source === "local" && item.status !== "published"
                ? `<button class="primary" data-action="publish" data-id="${item.id}" data-kind="ncc">Publish</button>`
                : ""
            }
          </div>
        </div>
      `
    )
    .join("");

  listEl.querySelectorAll("button[data-action=\"view\"]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = sorted.find((item) => item.id === button.dataset.id);
      if (!target) return;
      openNccView(target, localDrafts);
    });
  });

  listEl.querySelectorAll("button[data-action=\"publish\"]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetId = button.dataset.id;
      const kind = button.dataset.kind || "ncc";
      const targetDraft = localDrafts.find((draft) => draft.id === targetId);
      if (!targetDraft) return;
      button.disabled = true;
      await publishDraft(targetDraft, kind);
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
    const publishedValue = draft?.published_at ? draft.published_at : nowSeconds();
    form.innerHTML = `
      <label class="field"><span>NCC number</span><input name="d" required inputmode="numeric" pattern="\\d+" placeholder="00" value="${esc(stripNccNumber(draft?.d))}" /></label>
      <p class="muted small">The <code>ncc-</code> prefix is added automatically.</p>
      <label class="field"><span>Title</span><input name="title" required value="${esc(draft?.title)}" /></label>
      <label class="field"><span>Content (Markdown)</span><textarea name="content">${esc(draft?.content)}</textarea></label>
      <label class="field"><span>Summary</span><input name="summary" value="${esc(draft?.tags?.summary)}" /></label>
      <label class="field"><span>Topics (comma)</span><input name="topics" value="${esc((draft?.tags?.topics || []).join(", "))}" /></label>
      <label class="field"><span>Language (BCP-47)</span><input name="lang" value="${esc(draft?.tags?.lang)}" /></label>
      <label class="field"><span>Version</span><input name="version" value="${esc(draft?.tags?.version)}" /></label>
      <label class="field"><span>Supersedes (comma)</span><input name="supersedes" value="${esc((draft?.tags?.supersedes || []).join(", "))}" /></label>
      <label class="field"><span>License</span><input name="license" value="${esc(draft?.tags?.license)}" /></label>
      <label class="field"><span>Authors (comma)</span><input name="authors" value="${esc((draft?.tags?.authors || []).join(", "))}" /></label>
      <label class="field"><span>Published at (unix seconds)</span><input name="published_at" value="${esc(publishedValue)}" /></label>
      <button class="primary" type="submit">${isEdit ? "Save" : "Create"}</button>
    `;
  }

  if (kind === "nsr") {
    form.innerHTML = `
      <label class="field"><span>NCC number</span><input name="d" required inputmode="numeric" pattern="\\d+" placeholder="00" value="${esc(stripNccNumber(draft?.d))}" /></label>
      <p class="muted small">The <code>ncc-</code> prefix is added automatically.</p>
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
      <label class="field"><span>NCC number</span><input name="d" required inputmode="numeric" pattern="\\d+" placeholder="00" value="${esc(stripNccNumber(draft?.d))}" /></label>
      <p class="muted small">The <code>ncc-</code> prefix is added automatically.</p>
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

function buildTagsMapFromEvent(tags) {
  const map = {};
  (tags || []).forEach((tag) => {
    const key = tag[0];
    if (!key) return;
    map[key] = map[key] || [];
    map[key].push(tag[1]);
  });
  return map;
}

function toDraftFromRelay(item) {
  const tagMap = buildTagsMapFromEvent(item.tags || []);
  return {
    id: crypto.randomUUID(),
    kind: KINDS.ncc,
    status: "draft",
    d: item.d,
    title: item.title,
    content: item.content || "",
    published_at: null,
    tags: {
      summary: tagMap.summary?.[0] || "",
      topics: tagMap.t || [],
      lang: tagMap.lang?.[0] || "",
      version: tagMap.version?.[0] || "",
      supersedes: item.event_id ? [`event:${item.event_id}`] : [],
      license: tagMap.license?.[0] || "",
      authors: tagMap.authors || []
    }
  };
}

function openNccView(item, localDrafts) {
  state.selectedNcc = item;
  state.nccLocalDrafts = localDrafts || [];
  state.editDraft = null;
  const titleEl = document.getElementById("ncc-view-title");
  const metaEl = document.getElementById("ncc-view-meta");
  const statsEl = document.getElementById("ncc-view-stats");
  const contentEl = document.getElementById("ncc-view-content");
  const titleEditWrap = document.getElementById("ncc-view-title-edit");
  const contentEditWrap = document.getElementById("ncc-view-content-edit");
  const editPanel = document.getElementById("ncc-edit-panel");

  titleEl.textContent = `${item.d.toUpperCase()} · ${item.title}`;
  metaEl.textContent = item.event_id ? `Event ${item.event_id}` : "Draft (not published)";
  statsEl.innerHTML = `
    <span>Status: ${esc(item.status)}</span>
    <span>Published: ${item.published_at ? new Date(item.published_at * 1000).toLocaleString() : "-"}</span>
    <span>Source: ${item.source}</span>
  `;
  contentEl.innerHTML = renderMarkdown(item.content || "No content available.");
  contentEl.hidden = false;
  titleEditWrap.hidden = true;
  contentEditWrap.hidden = true;
  editPanel.hidden = true;
  editPanel.classList.remove("collapsed");
  setNccViewActions(item, localDrafts);

  switchView("ncc-view");
}

function createRevisionDraft(item, localDrafts) {
  let draft;
  if (item.source === "relay") {
    draft = toDraftFromRelay(item);
  } else {
    const base = localDrafts.find((d) => d.id === item.id);
    if (!base) return null;
    draft = {
      ...base,
      id: crypto.randomUUID(),
      status: "draft",
      event_id: "",
      published_at: null,
      tags: {
        ...base.tags,
        supersedes: Array.from(new Set([...(base.tags?.supersedes || []), `event:${item.event_id}`]))
      }
    };
  }
  return draft;
}

function setNccViewActions(item, localDrafts) {
  const editButton = document.getElementById("ncc-view-edit");
  const reviseButton = document.getElementById("ncc-view-revise");
  const localDraft = (localDrafts || []).find((draft) => draft.id === item.id);
  const isDraft = item.status !== "published";
  editButton.style.display = isDraft ? "inline-flex" : "none";
  editButton.textContent = "Edit draft";
  editButton.setAttribute("aria-label", "Edit draft");
  reviseButton.style.display = isDraft ? "none" : "inline-flex";

  editButton.disabled = !localDraft || localDraft.status === "published";
  editButton.onclick = async () => {
    if (!localDraft || localDraft.status === "published") return;
    showEditMode(localDraft);
  };

  reviseButton.disabled = item.status !== "published";
  reviseButton.onclick = async () => {
    if (item.status !== "published") return;
    const draft = createRevisionDraft(item, localDrafts || []);
    if (!draft) return;
    showEditMode(draft);
  };
}

function showEditMode(draft) {
  state.editDraft = draft;
  const editPanel = document.getElementById("ncc-edit-panel");
  const toggle = document.getElementById("ncc-edit-toggle");
  const titleEditWrap = document.getElementById("ncc-view-title-edit");
  const contentEditWrap = document.getElementById("ncc-view-content-edit");
  const titleInput = document.getElementById("ncc-title-input");
  const contentInput = document.getElementById("ncc-content-input");
  const contentEl = document.getElementById("ncc-view-content");
  const editButton = document.getElementById("ncc-view-edit");
  const reviseButton = document.getElementById("ncc-view-revise");

  editPanel.hidden = false;
  editPanel.classList.remove("collapsed");
  if (toggle) {
    toggle.textContent = "▴";
    toggle.setAttribute("aria-label", "Collapse edit fields");
  }
  titleEditWrap.hidden = false;
  contentEditWrap.hidden = false;
  contentEl.hidden = true;
  titleInput.value = draft.title || "";
  contentInput.value = draft.content || "";

  const form = document.getElementById("ncc-edit-form");
  form.summary.value = draft.tags?.summary || "";
  form.topics.value = (draft.tags?.topics || []).join(", ");
  form.lang.value = draft.tags?.lang || "";
  form.version.value = draft.tags?.version || "";
  form.supersedes.value = (draft.tags?.supersedes || []).join(", ");
  form.license.value = draft.tags?.license || "";
  form.authors.value = (draft.tags?.authors || []).join(", ");
  form.published_at.value = draft.published_at || "";
  form.d.value = stripNccNumber(draft.d);

  if (editButton) {
    editButton.style.display = "none";
  }
  if (reviseButton) reviseButton.style.display = "none";
}

function hideEditMode() {
  state.editDraft = null;
  const editPanel = document.getElementById("ncc-edit-panel");
  const contentEl = document.getElementById("ncc-view-content");
  const titleEditWrap = document.getElementById("ncc-view-title-edit");
  const contentEditWrap = document.getElementById("ncc-view-content-edit");
  const toggle = document.getElementById("ncc-edit-toggle");
  editPanel.hidden = true;
  editPanel.classList.remove("collapsed");
  if (toggle) {
    toggle.textContent = "▴";
    toggle.setAttribute("aria-label", "Collapse edit fields");
  }
  titleEditWrap.hidden = true;
  contentEditWrap.hidden = true;
  contentEl.hidden = false;
  if (state.selectedNcc) {
    setNccViewActions(state.selectedNcc, state.nccLocalDrafts);
  }
}

function toggleEditPanel() {
  const editPanel = document.getElementById("ncc-edit-panel");
  const toggle = document.getElementById("ncc-edit-toggle");
  if (!editPanel || !toggle) return;
  const isCollapsed = editPanel.classList.toggle("collapsed");
  toggle.textContent = isCollapsed ? "▾" : "▴";
  toggle.setAttribute("aria-label", isCollapsed ? "Expand edit fields" : "Collapse edit fields");
}

function openNewNcc() {
  const draft = {
    id: crypto.randomUUID(),
    kind: KINDS.ncc,
    status: "draft",
    d: "",
    title: "",
    content: "",
    published_at: nowSeconds(),
    event_id: "",
    source: "local",
    tags: {
      summary: "",
      topics: [],
      lang: "",
      version: "",
      supersedes: [],
      license: "",
      authors: []
    }
  };
  openNccView(
    {
      ...draft,
      d: "ncc-xx",
      title: "New NCC",
      status: "draft",
      source: "local"
    },
    [draft]
  );
  showEditMode(draft);
}
async function saveEditDraft() {
  if (!state.editDraft) return;
  const form = document.getElementById("ncc-edit-form");
  const titleInput = document.getElementById("ncc-title-input");
  const contentInput = document.getElementById("ncc-content-input");
  const nccNumber = stripNccNumber(form.d.value);
  if (!nccNumber) {
    showToast("NCC number is required.", "error");
    return;
  }
  const supersedesList = splitList(form.supersedes.value);
  const localDrafts = await listDrafts(KINDS.ncc);
  const relayDocs = state.nccDocs || [];
  const normalizedId = buildNccIdentifier(nccNumber);
  const hasConflictLocal = localDrafts.some((draft) => draft.id !== state.editDraft.id && draft.d === normalizedId);
  const hasConflictRelay = relayDocs.some((event) => eventTagValue(event.tags, "d") === normalizedId);
  if ((hasConflictLocal || hasConflictRelay) && supersedesList.length === 0) {
    showToast("NCC number already exists. Add a supersedes event to revise.", "error");
    return;
  }
  const draft = {
    ...state.editDraft,
    d: normalizedId,
    title: titleInput.value.trim(),
    content: contentInput.value.trim(),
    tags: {
      summary: form.summary.value.trim(),
      topics: splitList(form.topics.value),
      lang: form.lang.value.trim(),
      version: form.version.value.trim(),
      supersedes: supersedesList,
      license: form.license.value.trim(),
      authors: splitList(form.authors.value)
    },
    published_at: form.published_at.value ? Number(form.published_at.value) : null
  };
  await saveDraft(draft);
  showToast("Draft saved.");
  hideEditMode();
  await renderDashboard();
  state.currentDraft.ncc = draft;
  openNccView(
    {
      ...state.selectedNcc,
      title: draft.title,
      content: draft.content,
      status: draft.status,
      published_at: draft.published_at,
      source: "local"
    },
    await listDrafts(KINDS.ncc)
  );
}

function eventTagValue(tags, name) {
  if (!Array.isArray(tags)) return "";
  const found = tags.find((tag) => tag[0] === name);
  return found ? found[1] : "";
}

function isNccDocument(event) {
  const dValue = eventTagValue(event.tags, "d");
  return dValue && dValue.toLowerCase().startsWith("ncc-");
}

function buildNccOptions(events) {
  const grouped = {};
  for (const event of events) {
    const dValue = eventTagValue(event.tags, "d");
    if (!dValue || !dValue.toLowerCase().startsWith("ncc-")) continue;
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
    if (dInput) dInput.value = stripNccNumber(selectedD);
    if (endorsesInput) endorsesInput.value = eventSelect.value;
  };
}

function renderNsrHelpers() {
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

  const ownedEvents = (state.nccDocs || []).filter((event) => (event.pubkey || "").toLowerCase() === signerKey);
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
        const label = event.title ? `${event.title} · ${event.id.slice(0, 8)}…` : event.id.slice(0, 16) + "…";
        return `<option value="${event.id}">${label}</option>`;
      })
      .join("");
    helper.textContent = "Select the event that is authoritative for this NSR.";
  };

  eventSelect.onchange = () => {
    const selectedEvent = eventMap.get(eventSelect.value);
    const form = document.getElementById("nsr-form");
    if (!form) return;
    const dInput = form.querySelector("input[name=\"d\"]");
    const authoritativeInput = form.querySelector("input[name=\"authoritative\"]");
    const stewardInput = form.querySelector("input[name=\"steward\"]");
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

function isOnline() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

async function refreshEndorsementHelpers(forceRefresh = false) {
  const helper = document.getElementById("endorse-helper-text");
  if (helper) helper.textContent = "Loading NCC documents from relays...";
  try {
    const relays = await getRelays();
    if (!relays.length) {
      if (helper) helper.textContent = "No relays configured. Add relays in Settings.";
      return;
    }
    const cacheKey = buildRelayCacheKey(relays);
    const cached = readCachedNcc(cacheKey);
    const cacheFresh = cached && Date.now() - cached.at < NCC_CACHE_TTL_MS;
    let events = [];
    let usedCache = false;

    if ((cacheFresh && !forceRefresh) || !isOnline()) {
      events = cached?.items || [];
      usedCache = true;
      if (!events.length && !isOnline()) {
        if (helper) helper.textContent = "Offline and no cached NCC documents available.";
        return;
      }
    }

    if (!events.length) {
      try {
        const fetched = await fetchNccDocuments(relays);
        events = fetched;
        writeCachedNcc(cacheKey, events);
      } catch (error) {
        if (cached?.items?.length) {
          events = cached.items;
          usedCache = true;
          if (helper) helper.textContent = "Using cached NCC documents (offline fallback).";
        } else {
          throw error;
        }
      }
    }

    const filtered = events.filter((event) => isNccDocument(event));
    state.nccOptions = buildNccOptions(filtered);
    state.nccDocs = filtered;
    state.relayStatus = {
      relays: relays.length,
      events: filtered.length,
      fromCache: usedCache,
      at: Date.now()
    };
    renderEndorsementHelpers();
    renderNsrHelpers();
    renderDashboard();
    if (helper) {
      if (usedCache && cached?.at) {
        helper.textContent = `Loaded ${filtered.length} cached NCC documents (updated ${formatCacheAge(
          cached.at
        )}).`;
      } else {
        helper.textContent = `Loaded ${filtered.length} NCC documents from ${relays.length} relays.`;
      }
    }
    console.info(
      `NCC Manager: fetched ${filtered.length}/${events.length} NCC documents from ${relays.length} relays.`
    );
  } catch (error) {
    if (helper) helper.textContent = "Failed to load NCC documents from relays.";
    console.error("NCC Manager: relay fetch failed", error);
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
    d: buildNccIdentifier(formData.get("d")),
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
  if (!listEl) return;
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
    showToast(
      `Published to ${result.accepted}/${result.total} relays (took ${result.attempts} attempt${
        result.attempts === 1 ? "" : "s"
      }).`
    );
  } catch (error) {
    showToast(`Publish failed: ${error.message}`, "error");
  }
}

function validateDraft(draft, kind) {
  if (!draft.d) return "NCC number is required.";
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
  await renderDrafts("nsr");
  await renderDrafts("endorsement");

  document.getElementById("nsr-list").addEventListener("click", (event) => handleListAction("nsr", event));
  document
    .getElementById("endorsement-list")
    .addEventListener("click", (event) => handleListAction("endorsement", event));
}

function initNav() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    if (!button.dataset.view) return;
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  const newNccButton = document.getElementById("nav-new-ncc");
  if (newNccButton) {
    newNccButton.addEventListener("click", () => {
      openNewNcc();
    });
  }
}

function initNewButtons() {
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
    refreshButton.addEventListener("click", () => refreshEndorsementHelpers(true));
  }
}

async function init() {
  initNav();
  initNewButtons();
  initSettings();
  setupSignerMenu();
  await loadConfig();
  await fetchDefaults();
  await renderRelays();
  await initForms();
  await initLists();
  await renderDashboard();
  await refreshEndorsementHelpers();

  document.getElementById("ncc-view-back").addEventListener("click", () => switchView("dashboard"));
  document.getElementById("ncc-edit-cancel").addEventListener("click", hideEditMode);
  document.getElementById("ncc-edit-save").addEventListener("click", saveEditDraft);
  document.getElementById("ncc-edit-toggle").addEventListener("click", toggleEditPanel);
}

init();

function setupConnectionListeners() {
  if (typeof window === "undefined") return;
  window.addEventListener("online", () => {
    showToast("Back online. Refreshing NCC documents.", "info");
    refreshEndorsementHelpers(true);
  });
  window.addEventListener("offline", () => {
    showToast("Offline mode: working from cached NCC data and drafts.", "warning");
  });
}

setupConnectionListeners();
