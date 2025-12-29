(() => {
  const browserApi = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
  const storage = browserApi?.storage?.local;
  const SERVICE_KIND = 30059;
  const QUERY_TIMEOUT_MS = 15_000;
  const DEFAULT_RELAYS = [
    'wss://nostr-pub.wellorder.net',
    'wss://relay.damus.io',
    'wss://eden.nostr.land',
    'wss://nostr.wine'
  ];

  const catalogMap = new Map();
  let lastRelays = [...DEFAULT_RELAYS];
  let lastUpdated = null;
  let lastStatus = { success: false, errors: [] };

  function normalizeRelayList(values) {
    const unique = new Map();
    let sources = [];
    if (Array.isArray(values)) {
      sources = values;
    } else if (typeof values === 'string') {
      sources = values.split(/[\\s,]+/);
    }
    for (const raw of sources) {
      if (!raw) continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const url = trimmed.replace(/^https?:\/\//i, match => (match.startsWith('https') ? 'wss://' : 'ws://'));
      if (!url.startsWith('ws://') && !url.startsWith('wss://')) continue;
      unique.set(url, true);
    }
    if (unique.size === 0) {
      for (const relay of DEFAULT_RELAYS) {
        unique.set(relay, true);
      }
    }
    return Array.from(unique.keys());
  }

  function storageGet(keys) {
    if (!storage) return Promise.resolve({});
    return new Promise((resolve) => {
      storage.get(keys, (result) => {
        resolve(result || {});
      });
    });
  }

  function storageSet(value) {
    if (!storage) return Promise.resolve();
    return new Promise((resolve) => {
      storage.set(value, () => {
        resolve();
      });
    });
  }

  function getTagValue(tags, key) {
    if (!Array.isArray(tags)) return null;
    const tag = tags.find(t => Array.isArray(t) && t[0] === key);
    return tag && tag[1] ? String(tag[1]) : null;
  }

  function parseContent(content) {
    if (!content) return {};
    try {
      return JSON.parse(content);
    } catch (err) {
      return { raw: content };
    }
  }

  function mergeEndpoints(existing = [], incoming = []) {
    const set = new Set(existing);
    for (const value of incoming) {
      if (value) set.add(value);
    }
    return Array.from(set);
  }

  function formatResponseEntries() {
    const entries = Array.from(catalogMap.values()).sort((a, b) => {
      const aName = (a.name || a.serviceId || '').toLowerCase();
      const bName = (b.name || b.serviceId || '').toLowerCase();
      return aName.localeCompare(bName);
    });

    return entries.map(entry => ({
      serviceId: entry.serviceId,
      name: entry.name,
      about: entry.about,
      pubkey: entry.pubkey,
      fingerprint: entry.fingerprint,
      endpoints: entry.endpoints,
      relays: entry.relays,
      created_at: entry.created_at,
      expires_at: entry.expires_at,
      last_seen_at: entry.last_seen_at,
      content: entry.content
    }));
  }

  function persistCatalog() {
    return storageSet({ serviceCatalog: Array.from(catalogMap.values()) });
  }

  function persistMetadata() {
    return storageSet({ catalogMetadata: { lastUpdated, lastRelays, lastStatus } });
  }

  function buildResponse() {
    return {
      catalog: formatResponseEntries(),
      metadata: {
        lastUpdated,
        lastRelays,
        status: lastStatus
      }
    };
  }

  function isNcc02Event(event) {
    if (!event || event.kind !== SERVICE_KIND) return false;
    if (!event.pubkey || typeof event.pubkey !== 'string') return false;
    const serviceId = getTagValue(event.tags, 'd');
    if (!serviceId) return false;
    const fingerprint = getTagValue(event.tags, 'k');
    if (!fingerprint) return false;
    return true;
  }

  function handleServiceEvent(event, relayUrl) {
    if (!isNcc02Event(event)) return;
    const tags = event.tags || [];
    const serviceId = getTagValue(tags, 'd') || event.pubkey;
    if (!serviceId) return;

    const endpoints = tags
      .filter(tag => Array.isArray(tag) && tag[0] === 'u')
      .map(tag => tag[1])
      .filter(Boolean);

    const fingerprint = getTagValue(tags, 'k') || null;
    const expiresAtTag = getTagValue(tags, 'expiration') || getTagValue(tags, 'exp');
    const expiresAt = expiresAtTag ? parseInt(expiresAtTag, 10) * 1000 : null;
    const metadata = parseContent(event.content);

    const existing = catalogMap.get(serviceId) || {};
    const mergedEndpoints = mergeEndpoints(existing.endpoints, endpoints);
    const mergedRelays = Array.from(new Set([...(existing.relays || []), relayUrl]));

    const entry = {
      serviceId,
      pubkey: event.pubkey,
      name: metadata.name || metadata.display_name || existing.name || serviceId,
      about: metadata.about || existing.about || '',
      picture: metadata.picture || existing.picture || '',
      fingerprint: fingerprint || existing.fingerprint || null,
      endpoints: mergedEndpoints,
      relays: mergedRelays,
      created_at: event.created_at,
      expires_at: expiresAt || existing.expires_at || null,
      last_seen_at: Date.now(),
      content: event.content
    };

    catalogMap.set(serviceId, entry);
  }

  function queryRelay(relayUrl) {
    return new Promise((resolve) => {
      let settled = false;
      const socket = new WebSocket(relayUrl);
      const subscriptionId = `ncc-catalog-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try {
          socket.close();
        } catch (err) {
          // ignore
        }
        resolve({ relay: relayUrl, ...result });
      };

      const timeout = setTimeout(() => {
        finish({ success: false, error: 'timeout waiting for relay response' });
      }, QUERY_TIMEOUT_MS);

      socket.addEventListener('open', () => {
        socket.send(JSON.stringify(['REQ', subscriptionId, { kinds: [SERVICE_KIND], limit: 200 }]));
      });

      socket.addEventListener('message', (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (!Array.isArray(payload)) return;
          const [type, subId, content] = payload;
          if (subId !== subscriptionId) return;
          if (type === 'EVENT') {
            handleServiceEvent(content, relayUrl);
          } else if (type === 'EOSE') {
            finish({ success: true });
          }
        } catch (err) {
          // ignore malformed
        }
      });

      socket.addEventListener('error', () => {
        finish({ success: false, error: 'connection failed' });
      });

      socket.addEventListener('close', () => {
        finish({ success: false, error: 'relay closed the connection' });
      });
    });
  }

  async function fetchCatalog(relays) {
    const relaySources = normalizeRelayList(relays || lastRelays);
    lastRelays = relaySources;
    lastStatus = { success: false, errors: [] };

    const results = await Promise.all(relaySources.map(relay => queryRelay(relay)));
    const errors = results.filter(r => !r.success).map(r => ({ relay: r.relay, error: r.error || 'unknown error' }));
    lastStatus = {
      success: errors.length === 0,
      errors
    };
    lastUpdated = Date.now();
    await persistCatalog();
    await persistMetadata();
    return buildResponse();
  }

  async function loadStoredState() {
    const stored = await storageGet(['serviceCatalog', 'catalogMetadata']);
    if (Array.isArray(stored.serviceCatalog)) {
      stored.serviceCatalog.forEach(entry => {
        if (entry?.serviceId) {
          catalogMap.set(entry.serviceId, entry);
        }
      });
    }
    if (stored.catalogMetadata) {
      const { lastUpdated: ts, lastRelays: relays, lastStatus: status } = stored.catalogMetadata;
      if (Array.isArray(relays) && relays.length) {
        lastRelays = relays;
      }
      lastUpdated = ts || null;
      lastStatus = status || lastStatus;
    }
  }

  function handleMessage(message, sender, sendResponse) {
    if (!message || typeof message.type !== 'string') {
      sendResponse && sendResponse({ error: 'invalid message' });
      return false;
    }

    if (message.type === 'getCatalog') {
      sendResponse && sendResponse(buildResponse());
      return false;
    }

    if (message.type === 'refreshCatalog') {
      fetchCatalog(message.relays).then(response => {
        sendResponse && sendResponse(response);
      }).catch(error => {
        sendResponse && sendResponse({ error: error?.message || 'failed to refresh catalogue' });
      });
      return true;
    }

    sendResponse && sendResponse({ error: 'unknown message type' });
    return false;
  }

  if (browserApi?.runtime?.onMessage) {
    browserApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
      return handleMessage(message, sender, sendResponse);
    });
  }

  loadStoredState().then(() => {
    if (!lastUpdated && catalogMap.size === 0) {
      fetchCatalog().catch(() => {});
    }
  });
})();
