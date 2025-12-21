import {
  shorten,
  formatTimestamp,
  buildApiUrl,
  getRelayCacheKey,
  initRelayControls,
  setRelayCount
} from "./app.js";

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

let defaultRelays = [];

async function load() {
  const cacheKey = getRelayCacheKey(CACHE_KEY);
  const cachedRaw = window.localStorage.getItem(cacheKey);
  if (cachedRaw) {
    try {
      const cached = JSON.parse(cachedRaw);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        setRelayCount(cached.relays?.length || 0);
        defaultRelays = cached.default_relays || defaultRelays;
        renderList(cached.items || []);
        return;
      }
    } catch (error) {
      window.localStorage.removeItem(cacheKey);
    }
  }

  try {
    const response = await fetch(buildApiUrl("/api/nccs"));
    if (!response.ok) throw new Error("Failed to load");
    const data = await response.json();
    setRelayCount(data.relays.length);
    defaultRelays = data.default_relays || defaultRelays;
    renderList(data.items || []);
    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({
        at: Date.now(),
        relays: data.relays,
        default_relays: data.default_relays,
        items: data.items
      })
    );
  } catch (error) {
    renderEmpty("Unable to fetch NCC data right now.");
  }
}

initRelayControls(() => defaultRelays, () => load());
load();
