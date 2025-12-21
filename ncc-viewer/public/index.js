import { shorten, formatTimestamp } from "./app.js";

const listEl = document.getElementById("ncc-list");
const relayCount = document.getElementById("relay-count");

function renderEmpty(message) {
  listEl.innerHTML = `<div class="empty">${message}</div>`;
}

function renderList(items) {
  if (!items.length) {
    renderEmpty("No NCC documents found on connected relays yet.");
    return;
  }

  listEl.innerHTML = items
    .map((item, index) => {
      const title = item.title || "Untitled";
      const published = formatTimestamp(item.published_at);
      const summary = item.summary || "No summary provided.";
      const steward = item.steward ? shorten(item.steward) : "Unknown";
      const endorsements = item.endorsements || 0;
      return `
        <article class="card list-item" style="animation-delay: ${index * 40}ms">
          <a href="/ncc.html?d=${encodeURIComponent(item.d)}">
            <h3>${item.d.toUpperCase()} · ${title}</h3>
          </a>
          <p class="muted">${summary}</p>
          <div class="meta">
            <span>Steward: ${steward}</span>
            <span>Published: ${published || "unknown"}</span>
            <a class="link" href="/endorsements.html?d=${encodeURIComponent(item.d)}">Endorsements: ${endorsements}</a>
          </div>
        </article>
      `;
    })
    .join("");
}

async function load() {
  try {
    const response = await fetch("/api/nccs");
    if (!response.ok) throw new Error("Failed to load");
    const data = await response.json();
    relayCount.textContent = `Relays: ${data.relays.length}`;
    renderList(data.items || []);
  } catch (error) {
    renderEmpty("Unable to fetch NCC data right now.");
  }
}

load();
