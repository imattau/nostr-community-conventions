import { SimplePool } from "nostr-tools/pool";
import { marked } from "marked";
import { getRelayOverrides } from "./app.js";

const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://nostr.wine",
  "wss://relay.primal.net",
  "wss://nostr-01.yakihonne.com"
];
const pool = new SimplePool();
const cache = new Map();
const KINDS = { ncc: 30050, nsr: 30051, endorsement: 30052 };

export function getRelays() {
  const relays = [...DEFAULT_RELAYS];
  for (const relay of getRelayOverrides()) if (!relays.includes(relay)) relays.push(relay);
  return relays;
}

function values(event, name) {
  return (event?.tags || []).filter((tag) => tag[0] === name).map((tag) => tag[1]).filter(Boolean);
}
function value(event, name) { return values(event, name)[0] || ""; }
function norm(value) { return (value || "").trim().toLowerCase(); }
function published(event) { return Number(value(event, "published_at")) || Number(event.created_at || 0); }
function latest(events) {
  return [...(events || [])].sort((a, b) => published(b) - published(a))[0] || null;
}
function steward(doc, records) {
  const record = latest((records || []).filter((item) => norm(value(item, "authoritative").replace(/^event:/, "")) === norm(doc.id)));
  return record ? (value(record, "steward").split(":").pop() || record.pubkey) : doc.pubkey;
}

// Markdown is rendered in the browser and then reduced to a small safe element/attribute set.
function renderMarkdown(content) {
  const template = document.createElement("template");
  template.innerHTML = marked.parse(content || "", { async: false });
  const allowed = new Set(["A", "P", "BR", "STRONG", "EM", "UL", "OL", "LI", "BLOCKQUOTE", "CODE", "PRE", "H1", "H2", "H3", "H4", "H5", "H6", "HR"]);
  for (const element of [...template.content.querySelectorAll("*")].reverse()) {
    if (!allowed.has(element.tagName)) {
      element.replaceWith(...element.childNodes);
      continue;
    }
    for (const attr of [...element.attributes]) {
      if (element.tagName === "A" && ["href", "name", "target", "rel"].includes(attr.name)) continue;
      if (element.tagName === "CODE" && attr.name === "class") continue;
      element.removeAttribute(attr.name);
    }
    if (element.tagName === "A") {
      const href = element.getAttribute("href") || "";
      if (!/^(https?:|mailto:|#|\/)/i.test(href)) element.removeAttribute("href");
      element.setAttribute("rel", "noopener noreferrer");
    }
  }
  return template.innerHTML;
}

function buildIndex(events) {
  const docsByD = new Map(), nsrByD = new Map(), endorsementsByEvent = new Map();
  for (const event of events) {
    const d = norm(value(event, "d"));
    if (!d.startsWith("ncc-")) continue;
    if (event.kind === KINDS.ncc || event.kind === KINDS.nsr) {
      const target = event.kind === KINDS.ncc ? docsByD : nsrByD;
      target.set(d, [...(target.get(d) || []), event]);
    } else if (event.kind === KINDS.endorsement) {
      const id = norm(value(event, "endorses").replace(/^event:/, ""));
      if (id) endorsementsByEvent.set(id, [...(endorsementsByEvent.get(id) || []), event]);
    }
  }
  return { docsByD, nsrByD, endorsementsByEvent };
}

function buildList(index) {
  return [...index.docsByD].map(([d, docs]) => {
    const doc = latest(docs), records = index.nsrByD.get(d) || [];
    return { d, number: Number(/ncc-(\d+)/i.exec(d)?.[1] || 0) || null, title: value(doc, "title") || "Untitled",
      steward: steward(doc, records), event_id: doc.id, published_at: published(doc), summary: value(doc, "summary"),
      endorsements: (index.endorsementsByEvent.get(norm(doc.id)) || []).length };
  }).sort((a, b) => a.number !== null && b.number !== null ? a.number - b.number : a.d.localeCompare(b.d));
}

function buildProposals(docs, current) {
  return docs.filter((event) => event.id !== current.id).map((event) => ({ event_id: event.id, published_at: published(event),
    title: value(event, "title") || "Untitled", summary: value(event, "summary"), pubkey: event.pubkey, content_html: renderMarkdown(event.content) }))
    .sort((a, b) => b.published_at - a.published_at);
}

function makeData(index) {
  const items = buildList(index);
  return {
    list: () => items,
    details(d, eventId = "") {
      const docs = index.docsByD.get(norm(d)) || [];
      const current = docs.find((doc) => norm(doc.id) === norm(eventId)) || latest(docs);
      if (!current) return null;
      const records = index.nsrByD.get(norm(d)) || [], endorsements = index.endorsementsByEvent.get(norm(current.id)) || [];
      const proposals = buildProposals(docs, current);
      const byRole = {};
      endorsements.forEach((event) => { const role = value(event, "role") || "unknown"; byRole[role] = (byRole[role] || 0) + 1; });
      return { d: norm(d), title: value(current, "title") || "Untitled", event_id: current.id, pubkey: current.pubkey,
        published_at: published(current), summary: value(current, "summary"), content: current.content || "", content_html: renderMarkdown(current.content),
        steward: steward(current, records), endorsements_count: endorsements.length, proposals_count: proposals.length,
        nsr: records.map((event) => ({ event_id: event.id, pubkey: event.pubkey, steward: value(event, "steward").split(":").pop() || event.pubkey,
          authoritative: value(event, "authoritative"), previous: value(event, "previous"), reason: value(event, "reason"),
          effective_at: Number(value(event, "effective_at")) || null, content: event.content || "", created_at: event.created_at || null }))
          .sort((a, b) => (b.created_at || 0) - (a.created_at || 0)) };
    },
    endorsements(d) {
      const current = latest(index.docsByD.get(norm(d)) || []);
      if (!current) return null;
      return (index.endorsementsByEvent.get(norm(current.id)) || []).map((event) => ({ event_id: event.id, pubkey: event.pubkey,
        created_at: event.created_at || null, role: value(event, "role"), implementation: value(event, "implementation"),
        note: value(event, "note"), content: event.content || "" })).sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    },
    proposals(d) { const docs = index.docsByD.get(norm(d)) || [], current = latest(docs); return current ? buildProposals(docs, current) : null; }
  };
}

export async function loadData() {
  const relays = getRelays(), key = relays.join(",");
  if (!cache.has(key)) cache.set(key, pool.querySync(relays, { kinds: Object.values(KINDS) }, { maxWait: 5000 }).then((events) => makeData(buildIndex(events))));
  try { return { data: await cache.get(key), relays, default_relays: DEFAULT_RELAYS }; }
  catch (error) { cache.delete(key); throw error; }
}
