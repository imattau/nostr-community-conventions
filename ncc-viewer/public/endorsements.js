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

const titleEl = document.getElementById("endorsement-title");
const subtitleEl = document.getElementById("endorsement-subtitle");
const listEl = document.getElementById("endorsement-list");

function renderEmpty(message) {
  listEl.innerHTML = `<div class="empty">${message}</div>`;
}

function renderList(items) {
  if (!items.length) {
    renderEmpty("No endorsements recorded for this NCC yet.");
    return;
  }

  listEl.innerHTML = items
    .map((item, index) => {
      const role = item.role || "unknown";
      const content = item.content || "";
      const note = item.note || "";
      const implementation = item.implementation || "";
      return `
        <article class="card list-item" style="animation-delay: ${index * 40}ms">
          <strong>${shorten(item.pubkey)}</strong>
          <div class="meta">
            <span>Role: ${role}</span>
            <span>Created: ${formatTimestamp(item.created_at) || "unknown"}</span>
          </div>
          ${implementation ? `<div class="badge">${implementation}</div>` : ""}
          ${note ? `<p class="muted">${note}</p>` : ""}
          ${content ? `<p>${content}</p>` : ""}
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

  titleEl.textContent = `Endorsements · ${dTag.toUpperCase()}`;
  subtitleEl.textContent = "Signals of adoption and support from the ecosystem.";

  try {
    const { data, relays, default_relays } = await loadData();
    const endorsements = data.endorsements(dTag);
    if (!endorsements) throw new Error("NCC not found");
    setDefaultRelays(default_relays);
    setRelayCount(relays.length);
    renderList(endorsements);
  } catch (error) {
    renderEmpty("Unable to load endorsements right now.");
  }
}

initRelayControls(() => load());
initSigner();
load();
