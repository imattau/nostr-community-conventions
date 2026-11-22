import {
  shorten,
  formatTimestamp,
  getQueryParam,
  initRelayControls,
  setRelayCount,
  setDefaultRelays
} from "./app.js";
import { loadData } from "./data.js";
import { initSigner } from "./signer.js";

const titleEl = document.getElementById("proposal-title");
const subtitleEl = document.getElementById("proposal-subtitle");
const listEl = document.getElementById("proposal-list");

function renderEmpty(message) {
  listEl.innerHTML = `<div class="empty">${message}</div>`;
}

function renderList(items, dTag) {
  if (!items.length) {
    renderEmpty("No proposals for this NCC yet.");
    return;
  }

  listEl.innerHTML = items
    .map((item, index) => {
      const summary = item.summary || "No summary provided.";
      return `
        <article class="card list-item" style="animation-delay: ${index * 40}ms">
          <a href="/ncc.html?d=${encodeURIComponent(dTag)}&event=${encodeURIComponent(item.event_id)}">
            <h3>${item.title}</h3>
          </a>
          <p class="muted">${summary}</p>
          <div class="meta">
            <span>Published: ${formatTimestamp(item.published_at) || "unknown"}</span>
            <span>Author: ${shorten(item.pubkey)}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

async function load() {
  const dTag = getQueryParam("d");
  if (!dTag) {
    renderEmpty("Missing NCC identifier.");
    return;
  }

  titleEl.textContent = `Proposals · ${dTag.toUpperCase()}`;
  subtitleEl.textContent = "Alternative NCC documents discovered on relays.";

  try {
    const { data, relays, default_relays } = await loadData();
    const proposals = data.proposals(dTag);
    if (!proposals) throw new Error("NCC not found");
    setDefaultRelays(default_relays);
    setRelayCount(relays.length);
    renderList(proposals, dTag);
  } catch (error) {
    renderEmpty("Unable to load proposals right now.");
  }
}

initRelayControls(() => load());
initSigner();
load();
