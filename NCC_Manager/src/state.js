// src/state.js

import { uniq } from "./utils.js";

const FALLBACK_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://nostr.wine",
  "wss://relay.primal.net",
  "wss://nostr-01.yakihonne.com"
];

export const KINDS = {
  ncc: 30050,
  nsr: 30051,
  endorsement: 30052,
  supporting: 30053
};

// Centralized state object
export const state = {
  nccOptions: [],
  nccDocs: [],
  relayStatus: null,
  endorsementCounts: new Map(),
  signerPubkey: null,
  signerProfile: null,
  selectedNcc: null,
  nccLocalDrafts: [],
  editDraft: null,
  currentDraft: {
    ncc: null,
    nsr: null,
    endorsement: null,
    supporting: null
  },
  renderedDrafts: {
    ncc: [],
    nsr: [],
    endorsement: [],
    supporting: []
  },
  endorsementDetails: new Map(),
  selectedEndorsementTarget: "",
  selectedEndorsementLabel: "",
  persistedRelayEvents: new Set(),
  remoteDrafts: [], // Renamed from remoteBackups
  FALLBACK_RELAYS: FALLBACK_RELAYS // Keep fallback relays here
};

export async function getRelays(getConfig) {
  if (typeof getConfig !== "function") return [];
  const defaultRelays = (await getConfig("default_relays", [])) || [];
  const userRelays = (await getConfig("user_relays", [])) || [];
  const normalized = [...userRelays, ...defaultRelays]
    .map((relay) => (relay || "").trim())
    .filter(Boolean);
  return uniq(normalized);
}

// Function to update state (simple setter for now)
export function updateState(newState) {
  Object.assign(state, newState);
  // In a more complex app, you might trigger re-renders here
}

// Caching mechanism
const NCC_CACHE_KEY_BASE = "ncc-manager-ncc-cache";
const NCC_CACHE_TTL_MS = 5 * 60 * 1000;
const hasLocalStorage = typeof window !== "undefined" && !!window.localStorage;

export function buildRelayCacheKey(relays) {
  if (!relays || !relays.length) return `${NCC_CACHE_KEY_BASE}:default`;
  const sorted = [...relays].map((relay) => relay.trim()).sort();
  return `${NCC_CACHE_KEY_BASE}:${sorted.join("|")}`;
}

export function readCachedNcc(key) {
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

export function writeCachedNcc(key, events) {
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
