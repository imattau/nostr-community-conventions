import "./styles.css";
import { saveDraft, listDrafts, deleteDraft, getDraft, setConfig, getConfig } from "./store.js";
import {
  createEventTemplate,
  payloadToDraft,
  getSigner,
  publishEvent,
  verifyEvent,
  fetchNccDocuments,
  fetchEndorsements,
  fetchAuthorEndorsements,
  fetchProfile
} from "./nostr.js";

import {
  showToast,
  hideSignerMenu,
  renderSignerStatus,
  renderRelays,
  renderForm,
  renderDashboard,
  renderEndorsementDetailsPanel,
  renderEndorsementHelpers,
  renderNsrHelpers,
  renderDrafts
} from "./ui.js";

import {
  esc,
  shortenKey,
  formatCacheAge,
  renderMarkdown,
  splitList,
  uniq,
  nowSeconds,
  stripNccNumber,
  buildNccIdentifier,
  isNccIdentifier,
  eventTagValue,
  normalizeEventId,
  normalizeHexId,
  isNccDocument,
  buildNccOptions
} from "./utils.js";

import {
  state,
  updateState,
  KINDS,
  buildRelayCacheKey,
  readCachedNcc,
  writeCachedNcc
} from "./state.js";

const FALLBACK_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://nostr.wine",
  "wss://relay.primal.net",
  "wss://nostr-01.yakihonne.com"
];

const NCC_CACHE_TTL_MS = 5 * 60 * 1000;

async function refreshSignerProfile() {
  if (!state.signerPubkey) {
    updateState({ signerProfile: null });
    return;
  }
  try {
    const relays = await getRelays();
    const targets = relays.length ? relays : FALLBACK_RELAYS;
    if (!targets.length) return;
    updateState({ signerProfile: await fetchProfile(state.signerPubkey, targets) });
  } catch (error) {
    console.error("NCC Manager: signer profile fetch failed", error);
    updateState({ signerProfile: null });
  }
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
  updateState({ signerMode: "nip07" });
  const modeSelect = document.getElementById("signer-mode");
  if (modeSelect) modeSelect.value = "nip07";
  const nsecField = document.getElementById("nsec-input");
  if (nsecField) nsecField.value = "";
  await updateSignerStatus();
  showToast("Signer cleared.");
  hideSignerMenu();
}

async function updateSignerStatus() {
  const helpEl = document.getElementById("signer-help");
  const mode = state.signerMode;
  const nsec = sessionStorage.getItem("ncc-manager-nsec");
  try {
    const signer = await getSigner(mode, nsec);
    updateState({ signerPubkey: signer.pubkey });
    if (helpEl) {
      helpEl.textContent =
        mode === "nip07"
          ? "Using your browser signer. Keys stay in your extension."
          : "Using a session-only nsec. It is never saved to disk.";
    }
    await refreshSignerProfile();
  } catch (error) {
    updateState({ signerPubkey: null, signerProfile: null });
    if (helpEl) {
      helpEl.textContent =
        mode === "nip07"
          ? "Install a NIP-07 signer (e.g. Alby) to sign events."
          : "Enter a valid nsec to enable local signing.";
    }
  }
  renderSignerStatus(state);
  renderNsrHelpers(state);
  await renderDrafts(
    "endorsement",
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
  );
  await renderDashboard(
    state,
    listDrafts,
    openNccView,
    publishDraft,
    setupEndorsementCounterButtons,
    renderEndorsementDetailsPanel
  );
}

function switchView(view) {
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", section.dataset.view === view);
  });
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  if (view === "dashboard") {
    renderDashboard(
      state,
      listDrafts,
      openNccView,
      publishDraft,
      setupEndorsementCounterButtons,
      renderEndorsementDetailsPanel
    );
  }
}

async function fetchDefaults() {
  try {
    const res = await fetch("/api/defaults");
    const data = await res.json();
    updateState({ defaults: data.relays || [] });
    await setConfig("default_relays", state.defaults);
    renderRelays(state.defaults, await getConfig("user_relays", []), setConfig);
  } catch (error) {
    updateState({ defaults: FALLBACK_RELAYS });
    await setConfig("default_relays", state.defaults);
    renderRelays(state.defaults, await getConfig("user_relays", []), setConfig);
    showToast("Using fallback default relays (server unavailable).", "error");
  }
}

async function loadConfig() {
  const defaultRelays = (await getConfig("default_relays", [])) || [];
  const signerMode = (await getConfig("signer_mode", "nip07")) || "nip07";
  updateState({ defaults: defaultRelays, signerMode: signerMode });
  const modeSelect = document.getElementById("signer-mode");
  modeSelect.value = state.signerMode;
  updateSignerStatus();
}

// --- NCC View and Edit Functions ---
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
    d: buildNccIdentifier(eventTagValue(item.tags || [], "d")) || item.d || "",
    title: eventTagValue(item.tags || [], "title") || item.title || "",
    content: item.content || "",
    published_at:
      Number(eventTagValue(item.tags || [], "published_at")) || item.created_at || nowSeconds(),
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
  updateState({ selectedNcc: item, nccLocalDrafts: localDrafts || [], editDraft: null });
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

function buildRevisionSupersedes(tags, eventId) {
  const list = tags?.supersedes ? [...tags.supersedes] : [];
  if (eventId) {
    const normalized = normalizeEventId(eventId);
    if (normalized) {
      const target = `event:${normalized}`;
      if (!list.includes(target)) list.push(target);
    }
  }
  return list;
}

function createRevisionDraft(item, localDrafts) {
  const eventId = item.event_id || item.id;
  const relaySource =
    item.raw_event ||
    state.nccDocs?.find((doc) => normalizeHexId(doc.id) === normalizeHexId(eventId));
  if (relaySource) {
    const base = toDraftFromRelay(relaySource);
    return {
      ...base,
      id: crypto.randomUUID(),
      status: "draft",
      event_id: "",
      published_at: null,
      tags: {
        ...base.tags,
        supersedes: buildRevisionSupersedes(base.tags, eventId)
      },
      source: "local"
    };
  }

  const baseDraft = (localDrafts || []).find((d) => d.id === item.id);
  if (!baseDraft) return null;
  return {
    ...baseDraft,
    id: crypto.randomUUID(),
    status: "draft",
    event_id: "",
    published_at: null,
    tags: {
      ...baseDraft.tags,
      supersedes: buildRevisionSupersedes(baseDraft.tags, eventId)
    }
  };
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
  updateState({ editDraft: draft });
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
  updateState({ editDraft: null });
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
  const hasConflictLocal = localDrafts.some(
    (draft) => draft.id !== state.editDraft.id && draft.d === normalizedId
  );
  const hasConflictRelay = relayDocs.some(
    (event) => eventTagValue(event.tags, "d") === normalizedId
  );
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
  await renderDashboard(
    state,
    listDrafts,
    openNccView,
    publishDraft,
    setupEndorsementCounterButtons,
    renderEndorsementDetailsPanel
  );
  updateState({ currentDraft: { ...state.currentDraft, ncc: draft } });
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

// --- Draft Handling and Publishing ---

function buildEndorsementSummary(event) {
  const roles = [];
  const topics = [];
  let implementation = "";
  let note = "";
  (event.tags || []).forEach((tag) => {
    if (!tag[0]) return;
    if (tag[0] === "role") roles.push(tag[1]);
    if (tag[0] === "t") topics.push(tag[1]);
    if (tag[0] === "implementation" && !implementation) implementation = tag[1];
    if (tag[0] === "note" && !note) note = tag[1];
  });
  return {
    id: event.id,
    author: event.pubkey || "",
    pubkey: event.pubkey || "",
    created_at: event.created_at || 0,
    d: eventTagValue(event.tags, "d") || "",
    roles,
    topics,
    implementation,
    note
  };
}

function buildDraftTagList(draft) {
  if (!draft) return [];
  if (Array.isArray(draft.raw_tags) && draft.raw_tags.length) return draft.raw_tags;
  if (Array.isArray(draft.raw_event?.tags) && draft.raw_event.tags.length) {
    return draft.raw_event.tags;
  }
  const tags = [];
  const push = (key, value) => {
    if (!value) return;
    tags.push([key, value]);
  };
  if (draft.tags) {
    push("endorses", draft.tags.endorses);
    (draft.tags.roles || []).forEach((role) => push("role", role));
    (draft.tags.topics || []).forEach((topic) => push("t", topic));
    push("implementation", draft.tags.implementation);
    push("note", draft.tags.note);
  }
  return tags;
}

function buildEventFromDraft(draft) {
  const createdAt =
    draft.published_at || Math.floor((draft.updated_at || Date.now()) / 1000) || nowSeconds();
  return {
    id: draft.event_id || draft.id,
    tags: buildDraftTagList(draft),
    pubkey: draft.author_pubkey || draft.raw_event?.pubkey || "",
    author: draft.author_pubkey || draft.raw_event?.pubkey || "",
    created_at: createdAt,
    content: draft.content || "",
    status: draft.status || ""
  };
}

async function refreshStoredEndorsementMetadata() {
  try {
    const drafts = await listDrafts(KINDS.endorsement);
    const counts = new Map();
    const details = new Map();
    const seen = new Set();

    for (const draft of drafts) {
      if (!draft) continue;
      const status = String(draft.status || "").toLowerCase();
      if (status !== "published") continue;
      const eventId = normalizeHexId(draft.event_id || draft.id);
      if (!eventId || seen.has(eventId)) continue;
      seen.add(eventId);
      const event = buildEventFromDraft(draft);
      const targets = getEndorsementTargets(event);
      if (!targets.size) continue;
      const summary = buildEndorsementSummary(event);
      for (const target of targets) {
        counts.set(target, (counts.get(target) || 0) + 1);
        const bucket = details.get(target) || [];
        bucket.push(summary);
        details.set(target, bucket);
      }
    }

    details.forEach((list) => list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0)));

    updateState({ endorsementCounts: counts, endorsementDetails: details });
  } catch (error) {
    console.error("NCC Manager: failed to refresh endorsement metadata", error);
  }
}

async function persistRelayEvents(events) {
  if (!events?.length) return;
  const tasks = [];
  for (const event of events) {
    if (!event?.id) continue;
    if (state.persistedRelayEvents.has(event.id)) continue;
    state.persistedRelayEvents.add(event.id);
    const draft = payloadToDraft(event);
    draft.status = "published";
    draft.source = "relay";
    draft.event_id = event.id;
    const timestamp = event.created_at || nowSeconds();
    draft.updated_at = timestamp * 1000;
    draft.created_at = timestamp * 1000;
    draft.published_at = timestamp;
    draft.id = event.id;
    draft.raw_tags = event.tags || [];
    draft.raw_event = event;
    tasks.push(saveDraft(draft));
  }
  if (!tasks.length) return;
  await Promise.allSettled(tasks);
}

function getEndorsementTargets(event) {
  const targets = new Set();
  const leads = eventTagValue(event.tags, "endorses");
  if (leads) {
    targets.add(normalizeEventId(leads));
  }
  (event.tags || [])
    .filter((tag) => tag[0] === "e")
    .forEach((tag) => targets.add(normalizeEventId(tag[1])));
  return targets;
}

function isOnline() {
  if (typeof window === "undefined") return true;
  return navigator.onLine;
}

async function getRelays() {
  const custom = (await getConfig("user_relays", [])) || [];
  return uniq([...state.defaults, ...custom]);
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
    await persistRelayEvents(filtered);
    const eventIds = filtered.map((event) => normalizeHexId(event.id)).filter(Boolean);
    if (eventIds.length && isOnline()) {
      try {
        const endorsementEvents = await fetchEndorsements(relays, eventIds);
        await persistRelayEvents(endorsementEvents);
      } catch (error) {
        console.warn("NCC Manager: failed to fetch endorsement counts", error);
      }
    }
    await refreshStoredEndorsementMetadata();
    updateState({
      nccOptions: buildNccOptions(filtered),
      nccDocs: filtered,
      relayStatus: {
        relays: relays.length,
        events: filtered.length,
        fromCache: usedCache,
        at: Date.now()
      }
    });
    renderEndorsementHelpers(state);
    renderNsrHelpers(state);
    renderDashboard(
      state,
      listDrafts,
      openNccView,
      publishDraft,
      setupEndorsementCounterButtons,
      renderEndorsementDetailsPanel
    );
    renderEndorsementDetailsPanel(state);
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
    published_at: formData.get("published_at")
      ? Number(formData.get("published_at"))
      : base.published_at
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

  if (kind === "supporting") {
    draft.tags = {
      title: formData.get("title")?.trim() || "",
      for: formData.get("for")?.trim() || "",
      for_event: formData.get("for_event")?.trim() || "",
      type: formData.get("type")?.trim() || "",
      published_at: formData.get("published_at")?.trim() || nowSeconds(),
      lang: formData.get("lang")?.trim() || "",
      topics: splitList(formData.get("topics")),
      license: formData.get("license")?.trim() || "",
      authors: splitList(formData.get("authors"))
    };
  }

  await saveDraft(draft);
  updateState({ currentDraft: { ...state.currentDraft, [kind]: draft } });
  showToast(`${kind.toUpperCase()} draft saved.`);
  await renderDrafts(
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
  );
  renderDashboard(
    state,
    listDrafts,
    openNccView,
    publishDraft,
    setupEndorsementCounterButtons,
    renderEndorsementDetailsPanel
  );
}

async function handleListAction(kind, event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.action;
  const id = target.dataset.id;
  if (!action || !id) return;

  const renderedEntry = findRenderedDraft(kind, id);

  if (action === "delete") {
    const storedDraft = await getDraft(id);
    if (!storedDraft) {
      showToast("Only local drafts can be deleted.", "error");
      return;
    }
    await deleteDraft(id);
    showToast("Draft deleted.");
    await renderDrafts(
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
    );
    renderDashboard(
      state,
      listDrafts,
      openNccView,
      publishDraft,
      setupEndorsementCounterButtons,
      renderEndorsementDetailsPanel
    );
    return;
  }

  let draft = await getDraft(id);
  if (!draft && renderedEntry?.rawEvent) {
    draft = payloadToDraft(renderedEntry.rawEvent);
    draft.event_id =
      renderedEntry.event_id || renderedEntry.rawEvent.event_id || renderedEntry.rawEvent.id;
    draft.author_pubkey = renderedEntry.author || renderedEntry.rawEvent.pubkey || "";
    draft.status = renderedEntry.status || "published";
    draft.id = id;
  }
  if (!draft) return;

  if (action === "edit") {
    updateState({ currentDraft: { ...state.currentDraft, [kind]: draft } });
    renderForm(kind, draft, state, KINDS);
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
    await renderDrafts(
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
    );
    renderDashboard(
      state,
      listDrafts,
      openNccView,
      publishDraft,
      setupEndorsementCounterButtons,
      renderEndorsementDetailsPanel
    );
    return;
  }

  if (action === "export") {
    const payload = renderedEntry?.rawEvent
      ? { ...renderedEntry.rawEvent }
      : createEventTemplate(draft);
    payload.event_id = payload.event_id || draft.event_id || renderedEntry?.event_id || undefined;
    payload.author_pubkey =
      payload.author_pubkey || draft.author_pubkey || renderedEntry?.author || undefined;
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
      published_at: draft.published_at || nowSeconds(),
      raw_event: event,
      raw_tags: event.tags || []
    };
    await saveDraft(updated);
    updateState({ currentDraft: { ...state.currentDraft, [kind]: updated } });
    renderForm(kind, updated, state, KINDS);
    if (kind === "endorsement") {
      await refreshStoredEndorsementMetadata();
    }
    await renderDrafts(
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
    );
    renderDashboard(
      state,
      listDrafts,
      openNccView,
      publishDraft,
      setupEndorsementCounterButtons,
      renderEndorsementDetailsPanel
    );
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
  if (kind === "supporting") {
    if (!draft.tags?.for) return "Target NCC is required.";
    if (!isNccIdentifier(draft.tags?.for)) return "Target NCC must start with ncc-.";
    if (!draft.tags?.title) return "Title is required.";
    if (!draft.tags?.published_at) return "Published at timestamp is required.";
  }
  return "";
}

function findRenderedDraft(kind, id) {
  const list = state.renderedDrafts?.[kind] || [];
  return list.find((entry) => entry.id === id);
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

async function fetchEndorsementCounts() {
  try {
    const res = await fetch("/api/endorsements/counts");
    if (!res.ok) throw new Error("Server storage unavailable");
    const data = await res.json();
    return data.counts || {};
  } catch (error) {
    console.warn("Failed to fetch endorsement counts from server, returning empty object", error);
    return {};
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
    renderDrafts(
      kindFromValue(draft.kind),
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
    );
    renderDashboard(
      state,
      listDrafts,
      openNccView,
      publishDraft,
      setupEndorsementCounterButtons,
      renderEndorsementDetailsPanel
    );
  } catch (error) {
    showToast("Import failed.", "error");
  }
}

function setupSupportingPanelControls() {
  const panel = document.getElementById("supporting-panel");
  const toggle = document.getElementById("supporting-toggle");
  const saveButton = document.getElementById("supporting-save");
  const form = document.getElementById("supporting-form");
  if (!panel || !toggle || !saveButton || !form) return;

  toggle.addEventListener("click", () => {
    const isCollapsed = panel.classList.toggle("collapsed");
    toggle.textContent = isCollapsed ? "▾" : "▴";
    toggle.setAttribute(
      "aria-label",
      isCollapsed ? "Expand supporting document fields" : "Collapse supporting document fields"
    );
  });

  saveButton.addEventListener("click", () => {
    form.requestSubmit();
  });
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

function setupEndorsementCounterButtons() {
  const listEl = document.getElementById("recent-nccs");
  if (!listEl) return;
  listEl.querySelectorAll('button[data-action="show-endorsements"]').forEach((button) => {
    button.addEventListener("click", () => {
      updateState({
        selectedEndorsementTarget: button.dataset.target || "",
        selectedEndorsementLabel: button.dataset.label || ""
      });
      renderEndorsementDetailsPanel(state);
    });
  });
}

function setupEndorsementDetailsControls() {
  const panel = document.getElementById("endorsement-details-panel");
  if (!panel) return;
  panel.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.action === "close-endorsement-details") {
      updateState({ selectedEndorsementTarget: "", selectedEndorsementLabel: "" });
      renderEndorsementDetailsPanel(state);
    }
  });
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

async function initForms() {
  renderForm("ncc", null, state, KINDS);
  renderForm("nsr", null, state, KINDS);
  renderForm("endorsement", null, state, KINDS);
  renderForm("supporting", null, state, KINDS);

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
  document.getElementById("supporting-form").addEventListener("submit", (event) => {
    event.preventDefault();
    handleFormSubmit("supporting");
  });
}

async function initLists() {
  await renderDrafts(
    "nsr",
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
  );
  await renderDrafts(
    "endorsement",
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
  );
  await renderDrafts(
    "supporting",
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
  );

  document
    .getElementById("nsr-list")
    .addEventListener("click", (event) => handleListAction("nsr", event));
  document
    .getElementById("endorsement-list")
    .addEventListener("click", (event) => handleListAction("endorsement", event));
  document
    .getElementById("supporting-list")
    .addEventListener("click", (event) => handleListAction("supporting", event));
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
    updateState({ currentDraft: { ...state.currentDraft, nsr: null } });
    renderForm("nsr", null, state, KINDS);
  });
  document.getElementById("new-endorsement").addEventListener("click", () => {
    updateState({ currentDraft: { ...state.currentDraft, endorsement: null } });
    renderForm("endorsement", null, state, KINDS);
  });
  const newSupportingButton = document.getElementById("new-supporting");
  if (newSupportingButton) {
    newSupportingButton.addEventListener("click", () => {
      updateState({ currentDraft: { ...state.currentDraft, supporting: null } });
      renderForm("supporting", null, state, KINDS);
      switchView("supporting");
    });
  }
}

function initSettings() {
  document.getElementById("add-relay").addEventListener("click", async () => {
    const input = document.getElementById("relay-input");
    const value = input.value.trim();
    if (!value) return;
    const normalized = value.startsWith("ws") ? value : `wss://${value}`;
    const current = (await getConfig("user_relays", [])) || [];
    if (!current.includes(normalized)) {
      current.push(normalized);
      await setConfig("user_relays", current);
    }
    renderRelays(state.defaults, await getConfig("user_relays", []), setConfig);
  });
  document.getElementById("clear-relays").addEventListener("click", async () => {
    await setConfig("user_relays", []);
    renderRelays(state.defaults, await getConfig("user_relays", []), setConfig);
  });
  document.getElementById("refresh-defaults").addEventListener("click", fetchDefaults);

  const modeSelect = document.getElementById("signer-mode");
  const nsecField = document.getElementById("nsec-field");
  modeSelect.addEventListener("change", () => {
    updateState({ signerMode: modeSelect.value });
    nsecField.style.display = state.signerMode === "nsec" ? "grid" : "none";
  });
  nsecField.style.display = state.signerMode === "nsec" ? "grid" : "none";

  document.getElementById("save-signer").addEventListener("click", async () => {
    const mode = modeSelect.value;
    updateState({ signerMode: mode });
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
    updateState({ signerMode: "nip07" });
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
  setupSupportingPanelControls();
  setupEndorsementDetailsControls();
  await loadConfig();
  await fetchDefaults();
  renderRelays(state.defaults, await getConfig("user_relays", []), setConfig);
  await initForms();
  await initLists();
  await renderDashboard(
    state,
    listDrafts,
    openNccView,
    publishDraft,
    setupEndorsementCounterButtons,
    renderEndorsementDetailsPanel
  );
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
