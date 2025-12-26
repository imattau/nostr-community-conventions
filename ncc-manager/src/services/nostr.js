import { SimplePool } from "nostr-tools/pool";
import { waitForNostr } from "../utils.js";
import nip46 from './nip46.js';

export const pool = new SimplePool();

function normalizeSupersedes(value) {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  // Return as is (supports ncc-XX or raw hex)
  return trimmed.replace(/^event:/i, "");
}

function normalizeEventReference(value) {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("event:")) return trimmed;
  return `event:${trimmed}`;
}

function pushTag(tags, key, value) {
  if (!value) return;
  tags.push([key, String(value)]);
}

export function buildTagsForDraft(draft) {
  const tags = [];
  const dValue = (draft.d || "").trim();
  if (dValue) pushTag(tags, "d", dValue);
  
  // Ensure status is always present, defaulting to draft
  pushTag(tags, "status", draft.status || "draft");

  if (draft.kind === 30050) {
    pushTag(tags, "title", draft.title || "Untitled");
    const publishedAt = draft.published_at || Math.floor(Date.now() / 1000);
    pushTag(tags, "published_at", publishedAt);
    pushTag(tags, "summary", draft.tags?.summary || "");
    (draft.tags?.topics || []).forEach((topic) => pushTag(tags, "t", topic));
    pushTag(tags, "lang", draft.tags?.lang || "");
    pushTag(tags, "version", draft.tags?.version || "");
    (draft.tags?.supersedes || []).forEach((value) => {
      const normalized = normalizeSupersedes(value);
      pushTag(tags, "supersedes", normalized);
    });
    pushTag(tags, "license", draft.tags?.license || "");
    (draft.tags?.authors || []).forEach((author) => pushTag(tags, "authors", author));
  }

  if (draft.kind === 30051) {
    pushTag(tags, "authoritative", normalizeEventReference(draft.tags?.authoritative || ""));
    pushTag(tags, "type", draft.tags?.type || "revision");
    pushTag(tags, "steward", draft.tags?.steward || "");
    pushTag(tags, "previous", normalizeEventReference(draft.tags?.previous || ""));
    pushTag(tags, "from", normalizeEventReference(draft.tags?.from || ""));
    pushTag(tags, "to", normalizeEventReference(draft.tags?.to || ""));
    pushTag(tags, "reason", draft.tags?.reason || "");
    pushTag(tags, "effective_at", draft.tags?.effective_at || "");
  }

  if (draft.kind === 30052) {
    pushTag(tags, "endorses", normalizeEventReference(draft.tags?.endorses || ""));
    (draft.tags?.roles || []).forEach((role) => pushTag(tags, "role", role));
    pushTag(tags, "implementation", draft.tags?.implementation || "");
    pushTag(tags, "note", draft.tags?.note || "");
    (draft.tags?.topics || []).forEach((topic) => pushTag(tags, "t", topic));
  }

  if (draft.kind === 30053) {
    pushTag(tags, "title", draft.tags?.title || "Untitled");
    pushTag(tags, "for", draft.tags?.for || "");
    pushTag(tags, "published_at", draft.tags?.published_at || Math.floor(Date.now() / 1000));
    pushTag(tags, "for_event", normalizeEventReference(draft.tags?.for_event || ""));
    pushTag(tags, "type", draft.tags?.type || "");
    (draft.tags?.topics || []).forEach((topic) => pushTag(tags, "t", topic));
    pushTag(tags, "lang", draft.tags?.lang || "");
    pushTag(tags, "license", draft.tags?.license || "");
    (draft.tags?.authors || []).forEach((author) => pushTag(tags, "authors", author));
  }

  return tags.filter((tag) => tag[1] && tag[1] !== "event:");
}

export function createEventTemplate(draft) {
  return {
    kind: draft.kind,
    created_at: Math.floor(Date.now() / 1000),
    tags: buildTagsForDraft(draft),
    content: draft.content || ""
  };
}

export function payloadToDraft(payload) {
  const tags = Array.isArray(payload.tags) ? payload.tags : [];
  const tagMap = tags.reduce((acc, tag) => {
    if (!tag[0]) return acc;
    acc[tag[0]] = acc[tag[0]] || [];
    acc[tag[0]].push(tag[1]);
    return acc;
  }, {});

  const status = tagMap.status?.[0] || (payload.event_id || payload.id ? "published" : "draft");

  const draft = {
    id: payload.id || payload.event_id || crypto.randomUUID(),
    kind: payload.kind,
    d: tagMap.d?.[0] || "",
    title: tagMap.title?.[0] || "",
    content: payload.content || "",
    status: status,
    event_id: payload.event_id || payload.id || "",
    author_pubkey: payload.author_pubkey || payload.pubkey || "",
    published_at: tagMap.published_at ? Number(tagMap.published_at[0]) : null,
    // raw_event is now stored centrally in state.eventsById, so don't duplicate it here.
    // Instead, this draft is a view of the event.
  };

  if (draft.kind === 30050) {
    draft.tags = {
      summary: tagMap.summary?.[0] || "",
      topics: tagMap.t || [],
      lang: tagMap.lang?.[0] || "",
      version: tagMap.version?.[0] || "",
      supersedes: (tagMap.supersedes || []).map(normalizeSupersedes),
      license: tagMap.license?.[0] || "",
      authors: tagMap.authors || []
    };
  }

  if (draft.kind === 30051) {
    draft.tags = {
      authoritative: normalizeSupersedes(tagMap.authoritative?.[0] || ""),
      type: tagMap.type?.[0] || "",
      steward: tagMap.steward?.[0] || "",
      previous: normalizeSupersedes(tagMap.previous?.[0] || ""),
      from: normalizeSupersedes(tagMap.from?.[0] || ""),
      to: normalizeSupersedes(tagMap.to?.[0] || ""), // Corrected typo
      reason: tagMap.reason?.[0] || "",
      effective_at: tagMap.effective_at?.[0] || ""
    };
  }

  if (draft.kind === 30052) {
    draft.tags = {
      endorses: normalizeSupersedes(tagMap.endorses?.[0] || ""),
      roles: tagMap.role || [],
      implementation: tagMap.implementation?.[0] || "",
      note: tagMap.note?.[0] || "",
      topics: tagMap.t || []
    };
  }

  if (draft.kind === 30053) {
    draft.tags = {
      title: tagMap.title?.[0] || "",
      for: tagMap.for?.[0] || "",
      published_at: tagMap.published_at?.[0] || "",
      for_event: normalizeSupersedes(tagMap.for_event?.[0] || ""),
      type: tagMap.type?.[0] || "",
      topics: tagMap.t || [],
      lang: tagMap.lang?.[0] || "",
      license: tagMap.license?.[0] || "",
      authors: tagMap.authors || []
    };
  }
  // raw_event and raw_tags are no longer stored directly in the draft object
  // as the full event is available via state.eventsById.
  // This draft serves as a lighter, processed view.

  return draft;
}

export async function getSigner(mode) {
  if (mode === "nip07") {
    const available = await waitForNostr();
    if (!available) throw new Error("NIP-07 signer not available");
    const pubkey = await window.nostr.getPublicKey();
    return {
      type: "nip07",
      pubkey,
      signEvent: (template) => window.nostr.signEvent(template)
    };
  }

  if (mode === "nip46") {
    if (!nip46.isConnected()) throw new Error("NIP-46 signer not connected");
    const pubkey = await nip46.getPublicKey();
    return {
      type: "nip46",
      pubkey,
      signEvent: (template) => nip46.signEvent(template)
    };
  }

  throw new Error(`Unsupported signer mode: ${mode}`);
}

const profileCache = new Map();
const PROFILE_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export async function fetchProfile(pubkey, relays = []) {
  if (!pubkey || !relays.length) return null;

  const cached = profileCache.get(pubkey);
  if (cached && (Date.now() - cached.at < PROFILE_CACHE_TTL)) {
    return cached.profile;
  }

  const events = await pool.querySync(
    relays,
    {
      kinds: [0],
      authors: [pubkey],
      limit: 1
    },
    { maxWait: 2500 }
  );
  
  if (!events.length) return null;
  const latest = events.reduce((best, current) => {
    if (!best) return current;
    return (current.created_at || 0) > (best.created_at || 0) ? current : best;
  }, events[0]);
  
  let profile = null;
  if (latest?.content) {
    try {
      profile = JSON.parse(latest.content);
    } catch (_error) {
      void _error; // Explicitly consume unused variable
      // ignore
    }
  }

  profileCache.set(pubkey, { profile, at: Date.now() });
  return profile;
}

const DEFAULT_PUBLISH_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 500;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function publishEvent(relays, event, options = {}) {
  const maxAttempts = Math.max(1, options.attempts || DEFAULT_PUBLISH_ATTEMPTS);
  const backoffBase = options.backoffBaseMs ?? DEFAULT_BACKOFF_MS;
  let lastOutcome = { accepted: 0, total: relays.length };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const results = await Promise.allSettled(pool.publish(relays, event));
    const accepted = results.filter((result) => result.status === "fulfilled");
    lastOutcome = {
      accepted: accepted.length,
      total: results.length
    };

    if (accepted.length > 0) {
      return { ...lastOutcome, attempts: attempt };
    }

    if (attempt < maxAttempts) {
      await delay(backoffBase * attempt);
    }
  }

  throw new Error(
    `Publish failed on ${relays.length} relays after ${maxAttempts} attempts (${lastOutcome.accepted} accepted)`
  );
}

export async function verifyEvent(relays, eventId) {
  const events = await pool.querySync(relays, { ids: [eventId] }, { maxWait: 3500 });
  return events.length > 0;
}

export async function fetchNccDocuments(relays, authorPubkey = null) {
  const filter = {
    kinds: [30050]
  };
  if (authorPubkey) {
    filter.authors = [authorPubkey];
  }
  filter.limit = 500; // Re-add limit now that we have authors, to reduce relay load if author has many.

  const events = await pool.querySync(
    relays,
    filter,
    { maxWait: 8000 }
  );
  return events;
}

export async function fetchEndorsements(relays, eventIds) {
  if (!relays.length || !eventIds.length) return [];
  const uniqueIds = Array.from(new Set(eventIds.filter(Boolean)));
  if (!uniqueIds.length) return [];
  
  // NIP-01 filters support multiple #e tags, so combine into a single query
  const filters = [{
    kinds: [30052],
    '#e': uniqueIds,
    limit: 1000
  }];
  
  // Some relays might not support multiple #e, and old 'endorses' tag might still be around.
  // Use both #e (event ID) and #endorses (custom tag used before NIP-33 event ID tag standardization)
  // The client then filters based on what it expects.
  // This is a trade-off for compatibility vs strictness. For efficiency, one query is better.
  // If relays are smart, they'll dedup.
  
  // For now, let's keep it simple with one query that Nostr-tools should handle.
  return pool.querySync(relays, filters, { maxWait: 4000 });
}

export async function fetchSuccessionRecords(relays, dValues) {
  if (!relays.length || !dValues.length) return [];
  const uniqueDs = Array.from(new Set(dValues.filter(Boolean)));
  if (!uniqueDs.length) return [];
  
  // NIP-33 D-tag filters support multiple #d tags.
  const filters = [{
    kinds: [30051],
    '#d': uniqueDs,
    limit: 1000
  }];

  return pool.querySync(relays, filters, { maxWait: 4000 });
}

export async function fetchAuthorEndorsements(relays, pubkey) {
  if (!relays.length || !pubkey) return [];
  return pool.querySync(
    relays,
    {
      kinds: [30052],
      authors: [pubkey.toLowerCase()],
      limit: 200
    },
    { maxWait: 4000 }
  );
}
