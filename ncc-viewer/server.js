import express from "express";
import WebSocket from "ws";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

global.WebSocket = WebSocket;

const { SimplePool } = await import("nostr-tools/pool");

const app = express();
const pool = new SimplePool();

const RELAYS = (process.env.NCC_RELAYS ||
  "wss://relay.damus.io,wss://nos.lol,wss://relay.nostr.band,wss://nostr.wine,wss://relay.primal.net,wss://nostr-01.yakihonne.com")
  .split(",")
  .map((relay) => relay.trim())
  .filter(Boolean);

const PORT = Number(process.env.PORT || 4321);
const CACHE_TTL_MS = Number(process.env.NCC_CACHE_TTL_MS || 600_000);
const SINCE_SECONDS = Number(process.env.NCC_SINCE_SECONDS || 0);
const LOG_LEVEL = (process.env.NCC_LOG_LEVEL || "info").toLowerCase();

const cacheState = new Map();

const KIND_NCC = 30050;
const KIND_NSR = 30051;
const KIND_ENDORSEMENT = 30052;

function getTagValues(event, name) {
  if (!event?.tags) return [];
  return event.tags.filter((tag) => tag[0] === name).map((tag) => tag[1]).filter(Boolean);
}

function getTagValue(event, name) {
  return getTagValues(event, name)[0] || "";
}

function getPublishedAt(event) {
  const published = Number(getTagValue(event, "published_at"));
  if (Number.isFinite(published) && published > 0) return published;
  return Number(event.created_at || 0);
}

function normalizeId(value) {
  return (value || "").trim().toLowerCase();
}

function normalizeRelay(value) {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  const hasScheme = /^[a-z]+:\/\//i.test(trimmed);
  const withScheme = hasScheme ? trimmed : `wss://${trimmed}`;
  if (!/^wss?:\/\//i.test(withScheme)) return "";
  return withScheme;
}

function parseRelayOverrides(raw) {
  if (!raw) return [];
  const seen = new Set();
  const relays = [];
  for (const entry of raw.split(",")) {
    const normalized = normalizeRelay(entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    relays.push(normalized);
    if (relays.length >= 10) break;
  }
  return relays;
}

function getRelaysFromRequest(req) {
  const extra = parseRelayOverrides(req.query.relays || "");
  const merged = [...RELAYS];
  for (const relay of extra) {
    if (!merged.includes(relay)) merged.push(relay);
  }
  return merged;
}

function isNccDTag(value) {
  return normalizeId(value).startsWith("ncc-");
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

function parseStewardTag(tag) {
  if (!tag) return "";
  const parts = tag.split(":");
  if (parts.length === 2) return parts[1];
  return tag;
}

function formatNumber(dTag) {
  const match = /ncc-(\d+)/i.exec(dTag || "");
  if (!match) return null;
  return Number(match[1]);
}

function dedupe(events) {
  const seen = new Set();
  const result = [];
  for (const event of events || []) {
    if (!event?.id) continue;
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    result.push(event);
  }
  return result;
}

async function fetchEvents(relays) {
  const filter = {
    kinds: [KIND_NCC, KIND_NSR, KIND_ENDORSEMENT]
  };
  if (SINCE_SECONDS > 0) filter.since = SINCE_SECONDS;

  try {
    const startedAt = Date.now();
    if (LOG_LEVEL !== "silent") {
      console.log(`Fetching NCC events from ${relays.length} relays...`);
    }
    const events = await pool.querySync(relays, filter, { maxWait: 4000 });
    if (LOG_LEVEL !== "silent") {
      const durationMs = Date.now() - startedAt;
      console.log(`Fetched ${events.length} events in ${durationMs}ms.`);
    }
    return dedupe(events);
  } catch (error) {
    console.error("Failed to fetch NCC events from relays:", error);
    throw error;
  }
}

function buildIndex(events) {
  const docsByD = new Map();
  const nsrByD = new Map();
  const endorsementsByEvent = new Map();

  for (const event of events) {
    const dTag = getTagValue(event, "d");
    if (!dTag || !isNccDTag(dTag)) continue;
    const key = normalizeId(dTag);

    if (event.kind === KIND_NCC) {
      const list = docsByD.get(key) || [];
      list.push(event);
      docsByD.set(key, list);
    }

    if (event.kind === KIND_NSR) {
      const list = nsrByD.get(key) || [];
      list.push(event);
      nsrByD.set(key, list);
    }

    if (event.kind === KIND_ENDORSEMENT) {
      const endorses = getTagValue(event, "endorses");
      const normalized = normalizeId(endorses.replace(/^event:/, ""));
      if (!normalized) continue;
      const list = endorsementsByEvent.get(normalized) || [];
      list.push(event);
      endorsementsByEvent.set(normalized, list);
    }
  }

  return { docsByD, nsrByD, endorsementsByEvent };
}

function pickCurrentDoc(docs) {
  if (!docs || docs.length === 0) return null;
  return docs.reduce((latest, current) => {
    const latestScore = getPublishedAt(latest);
    const currentScore = getPublishedAt(current);
    return currentScore >= latestScore ? current : latest;
  });
}

function pickDocById(docs, eventId) {
  if (!docs || !eventId) return null;
  const target = normalizeId(eventId);
  return docs.find((event) => normalizeId(event.id) === target) || null;
}

function resolveSteward(currentDoc, nsrList) {
  if (!currentDoc) return "";
  if (!nsrList || nsrList.length === 0) return currentDoc.pubkey;

  const currentId = normalizeId(currentDoc.id);
  const matching = nsrList
    .filter((event) => normalizeId(getTagValue(event, "authoritative").replace(/^event:/, "")) === currentId)
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  if (matching.length === 0) return currentDoc.pubkey;

  const latest = matching[0];
  const stewardTag = getTagValue(latest, "steward");
  return parseStewardTag(stewardTag) || latest.pubkey || currentDoc.pubkey;
}

function buildList(index) {
  const items = [];

  for (const [dTag, docs] of index.docsByD.entries()) {
    const current = pickCurrentDoc(docs);
    if (!current) continue;
    const title = getTagValue(current, "title") || "Untitled";
    const steward = resolveSteward(current, index.nsrByD.get(dTag) || []);
    const endorsements = (index.endorsementsByEvent.get(normalizeId(current.id)) || []).length;
    const number = formatNumber(dTag);

    items.push({
      d: dTag,
      number,
      title,
      steward,
      event_id: current.id,
      published_at: getPublishedAt(current),
      summary: getTagValue(current, "summary"),
      endorsements
    });
  }

  return items.sort((a, b) => {
    if (a.number !== null && b.number !== null) return a.number - b.number;
    return a.d.localeCompare(b.d);
  });
}

function buildDetails(dTag, index, eventId = "") {
  const docs = index.docsByD.get(dTag) || [];
  const selected = pickDocById(docs, eventId);
  const current = selected || pickCurrentDoc(docs);
  if (!current) return null;

  const nsrList = (index.nsrByD.get(dTag) || [])
    .map((event) => ({
      event_id: event.id,
      pubkey: event.pubkey,
      steward: parseStewardTag(getTagValue(event, "steward")) || event.pubkey,
      authoritative: getTagValue(event, "authoritative"),
      previous: getTagValue(event, "previous"),
      reason: getTagValue(event, "reason"),
      effective_at: Number(getTagValue(event, "effective_at")) || null,
      content: event.content || "",
      created_at: event.created_at || null
    }))
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  const endorsements = index.endorsementsByEvent.get(normalizeId(current.id)) || [];
  const endorsementsByRole = endorsements.reduce(
    (acc, event) => {
      const role = getTagValue(event, "role") || "unknown";
      acc[role] = (acc[role] || 0) + 1;
      return acc;
    },
    {}
  );

  const proposals = docs
    .filter((event) => normalizeId(event.id) !== normalizeId(current.id))
    .map((event) => ({
      event_id: event.id,
      published_at: getPublishedAt(event),
      title: getTagValue(event, "title") || "Untitled",
      summary: getTagValue(event, "summary"),
      pubkey: event.pubkey
    }))
    .sort((a, b) => b.published_at - a.published_at);

  return {
    d: dTag,
    title: getTagValue(current, "title") || "Untitled",
    event_id: current.id,
    pubkey: current.pubkey,
    published_at: getPublishedAt(current),
    summary: getTagValue(current, "summary"),
    topics: getTagValues(current, "t"),
    version: getTagValue(current, "version"),
    supersedes: getTagValues(current, "supersedes"),
    license: getTagValue(current, "license"),
    authors: getTagValues(current, "authors"),
    content: current.content || "",
    content_html: renderMarkdown(current.content || ""),
    steward: resolveSteward(current, index.nsrByD.get(dTag) || []),
    endorsements_count: endorsements.length,
    endorsements_by_role: endorsementsByRole,
    proposals_count: proposals.length,
    proposals,
    nsr: nsrList,
    documents: docs
      .map((event) => ({
        event_id: event.id,
        published_at: getPublishedAt(event),
        title: getTagValue(event, "title") || "Untitled",
        pubkey: event.pubkey
      }))
      .sort((a, b) => b.published_at - a.published_at)
  };
}

function buildEndorsements(dTag, index) {
  const docs = index.docsByD.get(dTag) || [];
  const current = pickCurrentDoc(docs);
  if (!current) return null;
  const endorsements = index.endorsementsByEvent.get(normalizeId(current.id)) || [];

  return endorsements
    .map((event) => ({
      event_id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at || null,
      role: getTagValue(event, "role"),
      implementation: getTagValue(event, "implementation"),
      note: getTagValue(event, "note"),
      content: event.content || ""
    }))
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
}

function buildProposals(dTag, index) {
  const docs = index.docsByD.get(dTag) || [];
  const current = pickCurrentDoc(docs);
  if (!current) return null;

  return docs
    .filter((event) => normalizeId(event.id) !== normalizeId(current.id))
    .map((event) => ({
      event_id: event.id,
      published_at: getPublishedAt(event),
      title: getTagValue(event, "title") || "Untitled",
      summary: getTagValue(event, "summary"),
      pubkey: event.pubkey,
      content_html: renderMarkdown(event.content || "")
    }))
    .sort((a, b) => b.published_at - a.published_at);
}

function getCacheBucket(key) {
  if (!cacheState.has(key)) {
    cacheState.set(key, { at: 0, data: null, pending: null });
  }
  return cacheState.get(key);
}

async function getData(relays) {
  const key = relays.join(",");
  const bucket = getCacheBucket(key);
  const now = Date.now();
  if (bucket.data && now - bucket.at < CACHE_TTL_MS) return bucket.data;
  if (bucket.pending) return bucket.pending;

  bucket.pending = fetchEvents(relays)
    .then((events) => {
      const index = buildIndex(events);
      const list = buildList(index);
      const payload = { index, list };
      bucket.at = Date.now();
      bucket.data = payload;
      bucket.pending = null;
      return payload;
    })
    .catch((error) => {
      bucket.pending = null;
      throw error;
    });

  return bucket.pending;
}

app.use(express.static("public"));

app.get("/api/nccs", async (req, res) => {
  try {
    const relays = getRelaysFromRequest(req);
    const data = await getData(relays);
    res.json({ relays, default_relays: RELAYS, items: data.list });
  } catch (error) {
    res.status(500).json({ error: "Failed to load NCCs", detail: error.message });
  }
});

app.get("/api/nccs/:d", async (req, res) => {
  try {
    const relays = getRelaysFromRequest(req);
    const data = await getData(relays);
    const dTag = normalizeId(req.params.d);
    const eventId = normalizeId(req.query.event_id || "");
    const details = buildDetails(dTag, data.index, eventId);
    if (!details) return res.status(404).json({ error: "NCC not found" });
    res.json({ relays, default_relays: RELAYS, details });
  } catch (error) {
    res.status(500).json({ error: "Failed to load NCC", detail: error.message });
  }
});

app.get("/api/nccs/:d/endorsements", async (req, res) => {
  try {
    const relays = getRelaysFromRequest(req);
    const data = await getData(relays);
    const dTag = normalizeId(req.params.d);
    const endorsements = buildEndorsements(dTag, data.index);
    if (!endorsements) return res.status(404).json({ error: "NCC not found" });
    res.json({ relays, default_relays: RELAYS, endorsements });
  } catch (error) {
    res.status(500).json({ error: "Failed to load endorsements", detail: error.message });
  }
});

app.get("/api/nccs/:d/proposals", async (req, res) => {
  try {
    const relays = getRelaysFromRequest(req);
    const data = await getData(relays);
    const dTag = normalizeId(req.params.d);
    const proposals = buildProposals(dTag, data.index);
    if (!proposals) return res.status(404).json({ error: "NCC not found" });
    res.json({ relays, default_relays: RELAYS, proposals });
  } catch (error) {
    res.status(500).json({ error: "Failed to load proposals", detail: error.message });
  }
});

app.get("/api/health", (req, res) => {
  const relays = getRelaysFromRequest(req);
  res.json({ ok: true, relays });
});

app.listen(PORT, () => {
  console.log(`NCC Viewer running on http://localhost:${PORT}`);
});
