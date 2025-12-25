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

// Centralized state object (initial values)
export const state = {
  nccOptions: [],
  nccDocs: [],
  relayStatus: null,
  endorsementCounts: new Map(),
  signerPubkey: null,
  signerProfile: null,
  nccLocalDrafts: [],
  nsrLocalDrafts: [],
  endorsementLocalDrafts: [],
  supportingLocalDrafts: [],
  endorsementDetails: new Map(),
  persistedRelayEvents: new Set(),
  pendingDrafts: new Map(),
  remoteDrafts: [],
  FALLBACK_RELAYS: FALLBACK_RELAYS,
  theme: "power",
  signerMode: "nip07",
  validationResults: new Map(),
  eventsById: new Map(), // Central store for all raw Nostr events by ID
};

export function isFallbackRelay(url) {
  return FALLBACK_RELAYS.includes(url);
}

export async function getRelays(getConfig) {
  if (typeof getConfig !== "function") return [];
  const defaultRelays = (await getConfig("default_relays", [])) || [];
  const userRelays = (await getConfig("user_relays", [])) || [];
  const normalized = [...userRelays, ...defaultRelays]
    .map((relay) => (relay || "").trim())
    .filter(Boolean);
  return uniq(normalized);
}

// Caching mechanism
const NCC_CACHE_KEY_BASE = "ncc-manager-ncc-cache";
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
