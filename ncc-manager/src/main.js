import "./styles.css";
import {
  saveDraft,
  listDrafts,
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
  fetchEndorsements,
  fetchAuthorEndorsements,
  fetchProfile
} from "./nostr.js";
import pkg from "../package.json";

import {
  esc,
  shortenKey,
  formatCacheAge,
  renderMarkdown,
  splitList,
  nowSeconds,
  stripNccNumber,
  buildNccIdentifier,
  isNccIdentifier,
  eventTagValue,
  normalizeEventId,
  normalizeHexId,
  isNccDocument,
  buildNccOptions,
  buildDraftIdentifier,
  isDraftIdentifier,
  stripDraftPrefix,
  isOnline,
  showToast
} from "./utils.js";

import {
  state,
  updateState,
  KINDS,
  getRelays,
  buildRelayCacheKey,
  readCachedNcc,
  writeCachedNcc
} from "./state.js";

import { initPowerShell, focusItem } from "./power_ui.js";

const APP_VERSION = (() => {
  const version = pkg?.version || "0.0.0";
  return version.startsWith("v") ? version : `v${version}`;
})();

const FALLBACK_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://nostr.wine",
  "wss://relay.primal.net",
  "wss://nostr-01.yakihonne.com"
];

const NCC_CACHE_TTL_MS = 5 * 60 * 1000;

async function updateAllDrafts() {
  const [ncc, nsr, endorsement, supporting] = await Promise.all([
    listDrafts(KINDS.ncc),
    listDrafts(KINDS.nsr),
    listDrafts(KINDS.endorsement),
    listDrafts(KINDS.supporting)
  ]);
  
  updateState({ 
    nccLocalDrafts: ncc,
    nsrLocalDrafts: nsr,
    endorsementLocalDrafts: endorsement,
    supportingLocalDrafts: supporting
  });
}

async function initShell() {
  const power = document.getElementById("shell-power");
  
  if (!power) {
      console.error("Power shell container not found");
      return;
  }
  
  updateState({ uiMode: "power" });
  power.hidden = false;
  
  await updateAllDrafts();
  try {
    initPowerShell(
      state,
      {
        saveItem: handlePowerSave,
        publishDraft,
        withdrawDraft,
        deleteItem: handlePowerDelete,
        deleteItemSilent: handlePowerDeleteSilent,
        openNewNcc,
        createRevisionDraft,
        promptSigner: promptSignerConnection,
        signOut: signOutSigner,
        getConfig,
        setConfig,
        updateSignerConfig: handleUpdateSignerConfig,
        exportAll: handleExportAllDrafts
      },
      APP_VERSION
    );
  } catch (e) {
    console.error("Failed to init PowerShell:", e);
  }
}

async function handleUpdateSignerConfig(mode, nsec) {
    updateState({ signerMode: mode });
    await setConfig("signer_mode", mode);
    if (mode === "nsec") {
        if (!nsec) {
            showToast("nsec is required for local signing", "error");
            return;
        }
        sessionStorage.setItem("ncc-manager-nsec", nsec);
    } else {
        sessionStorage.removeItem("ncc-manager-nsec");
    }
    await updateSignerStatus();
    showToast("Signer configuration updated");
    refreshUI();
}

async function handleExportAllDrafts() {
    const drafts = await listDrafts();
    const payloads = drafts.map((draft) => {
      const payload = createEventTemplate(draft);
      payload.event_id = draft.event_id || undefined;
      payload.author_pubkey = draft.author_pubkey || undefined;
      return payload;
    });
    
    const blob = new Blob([JSON.stringify(payloads, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "ncc-drafts.json";
    link.click();
    URL.revokeObjectURL(link.href);
}

async function handlePowerDelete(id) {
    if (!confirm("Are you sure you want to delete this local draft?")) return;
    await deleteDraft(id);
    await updateAllDrafts();
    refreshUI();
    showToast("Draft deleted.");
}

async function handlePowerDeleteSilent(id) {
    await deleteDraft(id);
    await updateAllDrafts();
    refreshUI();
}

async function handlePowerSave(id, content, fullDraft = null) {
  let item = fullDraft;
  
  if (!item) {
    const allLocal = [
      ...(state.nccLocalDrafts || []),
      ...(state.nsrLocalDrafts || []),
      ...(state.endorsementLocalDrafts || []),
      ...(state.supportingLocalDrafts || [])
    ];
    item = allLocal.find(d => d.id === id);
    
    if (!item) {
      const relayItem = (state.nccDocs || []).find(d => d.id === id);
      if (relayItem) {
        item = toDraftFromRelay(relayItem);
        item.id = id; 
      }
    }
  }
  
  if (!item) {
    showToast("Item not found to save.", "error");
    return;
  }
  
  item.content = content;
  item.updated_at = Date.now();
  
  // Save local draft
  await saveDraft(item);
  
  // Auto-broadcast if signed in
  if (state.signerPubkey && item.status === "draft") {
    try {
      const broadcast = await broadcastDraftToRelays(item);
      if (broadcast) {
        // We broadcast for backup purposes, but we DO NOT update item.event_id here.
        // The event_id property is reserved for the 'live' published ID.
        // This prevents the draft from constantly changing its ID in the UI.
        await saveDraft(item);
      }
    } catch (e) {
      console.warn("Auto-push failed during power save", e);
    }
  }
  
  await updateAllDrafts();
  refreshUI();
  
  // Return the updated item so caller can update their reference
  return item;
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
    // If in nsec mode but no nsec provided yet, open settings
    const nsec = sessionStorage.getItem("ncc-manager-nsec");
    if (!nsec) {
        showToast("Enter your nsec in Settings to sign in.", "info");
        // We could trigger settings modal here if we had a clean way, 
        // but for now just inform the user.
        return;
    }
  }
  await updateSignerStatus();
}

async function signOutSigner() {
  sessionStorage.removeItem("ncc-manager-nsec");
  await setConfig("signer_mode", "nip07");
  // Explicitly clear signer state and prevent immediate re-probing
  updateState({ 
      signerPubkey: null, 
      signerProfile: null, 
      signerMode: "nip07" 
  });
  
  await updateAllDrafts();
  showToast("Signer cleared.");
  refreshUI();
}

async function refreshSignerProfile() {
  if (!state.signerPubkey) {
    updateState({ signerProfile: null });
    return;
  }
  try {
    const relays = await getRelays(getConfig);
    const targets = relays.length ? relays : FALLBACK_RELAYS;
    if (!targets.length) return;
    updateState({ signerProfile: await fetchProfile(state.signerPubkey, targets) });
  } catch (error) {
    console.error("NCC Manager: signer profile fetch failed", error);
    updateState({ signerProfile: null });
  }
}

async function updateSignerStatus() {
  const nsec = sessionStorage.getItem("ncc-manager-nsec");
  try {
    const signer = await getSigner(state.signerMode, nsec);
    updateState({ signerPubkey: signer.pubkey });
    await refreshSignerProfile();
  } catch (error) {
    updateState({ signerPubkey: null, signerProfile: null });
  }
  
  await updateAllDrafts();
  refreshUI();
}

async function fetchDefaults() {
  try {
    const res = await fetch("/api/defaults");
    const data = await res.json();
    updateState({ defaults: data.relays || [] });
    await setConfig("default_relays", state.defaults);
  } catch (error) {
    updateState({ defaults: FALLBACK_RELAYS });
    await setConfig("default_relays", state.defaults);
    showToast("Using fallback default relays (server unavailable).", "error");
  }
}

async function loadConfig() {
  const defaultRelays = (await getConfig("default_relays", [])) || [];
  const signerMode = (await getConfig("signer_mode", "nip07")) || "nip07";
  
  updateState({ defaults: defaultRelays, signerMode: signerMode });
  
  await initShell();
  await updateSignerStatus();
}

function toDraftFromRelay(item) {
  const tagMap = {};
  (item.tags || []).forEach((tag) => {
    const key = tag[0];
    if (!key) return;
    tagMap[key] = tagMap[key] || [];
    tagMap[key].push(tag[1]);
  });

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
      supersedes: tagMap.supersedes || [],
      license: tagMap.license?.[0] || "",
      authors: tagMap.authors || [],
      // For Kind 30052/30053
      endorses: tagMap.endorses?.[0] || "",
      for: tagMap.for?.[0] || "",
      for_event: tagMap.for_event?.[0] || "",
      type: tagMap.type?.[0] || ""
    }
  };
}

function buildRevisionSupersedes(tags, eventId) {
  const list = tags?.supersedes ? [...tags.supersedes] : [];
  if (eventId) {
    const normalized = normalizeEventId(eventId);
    if (normalized) {
      const target = normalized; // No prefix for supersedes
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

async function openNewNcc() {
  if (!state.signerPubkey) {
    showToast("You must be signed in to create an NCC.", "error");
    return;
  }
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
  
  try {
    await saveDraft(draft);
    await updateAllDrafts();
    refreshUI();
    focusItem(draft.id, true);
  } catch (error) {
    console.error("Failed to create new NCC draft:", error);
    showToast(`Failed to create draft: ${error.message}`, "error");
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

async function refreshEndorsementHelpers(forceRefresh = false) {
  try {
    const relays = await getRelays(getConfig);
    if (!relays.length) return;
    
    const cacheKey = buildRelayCacheKey(relays);
    const cached = readCachedNcc(cacheKey);
    const cacheFresh = cached && Date.now() - cached.at < NCC_CACHE_TTL_MS;
    let events = [];
    let usedCache = false;

    if ((cacheFresh && !forceRefresh) || !isOnline()) {
      events = cached?.items || [];
      usedCache = true;
    }

    if (!events.length) {
      try {
        events = await fetchNccDocuments(relays);
        writeCachedNcc(cacheKey, events);
      } catch (error) {
        if (cached?.items?.length) {
          events = cached.items;
          usedCache = true;
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
    
    await updateAllDrafts();
    refreshUI();
  } catch (error) {
    console.error("NCC Manager: relay fetch failed", error);
  }
}

function refreshUI() {
  initPowerShell(
    state,
    {
      saveItem: handlePowerSave,
      publishDraft,
      withdrawDraft,
      deleteItem: handlePowerDelete,
      deleteItemSilent: handlePowerDeleteSilent,
      openNewNcc,
      createRevisionDraft,
      promptSigner: promptSignerConnection,
      signOut: signOutSigner,
      getConfig,
      setConfig,
      updateSignerConfig: handleUpdateSignerConfig,
      exportAll: handleExportAllDrafts
    },
    APP_VERSION
  );
}

async function withdrawDraft(id) {
  try {
    if (!confirm("Are you sure you want to withdraw this NCC? This will broadcast a withdrawal update to the Nostr network.")) return;
    
    let draft = (state.nccLocalDrafts || []).find((d) => d.id === id);
    if (!draft) {
      const event = (state.nccDocs || []).find((d) => d.id === id);
      if (event) {
        draft = toDraftFromRelay(event);
      }
    }
    
    if (!draft) throw new Error("Draft not found.");

    const relays = await getRelays(getConfig);
    if (!relays.length) throw new Error("No relays configured");
    const signerMode = state.signerMode;
    const nsec = sessionStorage.getItem("ncc-manager-nsec");
    const signer = await getSigner(signerMode, nsec);

    const withdrawnDraft = { 
      ...draft, 
      status: "withdrawn",
      published_at: nowSeconds() 
    };

    const template = createEventTemplate(withdrawnDraft);
    const event = await signer.signEvent(template);
    const result = await publishEvent(relays, event);

    const updated = {
      ...withdrawnDraft,
      event_id: event.id,
      author_pubkey: signer.pubkey,
      raw_event: event,
      raw_tags: event.tags || []
    };
    
    await saveDraft(updated);
    await updateAllDrafts();
    refreshUI();

    showToast(`NCC withdrawn and update published to ${result.accepted}/${result.total} relays.`);

  } catch (error) {
    showToast(`Withdraw failed: ${error.message}`, "error");
  }
}

async function publishDraft(draft, kind) {
  try {
    const validationError = validateDraft(draft, kind);
    if (validationError) throw new Error(validationError);
    const relays = await getRelays(getConfig);
    if (!relays.length) throw new Error("No relays configured");
    const signerMode = state.signerMode;
    const nsec = sessionStorage.getItem("ncc-manager-nsec");
    const signer = await getSigner(signerMode, nsec);

    const publishableDraft = { ...draft, status: "published" };
    const template = createEventTemplate(publishableDraft);
    
    const event = await signer.signEvent(template);
    const result = await publishEvent(relays, event);

    const updated = {
      ...publishableDraft,
      event_id: event.id,
      author_pubkey: signer.pubkey,
      published_at: publishableDraft.published_at || nowSeconds(),
      raw_event: event,
      raw_tags: event.tags || []
    };
    await saveDraft(updated);
    await updateAllDrafts();
    refreshUI();
    showToast(
      `Published to ${result.accepted}/${result.total} relays.`
    );
  } catch (error) {
    showToast(`Publish failed: ${error.message}`, "error");
  }
}

async function broadcastDraftToRelays(draft) {
  if (!draft.d) return null;
  const relays = await getRelays(getConfig);
  if (!relays.length) return null;
  if (!state.signerPubkey) return null;

  const signerMode = state.signerMode;
  const nsec = sessionStorage.getItem("ncc-manager-nsec");
  const signer = await getSigner(signerMode, nsec);

  const backupD = buildDraftIdentifier(draft.d);
  const backupDraftPayload = { ...draft, d: backupD, status: "draft" };
  if (!backupDraftPayload.tags) backupDraftPayload.tags = {};
  
  const template = createEventTemplate(backupDraftPayload);
  template.tags.push(["original_d", draft.d]);

  const event = await signer.signEvent(template);
  const result = await publishEvent(relays, event);
  
  return { eventId: event.id, result };
}

function validateDraft(draft, kind) {
  if (!draft.d) return "NCC number is required.";
  if (kind === "ncc") {
    if (!draft.title) return "Title is required.";
    if (!draft.content) return "Content is required.";
  }
  return "";
}

async function init() {
  await loadConfig();
  await fetchDefaults();
  await refreshEndorsementHelpers();
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
