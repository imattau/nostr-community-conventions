(() => {
  const browserApi = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
  const DEFAULT_RELAYS = [
    'wss://nostr-pub.wellorder.net',
    'wss://relay.damus.io',
    'wss://eden.nostr.land',
    'wss://nostr.wine'
  ];
  
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

  const hexToBytes = (hex) => {
    if (!hex) return [];
    const cleaned = hex.toLowerCase().replace(/[^0-9a-f]/g, '');
    const bytes = [];
    for (let i = 0; i < cleaned.length; i += 2) {
      bytes.push(parseInt(cleaned.slice(i, i + 2), 16));
    }
    return bytes;
  };

  const convertBits = (data, fromBits, toBits, pad = true) => {
    let acc = 0;
    let bits = 0;
    const result = [];
    const maxv = (1 << toBits) - 1;
    for (const value of data) {
      if (value < 0 || value >> fromBits !== 0) return null;
      acc = (acc << fromBits) | value;
      bits += fromBits;
      while (bits >= toBits) {
        bits -= toBits;
        result.push((acc >> bits) & maxv);
      }
    }
    if (pad && bits > 0) {
      result.push((acc << (toBits - bits)) & maxv);
    } else if (bits >= toBits || ((acc << (toBits - bits)) & maxv)) {
      return null;
    }
    return result;
  };

  const bech32Polymod = (values) => {
    const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let chk = 1;
    for (const value of values) {
      const top = chk >> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ value;
      for (let i = 0; i < 5; i++) {
        if ((top >> i) & 1) {
          chk ^= GENERATORS[i];
        }
      }
    }
    return chk;
  };

  const bech32Expand = (hrp) => {
    const result = [];
    for (let i = 0; i < hrp.length; i++) {
      result.push(hrp.charCodeAt(i) >> 5);
    }
    result.push(0);
    for (let i = 0; i < hrp.length; i++) {
      result.push(hrp.charCodeAt(i) & 31);
    }
    return result;
  };

  const bech32CreateChecksum = (hrp, data) => {
    const values = [...bech32Expand(hrp), ...data, 0, 0, 0, 0, 0, 0];
    const polymod = bech32Polymod(values) ^ 1;
    const result = [];
    for (let i = 0; i < 6; i++) {
      result.push((polymod >> (5 * (5 - i))) & 31);
    }
    return result;
  };

  const bech32Encode = (hrp, data) => {
    const checksum = bech32CreateChecksum(hrp, data);
    const combined = [...data, ...checksum];
    return `${hrp}1${combined.map((v) => CHARSET[v]).join('')}`;
  };

  const hexToNpub = (hex) => {
    if (!hex) return null;
    const bytes = hexToBytes(hex);
    const fiveBit = convertBits(bytes, 8, 5);
    if (!fiveBit) return null;
    return bech32Encode('npub', fiveBit);
  };

  const relayInput = document.getElementById('relay-input');
  const refreshButton = document.getElementById('refresh-btn');
  const statusLabel = document.getElementById('status-label');
  const lastUpdatedLabel = document.getElementById('last-updated');
  const relayCountLabel = document.getElementById('relay-count');
  const serviceCountLabel = document.getElementById('service-count');
  const catalogList = document.getElementById('catalog-list');
  const serviceFilterInput = document.getElementById('service-filter');

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

  function renderMetadata(content) {
    if (!content) return null;
    let parsed = null;
    try {
      parsed = typeof content === 'string' ? JSON.parse(content) : content;
    } catch (err) {
      return [createMetadataRow('content', String(content))];
    }
    if (!parsed || typeof parsed !== 'object') {
      return [createMetadataRow('content', String(content))];
    }
    const rows = [];
    const keys = Object.keys(parsed).sort();
    for (const key of keys) {
      const value = parsed[key];
      rows.push(createMetadataRow(key, typeof value === 'string' ? value : JSON.stringify(value)));
    }
    return rows.length ? rows : null;
  }

  function createMetadataRow(label, text) {
    const row = document.createElement('div');
    row.className = 'metadata-row';
    const labelEl = document.createElement('span');
    labelEl.className = 'metadata-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'metadata-value';
    valueEl.textContent = text;
    row.appendChild(labelEl);
    row.appendChild(valueEl);
    return row;
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

      if (entry.pubkey) {
        const npubLine = document.createElement('p');
        npubLine.className = 'service-meta';
        npubLine.textContent = `NPub: ${hexToNpub(entry.pubkey) || 'invalid'}`;
        card.appendChild(npubLine);
      }

      const fingerprint = document.createElement('p');
      fingerprint.className = 'service-meta';
      fingerprint.textContent = entry.fingerprint ? `TLS fingerprint: ${entry.fingerprint}` : 'TLS fingerprint: unavailable';
      card.appendChild(fingerprint);

      const expiresLine = document.createElement('p');
      expiresLine.className = 'service-meta';
      expiresLine.textContent = `Expires: ${entry.expires_at ? formatTimestamp(entry.expires_at) : '—'}`;
      card.appendChild(expiresLine);

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

      const metadataBlock = document.createElement('div');
      metadataBlock.className = 'service-metadata';
      metadataBlock.appendChild(document.createTextNode('Metadata'));
      const metadataRows = renderMetadata(entry.content);
      if (metadataRows && Array.isArray(metadataRows)) {
        metadataRows.forEach(row => metadataBlock.appendChild(row));
      } else {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = 'No metadata available.';
        metadataBlock.appendChild(empty);
      }
      card.appendChild(metadataBlock);

      const extra = document.createElement('div');
      extra.className = 'service-meta';
      const lastSeen = formatTimestamp(entry.last_seen_at);
      extra.textContent = `Last seen: ${lastSeen}`;
      card.appendChild(extra);

      catalogList.appendChild(card);
    });
  }

  let latestResponse = null;
  let filterValues = [];

  function parseServiceFilter(value) {
    if (!value) return [];
    return Array.from(new Set(value.split(/[\s,]+/).map(v => v.trim().toLowerCase()).filter(Boolean)));
  }

  function filterCatalogEntries(response) {
    if (!response?.catalog) return [];
    if (!filterValues.length) return response.catalog;
    return response.catalog.filter(entry => {
      const target = entry.serviceId?.toLowerCase();
      return target && filterValues.includes(target);
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
    latestResponse = response;
    const visibleCatalog = filterCatalogEntries(response);
    serviceCountLabel.textContent = String(visibleCatalog.length);
    if (showStatus) {
      statusLabel.textContent = metadata?.status?.success ? 'Catalogue refreshed' : 'Some relays didn\'t respond';
      statusLabel.style.color = metadata?.status?.success ? '#16a34a' : '#b45309';
    }
    renderCatalog(visibleCatalog);
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
  serviceFilterInput.addEventListener('input', () => {
    filterValues = parseServiceFilter(serviceFilterInput.value);
    if (!latestResponse) return;
    const visibleCatalog = filterCatalogEntries(latestResponse);
    serviceCountLabel.textContent = String(visibleCatalog.length);
    renderCatalog(visibleCatalog);
  });

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
