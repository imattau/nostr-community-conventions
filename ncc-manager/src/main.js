import "./styles.css";
import {
  saveDraft,
  listDrafts,
  deleteDraft,
  setConfig,
  getConfig
} from "./services/store.js";
import {
  createEventTemplate,
  payloadToDraft,
  getSigner,
  publishEvent,
  fetchNccDocuments,
  fetchEndorsements,
  fetchProfile,
  fetchSuccessionRecords
} from "./services/nostr.js";
import pkg from "../package.json";

import {
  shortenKey,
  nowSeconds,
  buildNccIdentifier,
  eventTagValue,
  normalizeEventId,
  normalizeHexId,
  isNccDocument,
  buildNccOptions,
  buildDraftIdentifier,
  isOnline,
  showToast,
  waitForNostr,
  incrementVersion,
  suggestNextNccNumber
} from "./utils.js";

import { 
  KINDS, 
  state as initialState, 
  getRelays, 
  buildRelayCacheKey, 
  readCachedNcc, 
  writeCachedNcc 
} from "./state.js";
import { stateManager } from "./stateManager.js";

// Initialize state manager with the initial state
stateManager.updateState(initialState);

import { initPowerShell, focusItem } from "./power_ui.js";
import { nsrService } from "./services/nsr_service.js";
import { validateDraftForPublish } from "./services/chain_validator.js";

// Import UI components to register them
import "./ui/explorer-tree.js";

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
  
  stateManager.updateState({ 
    nccLocalDrafts: ncc,
    nsrLocalDrafts: nsr,
    endorsementLocalDrafts: endorsement,
    supportingLocalDrafts: supporting
  });
  
  runGlobalValidation();
}

let lastValidatedState = new Map(); // Map<dTag, string of concatenated event IDs>
let validationWorker = null;
let validationPromises = new Map(); // Map<dTag, { resolve, reject }>
let validationJobId = 0;

function getValidationWorker() {
    if (!validationWorker) {
        validationWorker = new Worker(new URL('./workers/validationWorker.js', import.meta.url), { type: 'module' });
        validationWorker.onmessage = (e) => {
            const { id, result } = e.data;
            if (validationPromises.has(id)) {
                const { resolve } = validationPromises.get(id);
                validationPromises.delete(id);
                resolve(result);
            }
        };
        validationWorker.onerror = (e) => {
            console.error("Validation worker error:", e);
            // Reject all pending promises on worker error
            validationPromises.forEach(({ reject }) => reject(new Error("Validation worker error")));
            validationPromises.clear();
        };
    }
    return validationWorker;
}

async function runGlobalValidation() {
  const state = stateManager.getState();
  const docIds = state.nccDocs || [];
  
  // Retrieve full event objects from eventsById
  const docs = docIds.map(id => state.eventsById.get(id)).filter(Boolean);
  
  // Filter NSRs to only include published ones (or those with raw_event)
  const rawNsrs = (state.nsrLocalDrafts || [])
    .filter(d => d.raw_event) 
    .map(d => d.raw_event);

  const groupedDocs = new Map();
  docs.forEach(doc => {
      const d = eventTagValue(doc.tags, 'd');
      if (!d) return;
      if (!groupedDocs.has(d)) groupedDocs.set(d, []);
      groupedDocs.get(d).push(doc);
  });
  
  const groupedNsrs = new Map();
  rawNsrs.forEach(nsr => {
      const d = eventTagValue(nsr.tags, 'd');
      if (!d) return;
      if (!groupedNsrs.has(d)) groupedNsrs.set(d, []);
      groupedNsrs.get(d).push(nsr);
  });

  const newValidationResults = new Map();
  const currentValidatedState = new Map();
  const validationTasks = [];

  const worker = getValidationWorker();

  for (const d of groupedDocs.keys()) {
      const dDocs = groupedDocs.get(d) || [];
      const dNsrs = groupedNsrs.get(d) || [];

      // Create a unique identifier for the current set of docs and nsrs for this d-tag
      const currentDDocsIds = dDocs.map(doc => doc.id).sort().join(',');
      const currentDNsrsIds = dNsrs.map(nsr => nsr.id).sort().join(',');
      const currentStateIdentifier = `${currentDDocsIds}|${currentDNsrsIds}`;
      
      currentValidatedState.set(d, currentStateIdentifier);

      // Check if this d-tag's state has changed since last validation
      if (lastValidatedState.has(d) && lastValidatedState.get(d) === currentStateIdentifier && state.validationResults.has(d.toUpperCase())) {
          // No change, reuse previous validation result
          newValidationResults.set(d.toUpperCase(), state.validationResults.get(d.toUpperCase()));
          continue;
      }

      // State has changed or no previous validation, run validation in worker
      const jobId = validationJobId++;
      const promise = new Promise((resolve, reject) => {
          validationPromises.set(jobId, { resolve, reject });
          worker.postMessage({ id: jobId, targetD: d, rawDocs: dDocs, rawNsrs: dNsrs });
      }).then(result => {
          newValidationResults.set(d.toUpperCase(), result);
      }).catch(error => {
          console.error(`[Validation] Error for ${d}:`, error);
          newValidationResults.set(d.toUpperCase(), { d, authoritativeDocId: null, authoritativeNsrId: null, tips: [], forkPoints: [], forkedBranches: [], warnings: [`Error during validation: ${error.message}`] });
      });
      validationTasks.push(promise);
  }

  await Promise.allSettled(validationTasks);

  // Update lastValidatedState for next run
  lastValidatedState = currentValidatedState;
  
  // Also remove validation results for d-tags that no longer exist
  const existingDTags = new Set(Array.from(groupedDocs.keys()).map(d => d.toUpperCase()));
  for (const dTag of state.validationResults.keys()) {
      if (!existingDTags.has(dTag)) {
          newValidationResults.delete(dTag);
      }
  }

  stateManager.updateState({ validationResults: newValidationResults });
}

async function initShell() {
  const power = document.getElementById("shell-power");
  
  if (!power) {
      console.error("Power shell container not found");
      return;
  }
  
  power.hidden = false;
  
  await updateAllDrafts();

  const actions = {
    updateSignerConfig: handleUpdateSignerConfig,
    promptSigner: promptSignerConnection,
  };

  try {
    initPowerShell(
      stateManager.getState(),
      APP_VERSION,
      getConfig,
      setConfig,
      actions // Pass the actions object
    );
  } catch (e) {
    console.error("Failed to init PowerShell:", e);
  }
}

async function handleUpdateSignerConfig(mode) {
    stateManager.updateState({ signerMode: mode });
    await setConfig("signer_mode", mode);
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
  const state = stateManager.getState();
  
  if (!item) {
    const pending = state.pendingDrafts?.get(id);
    if (pending) {
      item = pending;
    }

    const allLocal = [
      ...(state.nccLocalDrafts || []),
      ...(state.nsrLocalDrafts || []),
      ...(state.endorsementLocalDrafts || []),
      ...(state.supportingLocalDrafts || [])
    ];
    item = allLocal.find(d => d.id === id);
    
    if (!item) {
      // If it's a relay event, get it from the central store
      const relayEvent = state.eventsById.get(id);
      if (relayEvent) {
        item = toDraftFromRelay(relayEvent); // Convert the raw event to a draft
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
  
  if (state.signerPubkey && !item.author_pubkey) {
    item.author_pubkey = state.signerPubkey;
  }
  
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
  
  state.pendingDrafts?.delete(id);
  await updateAllDrafts();
  refreshUI();
  
  eventBus.emit('save-successful', item);
  
  // Return the updated item so caller can update their reference
  return item;
}

async function promptSignerConnection(overrideMode) {
  const state = stateManager.getState();
  const mode = overrideMode || state.signerMode;

  if (mode === "nip07") {
    const available = await waitForNostr();
    if (!available) {
      const isInsecureIP = window.location.protocol === 'http:' && 
                           window.location.hostname !== 'localhost' && 
                           window.location.hostname !== '127.0.0.1' &&
                           /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(window.location.hostname);
      
      if (isInsecureIP) {
          showToast("Signer blocked on insecure IP. Use localhost or HTTPS.", "error");
      } else {
          showToast("Install a NIP-07 signer to sign in.", "error");
      }
      return;
    }
    try {
      await window.nostr.getPublicKey();
      // If successful, ensure mode is persisted
      stateManager.updateState({ signerMode: "nip07" });
      await setConfig("signer_mode", "nip07");
    } catch (_error) { // Used _error
      void _error; // Explicitly consume unused variable
      showToast("Signer denied access.", "error");
      return;
    }
  }
  await updateSignerStatus();
}

async function signOutSigner() {
  await setConfig("signer_mode", "nip07");
  // Explicitly clear signer state and prevent immediate re-probing
  stateManager.updateState({ 
      signerPubkey: null, 
      signerProfile: null, 
      signerMode: "nip07" 
  });
  
  await updateAllDrafts();
  showToast("Signer cleared.");
  refreshUI();
}

async function refreshSignerProfile() {
  const state = stateManager.getState();
  if (!state.signerPubkey) {
    stateManager.updateState({ signerProfile: null });
    return;
  }
  try {
    const relays = await getRelays(getConfig);
    const targets = relays.length ? relays : FALLBACK_RELAYS;
    if (!targets.length) return;
    stateManager.updateState({ signerProfile: await fetchProfile(state.signerPubkey, targets) });
  } catch (_error) {
    void _error; // Explicitly consume unused variable
    stateManager.updateState({ signerProfile: null });
  }
}

async function updateSignerStatus() {
  const state = stateManager.getState();
  const wasSignedIn = !!state.signerPubkey;
  try {
    const signer = await getSigner(state.signerMode);
    stateManager.updateState({ signerPubkey: signer.pubkey });
    await refreshSignerProfile();
    
    if (!wasSignedIn && signer.pubkey) {
        const name = stateManager.getState().signerProfile?.name || shortenKey(signer.pubkey);
        showToast(`Signed in as ${name}`, "success");
    }
  } catch (_error) { // Used _error
    stateManager.updateState({ signerPubkey: null, signerProfile: null });
  }
  
  await updateAllDrafts();
  refreshUI();
}

async function fetchDefaults() {
  const state = stateManager.getState();
  try {
    const res = await fetch("/api/defaults");
    const data = await res.json();
    stateManager.updateState({ defaults: data.relays || [] });
    await setConfig("default_relays", state.defaults);
  } catch (_error) {
    void _error; // Explicitly consume unused variable
    stateManager.updateState({ defaults: FALLBACK_RELAYS });
    await setConfig("default_relays", state.defaults);
    showToast("Using fallback default relays (server unavailable).", "error");
  }
}

async function loadConfig() {
  const defaultRelays = (await getConfig("default_relays", [])) || [];
  const signerMode = (await getConfig("signer_mode", "nip07")) || "nip07";
  const savedTheme = (await getConfig("theme", "power")) || "power";
  
  stateManager.updateState({ defaults: defaultRelays, signerMode: signerMode, theme: savedTheme });
  
  document.body.classList.add('mode-power');
  if (savedTheme === 'terminal') {
    document.body.classList.add('theme-terminal');
  } else if (savedTheme === 'vscode') {
    document.body.classList.add('theme-vscode');
  } else if (savedTheme === 'vscode-light') {
    document.body.classList.add('theme-vscode-light');
  }
  
  await initShell();
  await updateSignerStatus();
}

function toDraftFromRelay(input) {
  const state = stateManager.getState();
  // Input can be a raw event object or an event ID string
  const rawEvent = (typeof input === 'string') ? state.eventsById.get(input) : input;
  if (!rawEvent) return null; // Event not found in central store
  
  const tagMap = {};
  (rawEvent.tags || []).forEach((tag) => {
    const key = tag[0];
    if (!key) return;
    tagMap[key] = tagMap[key] || [];
    tagMap[key].push(tag[1]);
  });

  return {
    id: crypto.randomUUID(),
    kind: KINDS.ncc,
    status: "draft",
    author_pubkey: rawEvent.pubkey || rawEvent.author_pubkey || "",
    d: buildNccIdentifier(eventTagValue(rawEvent.tags || [], "d")) || rawEvent.d || "",
    title: eventTagValue(rawEvent.tags || [], "title") || rawEvent.title || "",
    content: rawEvent.content || "",
    published_at:
      Number(eventTagValue(rawEvent.tags || [], "published_at")) || rawEvent.created_at || nowSeconds(),
    tags: {
      summary: tagMap.summary?.[0] || "",
      topics: tagMap.t || [],
      lang: tagMap.lang?.[0] || "",
      version: tagMap.version?.[0] || "",
      supersedes: tagMap.supersedes || [],
      license: tagMap.license?.[0] || "",
      authors: tagMap.authors || [],
      // For Kind 30052/30053/30051
      authoritative: normalizeEventId(tagMap.authoritative?.[0] || ""),
      from: normalizeEventId(tagMap.from?.[0] || ""),
      to: normalizeEventId(tagMap.to?.[0] || ""),
      previous: normalizeEventId(tagMap.previous?.[0] || ""),
      endorses: normalizeEventId(tagMap.endorses?.[0] || ""),
      for: tagMap.for?.[0] || "",
      for_event: normalizeEventId(tagMap.for_event?.[0] || ""),
      type: tagMap.type?.[0] || ""
    }
  };
}

function buildRevisionSupersedes(tags, eventId) {
  // For a linear chain, we only want to supersede the immediate predecessor.
  // We do not want to carry over the predecessor's own supersedes list.
  if (eventId) {
    const normalized = normalizeEventId(eventId);
    if (normalized) {
      return [normalized];
    }
  }
  return [];
}

function createRevisionDraft(item) {
  const state = stateManager.getState();
  if (!state.signerPubkey) {
    showToast("You must be signed in to create a revision.", "error");
    return null;
  }

  const eventId = item.event_id || item.id;
  
  // Try to get the raw event from the central store first
      const rawEventSource = state.eventsById.get(eventId);
  
    if (rawEventSource) {
      const base = toDraftFromRelay(rawEventSource);
      return {
        ...base,
        id: crypto.randomUUID(),
        status: "draft",
        author_pubkey: state.signerPubkey,
        event_id: "",
        published_at: null,
        tags: {
          ...base.tags,
          version: incrementVersion(base.tags?.version),
          // Ensure buildRevisionSupersedes gets the event_id, not the full raw event, for its logic
          supersedes: buildRevisionSupersedes(base.tags, eventId) 
        },
        source: "local"
      };
    }
  
    // Fallback to local drafts
    const allLocal = [
      ...(state.nccLocalDrafts || []),
      ...(state.nsrLocalDrafts || []),
      ...(state.endorsementLocalDrafts || []),
      ...(state.supportingLocalDrafts || [])
    ];
    const baseDraft = allLocal.find((d) => d.id === item.id);
    if (!baseDraft) return null;

  return {
    ...baseDraft,
    id: crypto.randomUUID(),
    status: "draft",
    author_pubkey: state.signerPubkey,
    event_id: "",
    published_at: null,
    tags: {
      ...baseDraft.tags,
      version: incrementVersion(baseDraft.tags?.version),
      supersedes: buildRevisionSupersedes(baseDraft.tags, eventId)
    }
  };
}

function openNewNcc() {
  const state = stateManager.getState();
  if (!state.signerPubkey) {
    showToast("You must be signed in to create an NCC.", "error");
    return;
  }
  const nextNumber = suggestNextNccNumber(state.nccDocs || []);
  const draft = {
    id: crypto.randomUUID(),
    kind: KINDS.ncc,
    status: "draft",
    author_pubkey: state.signerPubkey,
    d: buildNccIdentifier(nextNumber),
    title: "",
    content: "",
    published_at: nowSeconds(),
    event_id: "",
    source: "local",
    tags: {
      summary: "",
      topics: [],
      lang: "",
      version: "1",
      supersedes: [],
      license: "",
      authors: []
    }
  };
  
  state.pendingDrafts?.set(draft.id, draft);
  focusItem(draft.id, true);
}

async function persistRelayEvents(events) {
  if (!events?.length) return;
  const state = stateManager.getState();
  const tasks = [];
  const updatedEventsById = new Map(state.eventsById);
  const updatedNccDocs = [...(state.nccDocs || [])];
  let docsChanged = false;

  for (const event of events) {
    if (!event?.id) continue;
    
    // Always store the full event in eventsById
    updatedEventsById.set(event.id, event);

    // If it's an NCC document, ensure it's in the nccDocs list for validation
    if (isNccDocument(event) && !updatedNccDocs.includes(event.id)) {
        updatedNccDocs.push(event.id);
        docsChanged = true;
    }

    // Only add to persistedRelayEvents for tracking if it's new
    if (state.persistedRelayEvents.has(event.id)) continue;
    state.persistedRelayEvents.add(event.id);
    
    // Also save a draft representation locally
    const draft = payloadToDraft(event);
    draft.source = "relay";
    draft.event_id = event.id; // Ensure event_id matches the actual Nostr event ID
    const timestamp = event.created_at || nowSeconds();
    draft.updated_at = timestamp * 1000;
    draft.created_at = timestamp * 1000;
    draft.published_at = timestamp;
    draft.id = event.id; // Use event.id as local draft ID for relay events
    tasks.push(saveDraft(draft));
  }
  
  // Update the central store
  const stateUpdate = { eventsById: updatedEventsById };
  if (docsChanged) {
      stateUpdate.nccDocs = updatedNccDocs;
  }
  stateManager.updateState(stateUpdate);

  if (tasks.length) {
      await Promise.allSettled(tasks);
  }
}

async function refreshEndorsementHelpers(forceRefresh = false) {
  try {
    const relays = await getRelays(getConfig);
    if (!relays.length) {
        return;
    }
    
    const state = stateManager.getState(); // Get current state to access signerPubkey
    const signerPubkey = state.signerPubkey;

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
        events = await fetchNccDocuments(relays, signerPubkey); // Pass signerPubkey
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
    const dValues = filtered.map((event) => eventTagValue(event.tags, "d")).filter(Boolean);
    
    if (isOnline()) {
      const tasks = [];
      if (eventIds.length) {
        tasks.push(fetchEndorsements(relays, eventIds).then(persistRelayEvents));
      }
      if (dValues.length) {
        tasks.push(fetchSuccessionRecords(relays, dValues).then(events => persistRelayEvents(events)));
      }
      
      try {
        await Promise.allSettled(tasks);
      } catch (error) {
        console.warn("NCC Manager: failed to fetch related events", error);
      }
    }

    stateManager.updateState({
      nccOptions: buildNccOptions(filtered),
      nccDocs: filtered.map(e => e.id), // Store only IDs in nccDocs
      relayStatus: {
        relays: relays.length,
        events: filtered.length,
        fromCache: usedCache,
        at: Date.now()
      }
    });
    
    runGlobalValidation();
    await updateAllDrafts();
    refreshUI();
  } catch (error) {
    console.error("NCC Manager: relay fetch failed", error);
  }
}

function refreshUI() {
  initPowerShell(
    stateManager.getState(),
    APP_VERSION,
    getConfig,
    setConfig
  );
}

async function withdrawDraft(id) {
  const state = stateManager.getState();
  try {
    if (!confirm("Are you sure you want to withdraw this NCC? This will broadcast a withdrawal update to the Nostr network.")) return;
    
    let draft = (state.nccLocalDrafts || []).find((d) => d.id === id);
    if (!draft) {
      // If it's a relay event, get it from the central store
      const event = state.eventsById.get(id);
      if (event) {
        draft = toDraftFromRelay(event);
      }
    }
    
    if (!draft) throw new Error("Draft not found.");

    const relays = await getRelays(getConfig);
    if (!relays.length) throw new Error("No relays configured");
    const signerMode = state.signerMode;
    const signer = await getSigner(signerMode);

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
      author_pubkey: signer.pubkey
      // raw_event and raw_tags are no longer stored directly in the draft object
      // as the full event is available via state.eventsById.
    };
    
    await saveDraft(updated);
    await updateAllDrafts();
    refreshUI();

    showToast(`NCC withdrawn and update published to ${result.accepted}/${result.total} relays.`);

  } catch (_error) {
    showToast(`Withdraw failed: ${_error.message}`, "error");
  }
}

async function publishDraft(draft, kind, shouldAnnounce = false) {
  const state = stateManager.getState();
  try {
    const validationError = validateDraftForPublish(draft);
    if (validationError) throw new Error(validationError);
    const relays = await getRelays(getConfig);
    if (!relays.length) throw new Error("No relays configured");
    const signerMode = state.signerMode;
    const signer = await getSigner(signerMode);

    const publishableDraft = { ...draft, status: "published" };
    const template = createEventTemplate(publishableDraft);
    
    const event = await signer.signEvent(template);
    const result = await publishEvent(relays, event);

    const updated = {
      ...publishableDraft,
      event_id: event.id,
      author_pubkey: signer.pubkey,
      published_at: publishableDraft.published_at || nowSeconds()
      // raw_event and raw_tags are no longer stored directly in the draft object
      // as the full event is available via state.eventsById.
    };
    
    // Add newly published event to central stores so validation can see it immediately
    await persistRelayEvents([event]);
    
    await saveDraft(updated);
    await updateAllDrafts();
    refreshUI();
    
    showToast(
      `Published to ${result.accepted}/${result.total} relays.`
    );

    if (shouldAnnounce) {
        eventBus.emit('open-announcement-modal', { item: updated, eventId: event.id });
    }

    // --- NSR AUTOMATION ---
    if (kind === "ncc" || draft.kind === KINDS.ncc) {
      const newId = event.id;
      const supersedes = draft.tags?.supersedes?.[0]; // Taking the primary/first supersedes reference
      
      if (!supersedes) {
        console.info("No supersedes found, skipping auto-NSR for initial publish.");
        return;
      }

      const prevId = normalizeEventId(supersedes);
      
      // Safety checks
      if (!prevId || prevId.length !== 64) {
        showToast("Published revision, but supersedes is invalid. NSR not created.", "warning");
        return;
      }
      if (prevId === newId) {
        showToast("Published revision, but supersedes matches new ID. NSR not created.", "warning");
        return;
      }

      try {
        const nsrResult = await nsrService.createRevisionNSR(signer, relays, {
          d: draft.d,
          fromId: prevId,
          toId: newId,
          authoritativeId: newId,
          effectiveAt: updated.published_at
        });

        if (nsrResult.skipped) {
            console.info("NSR already exists for this revision.");
        } else {
            if (nsrResult.event) {
                await persistRelayEvents([nsrResult.event]);
            }
            showToast(`NSR created: ${shortenKey(nsrResult.eventId)}`, "info");
        }
      } catch (nsrError) {
        console.error("NSR Auto-creation failed:", nsrError);
        showToast("Published revision, but NSR failed. You may need to create it manually.", "warning");
      }
    }
  } catch (_error) {
    showToast(`Publish failed: ${_error.message}`, "error");
  }
}

async function broadcastDraftToRelays(draft) {
  if (!draft.d) return null;
  const relays = await getRelays(getConfig);
  if (!relays.length) return null;
  const state = stateManager.getState();
  if (!state.signerPubkey) return null;

  const signerMode = state.signerMode;
  const signer = await getSigner(signerMode);

  const backupD = buildDraftIdentifier(draft.d);
  const backupDraftPayload = { ...draft, d: backupD, status: "draft" };
  if (!backupDraftPayload.tags) backupDraftPayload.tags = {};
  
  const template = createEventTemplate(backupDraftPayload);
  template.tags.push(["original_d", draft.d]);

  const event = await signer.signEvent(template);
  const result = await publishEvent(relays, event);
  
  return { eventId: event.id, result };
}

import { eventBus } from './eventBus.js';

function setupEventListeners() {
    eventBus.on('open-new-ncc', openNewNcc);
    eventBus.on('delete-item', handlePowerDelete);
    eventBus.on('delete-item-silent', handlePowerDeleteSilent);
    eventBus.on('withdraw-item', withdrawDraft);
    eventBus.on('publish-item', ({ item, kind, shouldAnnounce }) => publishDraft(item, kind, shouldAnnounce));
    
    eventBus.on('create-revision-draft', (item) => {
        const newDraft = createRevisionDraft(item);
        if (newDraft) {
            handlePowerSave(newDraft.id, newDraft.content, newDraft)
                .then(savedDraft => {
                    eventBus.emit('revision-created', savedDraft);
                });
        }
    });

    eventBus.on('save-item', ({ id, content, item }) => handlePowerSave(id, content, item));
    eventBus.on('sign-out', signOutSigner);
    eventBus.on('update-signer-config', ({ mode }) => handleUpdateSignerConfig(mode));
    eventBus.on('export-all', handleExportAllDrafts);
    eventBus.on('clear-cache', () => localStorage.clear());
    eventBus.on('set-config', ({ key, value }) => setConfig(key, value));
    
    eventBus.on('post-announcement', async ({ content }) => {
        const state = stateManager.getState();
        try {
            const relays = await getRelays(getConfig);
            const signer = await getSigner(state.signerMode);
            const template = {
                kind: 1,
                created_at: nowSeconds(),
                tags: [["t", "ncc"]],
                content: content
            };
            const event = await signer.signEvent(template);
            const result = await publishEvent(relays, event);
            showToast(`Announcement posted to ${result.accepted}/${result.total} relays.`);
        } catch (err) {
            console.error("Announcement failed:", err);
            showToast(`Announcement failed: ${err.message}`, "error");
        }
    });
}

async function init() {
  await loadConfig();
  setupEventListeners();
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
