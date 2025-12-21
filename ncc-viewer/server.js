import express from "express";
import WebSocket from "ws";

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
const CACHE_TTL_MS = Number(process.env.NCC_CACHE_TTL_MS || 60_000);
const SINCE_SECONDS = Number(process.env.NCC_SINCE_SECONDS || 0);

let cacheState = {
  at: 0,
  data: null,
  pending: null
};

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

function isNccDTag(value) {
  return normalizeId(value).startsWith("ncc-");
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

async function fetchEvents() {
  const filter = {
    kinds: [KIND_NCC, KIND_NSR, KIND_ENDORSEMENT]
  };
  if (SINCE_SECONDS > 0) filter.since = SINCE_SECONDS;

  try {
    const events = await pool.querySync(RELAYS, filter, { maxWait: 4000 });
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

function buildDetails(dTag, index) {
  const docs = index.docsByD.get(dTag) || [];
  const current = pickCurrentDoc(docs);
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
    steward: resolveSteward(current, index.nsrByD.get(dTag) || []),
    endorsements_count: endorsements.length,
    endorsements_by_role: endorsementsByRole,
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

async function getData() {
  const now = Date.now();
  if (cacheState.data && now - cacheState.at < CACHE_TTL_MS) return cacheState.data;
  if (cacheState.pending) return cacheState.pending;

  cacheState.pending = fetchEvents()
    .then((events) => {
      const index = buildIndex(events);
      const list = buildList(index);
      const payload = { index, list };
      cacheState = { at: Date.now(), data: payload, pending: null };
      return payload;
    })
    .catch((error) => {
      cacheState.pending = null;
      throw error;
    });

  return cacheState.pending;
}

app.use(express.static("public"));

app.get("/api/nccs", async (req, res) => {
  try {
    const data = await getData();
    res.json({ relays: RELAYS, items: data.list });
  } catch (error) {
    res.status(500).json({ error: "Failed to load NCCs", detail: error.message });
  }
});

app.get("/api/nccs/:d", async (req, res) => {
  try {
    const data = await getData();
    const dTag = normalizeId(req.params.d);
    const details = buildDetails(dTag, data.index);
    if (!details) return res.status(404).json({ error: "NCC not found" });
    res.json({ relays: RELAYS, details });
  } catch (error) {
    res.status(500).json({ error: "Failed to load NCC", detail: error.message });
  }
});

app.get("/api/nccs/:d/endorsements", async (req, res) => {
  try {
    const data = await getData();
    const dTag = normalizeId(req.params.d);
    const endorsements = buildEndorsements(dTag, data.index);
    if (!endorsements) return res.status(404).json({ error: "NCC not found" });
    res.json({ relays: RELAYS, endorsements });
  } catch (error) {
    res.status(500).json({ error: "Failed to load endorsements", detail: error.message });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, relays: RELAYS });
});

app.listen(PORT, () => {
  console.log(`NCC Viewer running on http://localhost:${PORT}`);
});
