// src/utils.js
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

export function esc(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

export function shortenKey(value, head = 6, tail = 4) {
  if (!value) return "";
  if (value.length <= head + tail + 1) return value;
  if (tail === 0) return value.slice(0, head) + "…";
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function formatCacheAge(timestamp) {
  if (!timestamp) return "just now";
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
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

export function renderMarkdown(content) {
  if (!content) return "";
  const raw = marked.parse(content, markdownOptions);
  return sanitizeHtml(raw, markdownSanitizeOptions);
}

export function splitList(value) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function uniq(list) {
  return [...new Set(list.filter(Boolean))];
}

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function stripNccNumber(value) {
  if (!value) return "";
  const trimmed = String(value).trim().toLowerCase();
  const withoutPrefix = trimmed.replace(/^ncc-/, "");
  return withoutPrefix.replace(/\D/g, "");
}

export function buildNccIdentifier(numberValue) {
  const digits = stripNccNumber(numberValue);
  if (!digits) return "";
  return `ncc-${digits}`;
}

export function suggestNextNccNumber(nccDocs) {
  if (!Array.isArray(nccDocs) || nccDocs.length === 0) return "01";
  
  const numbers = nccDocs
    .map(doc => {
      const d = eventTagValue(doc.tags || [], "d");
      return parseInt(stripNccNumber(d), 10);
    })
    .filter(n => !isNaN(n));

  if (numbers.length === 0) return "01";
  
  const next = Math.max(...numbers) + 1;
  return next.toString().padStart(2, "0");
}

export function incrementVersion(version) {
  if (!version) return "1";
  const match = version.match(/^([^0-9]*)([0-9]+)([^0-9]*)$/);
  if (!match) return version;
  const [_, prefix, num, suffix] = match;
  return `${prefix}${parseInt(num, 10) + 1}${suffix}`;
}

export function buildDraftIdentifier(dValue) {
  if (!dValue) return "";
  return `draft:${dValue}`;
}

export function isDraftIdentifier(value) {
  if (!value) return false;
  return value.toString().trim().toLowerCase().startsWith("draft:");
}

export function stripDraftPrefix(value) {
  if (!value) return "";
  return value.toString().trim().replace(/^draft:/, "");
}

export function isNccIdentifier(value) {
  if (!value) return false;
  return value.toString().trim().toLowerCase().startsWith("ncc-");
}

export function eventTagValue(tags, name) {
  if (!Array.isArray(tags)) return "";
  const found = tags.find((tag) => tag[0] === name);
  return found ? found[1] : "";
}

export function normalizeEventId(value) {
  if (!value) return "";
  return value
    .replace(/^event:/i, "")
    .trim()
    .toLowerCase();
}

export function normalizeHexId(value) {
  if (!value) return "";
  return value.trim().toLowerCase();
}

export function isNccDocument(event) {
  const dValue = eventTagValue(event.tags, "d");
  return dValue && dValue.toLowerCase().startsWith("ncc-");
}

export function buildNccOptions(events) {
  const grouped = {};
  for (const event of events) {
    const dValue = eventTagValue(event.tags, "d");
    if (!dValue || !dValue.toLowerCase().startsWith("ncc-")) continue;
    if (!grouped[dValue]) grouped[dValue] = [];
    grouped[dValue].push(event);
  }
  return Object.keys(grouped)
    .sort()
    .map((dValue) => ({
      d: dValue,
      events: grouped[dValue]
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
        .map((event) => ({
          id: event.id,
          title: eventTagValue(event.tags, "title"),
          created_at: event.created_at || 0
        }))
    }));
}

export function isOnline() {
  if (typeof window === "undefined") return true;
  return navigator.onLine;
}

export function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}
