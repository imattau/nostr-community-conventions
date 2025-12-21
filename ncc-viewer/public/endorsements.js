import {
  shorten,
  formatTimestamp,
  getQueryParam,
  buildApiUrl,
  initRelayControls,
  setRelayCount
} from "./app.js";

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
    const response = await fetch(buildApiUrl(`/api/nccs/${encodeURIComponent(dTag)}/endorsements`));
    if (!response.ok) throw new Error("Failed to load");
    const data = await response.json();
    setRelayCount(data.relays.length);
    renderList(data.endorsements || []);
  } catch (error) {
    renderEmpty("Unable to load endorsements right now.");
  }
}

initRelayControls(() => load());
load();
