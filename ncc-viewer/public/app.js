export function shorten(value, head = 8, tail = 6) {
  if (!value) return "";
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function formatTimestamp(seconds) {
  if (!seconds) return "";
  const date = new Date(seconds * 1000);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit"
  });
}

export function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

const RELAY_STORAGE_KEY = "ncc-viewer-relays";

function normalizeRelay(value) {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  const hasScheme = /^[a-z]+:\/\//i.test(trimmed);
  const withScheme = hasScheme ? trimmed : `wss://${trimmed}`;
  if (!/^wss?:\/\//i.test(withScheme)) return "";
  return withScheme;
}

export function getRelayOverrides() {
  const raw = window.localStorage.getItem(RELAY_STORAGE_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.map(normalizeRelay).filter(Boolean);
  } catch (error) {
    return [];
  }
}

export function saveRelayOverrides(relays) {
  const sanitized = relays.map(normalizeRelay).filter(Boolean).slice(0, 10);
  window.localStorage.setItem(RELAY_STORAGE_KEY, JSON.stringify(sanitized));
  return sanitized;
}

export function buildApiUrl(path, params = {}) {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });
  const relays = getRelayOverrides();
  if (relays.length) {
    url.searchParams.set("relays", relays.join(","));
  }
  return url.pathname + url.search;
}

export function getRelayCacheKey(baseKey) {
  const relays = getRelayOverrides();
  return `${baseKey}:${relays.join("|")}`;
}

export function setRelayCount(count) {
  const toggle = document.getElementById("relay-toggle");
  if (toggle) toggle.textContent = `Relays: ${count}`;
}

export function initRelayControls(onRelaysChange) {
  const toggle = document.getElementById("relay-toggle");
  const panel = document.getElementById("relay-panel");
  const listEl = document.getElementById("relay-list");
  const inputEl = document.getElementById("relay-input");
  const addBtn = document.getElementById("relay-add");
  const clearBtn = document.getElementById("relay-clear");
  const closeBtn = document.getElementById("relay-close");

  if (!toggle || !panel || !listEl || !inputEl || !addBtn || !clearBtn || !closeBtn) {
    return;
  }

  function render() {
    const relays = getRelayOverrides();
    if (!relays.length) {
      listEl.innerHTML = `<li class="muted">No extra relays added.</li>`;
      return;
    }
    listEl.innerHTML = relays
      .map(
        (relay) =>
          `<li><span>${relay}</span><button class="link-button" data-relay="${relay}">Remove</button></li>`
      )
      .join("");
  }

  function closePanel() {
    panel.hidden = true;
  }

  function openPanel() {
    panel.hidden = false;
  }

  function update(relays) {
    saveRelayOverrides(relays);
    render();
    if (typeof onRelaysChange === "function") onRelaysChange();
  }

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    if (panel.hidden) openPanel();
    else closePanel();
  });

  closeBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closePanel();
  });

  addBtn.addEventListener("click", () => {
    const value = normalizeRelay(inputEl.value);
    if (!value) return;
    const relays = getRelayOverrides();
    if (!relays.includes(value)) {
      relays.push(value);
      update(relays);
    }
    inputEl.value = "";
  });

  clearBtn.addEventListener("click", () => {
    update([]);
  });

  listEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const relay = target.getAttribute("data-relay");
    if (!relay) return;
    const relays = getRelayOverrides().filter((item) => item !== relay);
    update(relays);
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    if (panel.contains(event.target) || toggle.contains(event.target)) return;
    closePanel();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePanel();
  });

  render();
}
