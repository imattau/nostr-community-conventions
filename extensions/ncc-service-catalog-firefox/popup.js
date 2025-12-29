(() => {
  const browserApi = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
  const DEFAULT_RELAYS = [
    'wss://nostr-pub.wellorder.net',
    'wss://relay.damus.io',
    'wss://eden.nostr.land',
    'wss://nostr.wine'
  ];

  const relayInput = document.getElementById('relay-input');
  const refreshButton = document.getElementById('refresh-btn');
  const statusLabel = document.getElementById('status-label');
  const lastUpdatedLabel = document.getElementById('last-updated');
  const relayCountLabel = document.getElementById('relay-count');
  const serviceCountLabel = document.getElementById('service-count');
  const catalogList = document.getElementById('catalog-list');

  function sendMessage(payload) {
    return new Promise((resolve, reject) => {
      if (!browserApi?.runtime?.sendMessage) {
        return reject(new Error('runtime messaging unavailable'));
      }
      browserApi.runtime.sendMessage(payload, (response) => {
        const lastError = browserApi.runtime.lastError;
        if (lastError) {
          return reject(lastError);
        }
        resolve(response);
      });
    });
  }

  function formatTimestamp(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString();
  }

  function normalizeRelays(value) {
    if (!value) return DEFAULT_RELAYS;
    const values = value.split(/[\s,]+/).map(entry => entry.trim()).filter(Boolean);
    return values.length ? values : DEFAULT_RELAYS;
  }

  function renderCatalog(entries) {
    catalogList.innerHTML = '';

    if (!entries || entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No catalogue data yet. Click refresh to query relays.';
      catalogList.appendChild(empty);
      return;
    }

    entries.forEach(entry => {
      const card = document.createElement('article');
      card.className = 'service-card';

      const title = document.createElement('h3');
      title.textContent = entry.name || entry.serviceId;
      card.appendChild(title);

      const meta = document.createElement('p');
      meta.className = 'service-meta';
      meta.textContent = `${entry.serviceId} · ${entry.pubkey}`;
      card.appendChild(meta);

      const fingerprint = document.createElement('p');
      fingerprint.className = 'service-meta';
      fingerprint.textContent = entry.fingerprint ? `TLS fingerprint: ${entry.fingerprint}` : 'TLS fingerprint: unavailable';
      card.appendChild(fingerprint);

      const endpoints = document.createElement('div');
      endpoints.className = 'service-endpoint';
      const label = document.createElement('span');
      label.textContent = 'Endpoints:';
      endpoints.appendChild(label);

      if (entry.endpoints && entry.endpoints.length > 0) {
        entry.endpoints.forEach(endpoint => {
          const code = document.createElement('code');
          code.textContent = endpoint;
          endpoints.appendChild(code);
        });
      } else {
        const muted = document.createElement('span');
        muted.className = 'muted';
        muted.textContent = 'No endpoints advertised.';
        endpoints.appendChild(muted);
      }

      card.appendChild(endpoints);

      const extra = document.createElement('div');
      extra.className = 'service-meta';
      const lastSeen = formatTimestamp(entry.last_seen_at);
      extra.textContent = `Last seen: ${lastSeen}`;
      card.appendChild(extra);

      catalogList.appendChild(card);
    });
  }

  async function applyResponse(response, showStatus = true) {
    if (!response) return;
    const { catalog, metadata, error } = response;
    if (error) {
      statusLabel.textContent = `Error: ${error}`;
      statusLabel.style.color = '#dc2626';
      return;
    }

    const now = metadata?.lastUpdated ? formatTimestamp(metadata.lastUpdated) : '—';
    lastUpdatedLabel.textContent = now;
    const relays = metadata?.lastRelays || DEFAULT_RELAYS;
    relayCountLabel.textContent = String(relays.length);
    serviceCountLabel.textContent = String(catalog?.length || 0);
    if (showStatus) {
      statusLabel.textContent = metadata?.status?.success ? 'Catalogue refreshed' : 'Some relays didn\'t respond';
      statusLabel.style.color = metadata?.status?.success ? '#16a34a' : '#b45309';
    }
    renderCatalog(catalog);
    relayInput.value = relays.join('\n');
  }

  async function handleRefresh() {
    refreshButton.disabled = true;
    statusLabel.textContent = 'Querying relays…';
    statusLabel.style.color = '#2563eb';
    try {
      const relays = normalizeRelays(relayInput.value);
      const response = await sendMessage({ type: 'refreshCatalog', relays });
      await applyResponse(response);
    } catch (err) {
      statusLabel.textContent = `Error: ${err.message || 'failed to refresh'}`;
      statusLabel.style.color = '#dc2626';
    } finally {
      refreshButton.disabled = false;
    }
  }

  refreshButton.addEventListener('click', handleRefresh);

  window.addEventListener('DOMContentLoaded', async () => {
    try {
      const response = await sendMessage({ type: 'getCatalog' });
      await applyResponse(response, false);
    } catch (err) {
      statusLabel.textContent = `Error: ${err.message || 'unable to load catalog'}`;
      statusLabel.style.color = '#dc2626';
    }
  });
})();
