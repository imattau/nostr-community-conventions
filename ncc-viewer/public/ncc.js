import { shorten, formatTimestamp, getQueryParam } from "./app.js";

const titleEl = document.getElementById("ncc-title");
const subtitleEl = document.getElementById("ncc-subtitle");
const summaryEl = document.getElementById("ncc-summary");
const contentEl = document.getElementById("ncc-content");
const stewardEl = document.getElementById("ncc-steward");
const publishedEl = document.getElementById("ncc-published");
const endorsementsEl = document.getElementById("ncc-endorsements");
const nsrEl = document.getElementById("ncc-nsr");

function renderEmpty() {
  contentEl.textContent = "NCC not found on connected relays.";
}

function renderNSR(records) {
  if (!records || records.length === 0) {
    nsrEl.innerHTML = `<div class="empty">No succession records yet.</div>`;
    return;
  }

  nsrEl.innerHTML = records
    .map((record, index) => {
      const steward = record.steward ? shorten(record.steward) : "Unknown";
      const created = formatTimestamp(record.created_at);
      const reason = record.reason || "No reason provided.";
      return `
        <article class="card list-item" style="animation-delay: ${index * 50}ms">
          <strong>Steward: ${steward}</strong>
          <div class="meta">
            <span>Created: ${created || "unknown"}</span>
            <span>Authoritative: ${shorten(record.authoritative || "")}</span>
          </div>
          <p class="muted">${reason}</p>
        </article>
      `;
    })
    .join("");
}

async function load() {
  const dTag = getQueryParam("d");
  if (!dTag) return renderEmpty();

  try {
    const response = await fetch(`/api/nccs/${encodeURIComponent(dTag)}`);
    if (!response.ok) throw new Error("Failed to load");
    const data = await response.json();
    const details = data.details;

    titleEl.textContent = `${details.d.toUpperCase()} · ${details.title}`;
    subtitleEl.textContent = `Event: ${shorten(details.event_id)} · Pubkey: ${shorten(details.pubkey)}`;
    summaryEl.textContent = details.summary || "No summary provided.";
    contentEl.textContent = details.content || "No document content available.";
    stewardEl.textContent = details.steward ? shorten(details.steward) : "Unknown";
    publishedEl.textContent = formatTimestamp(details.published_at) || "unknown";
    endorsementsEl.textContent = details.endorsements_count ?? 0;
    endorsementsEl.href = `/endorsements.html?d=${encodeURIComponent(details.d)}`;

    renderNSR(details.nsr || []);
  } catch (error) {
    renderEmpty();
  }
}

load();
