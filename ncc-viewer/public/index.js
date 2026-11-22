import {
  shorten,
  formatTimestamp,
  getRelayCacheKey,
  initRelayControls,
  setRelayCount,
  setDefaultRelays
} from "./app.js";
import { loadData } from "./data.js";
import { initSigner } from "./signer.js";

const listEl = document.getElementById("ncc-list");
const CACHE_KEY = "ncc-viewer-cache";
const CACHE_TTL_MS = 600_000;

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
  const cacheKey = getRelayCacheKey(CACHE_KEY);
  const cachedRaw = window.localStorage.getItem(cacheKey);
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        setRelayCount(cached.relays?.length || 0);
        if (cached.default_relays) setDefaultRelays(cached.default_relays);
        renderList(cached.items || []);
        return;
      }
    } catch (error) {
      window.localStorage.removeItem(cacheKey);
    }
  }

  try {
    const { data, relays, default_relays } = await loadData();
    setRelayCount(relays.length);
    setDefaultRelays(default_relays);
    renderList(data.list());
    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({
        at: Date.now(),
        relays,
        default_relays,
        items: data.list()
      })
    );
  } catch (error) {
    renderEmpty("Unable to fetch NCC data right now.");
  }
}

initRelayControls(() => load());
initSigner();
load();
