import { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, getPublicKey, nip19 } from "nostr-tools";

const pool = new SimplePool();

function normalizeSupersedes(value) {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("event:") || trimmed.startsWith("ncc-")) return trimmed;
  if (/^[a-f0-9]{64}$/i.test(trimmed)) return `event:${trimmed}`;
  return trimmed;
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
    pushTag(tags, "steward", draft.tags?.steward || "");
    pushTag(tags, "previous", normalizeEventReference(draft.tags?.previous || ""));
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

  const draft = {
    id: crypto.randomUUID(),
    kind: payload.kind,
    d: tagMap.d?.[0] || "",
    title: tagMap.title?.[0] || "",
    content: payload.content || "",
    status: payload.event_id ? "published" : "draft",
    event_id: payload.event_id || "",
    author_pubkey: payload.author_pubkey || "",
    published_at: tagMap.published_at ? Number(tagMap.published_at[0]) : null,
    tags: {}
  };

  if (draft.kind === 30050) {
    draft.tags = {
      summary: tagMap.summary?.[0] || "",
      topics: tagMap.t || [],
      lang: tagMap.lang?.[0] || "",
      version: tagMap.version?.[0] || "",
      supersedes: tagMap.supersedes || [],
      license: tagMap.license?.[0] || "",
      authors: tagMap.authors || []
    };
  }

  if (draft.kind === 30051) {
    draft.tags = {
      authoritative: tagMap.authoritative?.[0] || "",
      steward: tagMap.steward?.[0] || "",
      previous: tagMap.previous?.[0] || "",
      reason: tagMap.reason?.[0] || "",
      effective_at: tagMap.effective_at?.[0] || ""
    };
  }

  if (draft.kind === 30052) {
    draft.tags = {
      endorses: tagMap.endorses?.[0] || "",
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
      for_event: tagMap.for_event?.[0] || "",
      type: tagMap.type?.[0] || "",
      topics: tagMap.t || [],
      lang: tagMap.lang?.[0] || "",
      license: tagMap.license?.[0] || "",
      authors: tagMap.authors || []
    };
  }

  draft.raw_event = payload;
  draft.raw_tags = tags;

  return draft;
}

export async function getSigner(mode, nsec) {
  if (mode === "nip07") {
    if (!window.nostr) throw new Error("NIP-07 signer not available");
    const pubkey = await window.nostr.getPublicKey();
    return {
      type: "nip07",
      pubkey,
      signEvent: (template) => window.nostr.signEvent(template)
    };
  }

  if (!nsec) throw new Error("nsec is required for local signer");
  const decoded = nip19.decode(nsec);
  if (decoded.type !== "nsec") throw new Error("Invalid nsec format");
  const sk = decoded.data;
  const pubkey = getPublicKey(sk);
  return {
    type: "nsec",
    pubkey,
    signEvent: (template) => finalizeEvent(template, sk)
  };
}

export async function fetchProfile(pubkey, relays = []) {
  if (!pubkey || !relays.length) return null;
  const events = await pool.querySync(
    relays,
    {
      kinds: [0],
      authors: [pubkey],
      limit: 5
    },
    { maxWait: 4000 }
  );
  if (!events.length) return null;
  const latest = events.reduce((best, current) => {
    if (!best) return current;
    return (current.created_at || 0) > (best.created_at || 0) ? current : best;
  }, events[0]);
  if (!latest?.content) return null;
  try {
    return JSON.parse(latest.content);
  } catch (error) {
    return null;
  }
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

export async function fetchNccDocuments(relays) {
  const events = await pool.querySync(
    relays,
    {
      kinds: [30050],
      limit: 500
    },
    { maxWait: 8000 }
  );
  return events;
}

export async function fetchEndorsements(relays, eventIds) {
  if (!relays.length || !eventIds.length) return [];
  const uniqueIds = Array.from(new Set(eventIds.filter(Boolean)));
  if (!uniqueIds.length) return [];
  const normalized = uniqueIds
    .map((id) => id.replace(/^event:/i, "").trim())
    .filter(Boolean);
  const filters = [
    {
      kinds: [30052],
      "#e": normalized,
      limit: 1000
    },
    {
      kinds: [30052],
      "#endorses": normalized,
      limit: 1000
    }
  ];
  const events = await pool.querySync(relays, filters, { maxWait: 4000 });
  const dedup = new Map();
  (events || []).forEach((event) => dedup.set(event.id, event));
  return Array.from(dedup.values());
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
