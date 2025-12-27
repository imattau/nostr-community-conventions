import WebSocket from 'ws';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateEvent, verifyEvent } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import { NCC05Resolver } from 'ncc-05';
import { parseNostrMessage, serializeNostrMessage, createReqMessage } from '../lib/protocol.js';
import { normalizeLocatorEndpoints, choosePreferredEndpoint } from 'ncc-06-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootConfigPath = path.resolve(__dirname, '../config.json');
const rootConfig = JSON.parse(readFileSync(rootConfigPath, 'utf-8'));

const clientConfigPath = path.resolve(__dirname, './config.json');
const clientConfig = JSON.parse(readFileSync(clientConfigPath, 'utf-8'));

const RELAY_URL = clientConfig.relayUrl || rootConfig.relayUrl;
const publicationRelayTimeoutMs = clientConfig.publicationRelayTimeoutMs || 5000;
const staleFallbackSeconds = Number(clientConfig.staleFallbackSeconds ?? 600);
const staleFallbackEnabled = clientConfig.hasOwnProperty('staleFallbackSeconds') ? staleFallbackSeconds > 0 : true;

const SERVICE_IDENTITY_URI = clientConfig.serviceIdentityUri || (clientConfig.serviceNpub ? `wss://${clientConfig.serviceNpub}` : null);
if (!SERVICE_IDENTITY_URI || !SERVICE_IDENTITY_URI.toLowerCase().startsWith('wss://')) {
  console.error("Client 'serviceIdentityUri' must be specified as wss://<npub> in config.json.");
  process.exit(1);
}
const identityPart = SERVICE_IDENTITY_URI.replace(/^wss:\/\//i, '').replace(/\/$/, '');
let identityDecoded;
try {
  identityDecoded = nip19.decode(identityPart);
} catch (err) {
  console.error("Client 'serviceIdentityUri' must encode a valid npub:", err?.message || err);
  process.exit(1);
}
if (identityDecoded.type !== 'npub') {
  console.error("Client 'serviceIdentityUri' must encode a valid npub.");
  process.exit(1);
}
const SERVICE_PUBKEY = identityDecoded.data;
if (clientConfig.servicePubkey && clientConfig.servicePubkey !== SERVICE_PUBKEY) {
  console.warn(`[Client] WARNING: 'servicePubkey' in config does not match parsed npub; using identity-based pubkey ${SERVICE_PUBKEY}.`);
}
const NCC02_EXPECTED_KEY = clientConfig.ncc02ExpectedKey;
const SERVICE_ID = clientConfig.serviceId;
const LOCATOR_ID = clientConfig.locatorId;
const TOR_PREFERRED = clientConfig.torPreferred;
const NCC05_TIMEOUT_MS = clientConfig.ncc05TimeoutMs || 5000;
const LOCATOR_SECRET = clientConfig.locatorSecretKey;

if (!SERVICE_PUBKEY) {
  console.error("Client 'servicePubkey' not found in config.json.");
  process.exit(1);
}

const log = (message, ...args) => console.log(`[Client] ${message}`, ...args);
const warn = (message, ...args) => console.warn(`[Client] WARNING: ${message}`, ...args);
const error = (message, ...args) => console.error(`[Client] ERROR: ${message}`, ...args);

const PUBLICATION_RELAYS = getPublicationRelaySet();
const cache = {
  service: null,
  locator: null
};

function getPublicationRelaySet() {
  const configured = Array.isArray(clientConfig.publicationRelays) ? clientConfig.publicationRelays : [];
  const combined = [RELAY_URL, ...configured.filter(Boolean)];
  const deduped = [...new Set(combined)];
  return deduped;
}

async function resolveServiceEndpoint() {
  log(`Resolving service endpoint for ${SERVICE_IDENTITY_URI} (${SERVICE_PUBKEY}) via relays: ${PUBLICATION_RELAYS.join(', ')}`);
  const serviceEvent = await resolveServiceRecord();
  const serviceTags = Object.fromEntries(serviceEvent.tags);
  const serviceRecord = {
    d: serviceTags.d,
    u: serviceTags.u,
    k: serviceTags.k,
    exp: parseInt(serviceTags.exp, 10) || 0
  };
  log('Selected NCC-02 service record:', serviceRecord);

  const locatorPayload = await resolveLocatorPayload();
  if (!locatorPayload) {
    warn('No usable NCC-05 locator payload resolved; relying on NCC-02 fallback.');
  }

  return determineEndpoint(serviceEvent, locatorPayload);
}

async function resolveServiceRecord() {
  const now = Math.floor(Date.now() / 1000);
  const filter = {
    kinds: [30059],
    authors: [SERVICE_PUBKEY],
    '#d': [SERVICE_ID],
    limit: 10
  };

  const candidates = await queryPublicationRelays(filter);
  const selected = pickBestServiceRecord(candidates, now, { allowExpired: false });
  if (selected) {
    cache.service = {
      event: selected,
      fetchedAt: now,
      expiresAt: Number(Object.fromEntries(selected.tags).exp) || 0
    };
    return selected;
  }

  if (staleFallbackEnabled && cache.service && now <= cache.service.fetchedAt + staleFallbackSeconds) {
    warn('Using stale NCC-02 service record due to missing fresh candidates.');
    return cache.service.event;
  }

  throw new Error('No NCC-02 service record found');
}

async function resolveLocatorPayload() {
  const now = Math.floor(Date.now() / 1000);
  const resolver = new NCC05Resolver({
    bootstrapRelays: PUBLICATION_RELAYS,
    timeout: NCC05_TIMEOUT_MS
  });

  try {
    const payload = await resolver.resolve(SERVICE_PUBKEY, LOCATOR_SECRET, LOCATOR_ID, {
      strict: false,
      gossip: false
    });
    if (!payload) {
      return attemptStaleLocator(now);
    }

    const ttl = Number(payload.ttl) || 0;
    const updated = Number(payload.updated_at) || 0;
    const isFresh = ttl > 0 && now <= updated + ttl;

    if (!isFresh) {
      warn('Resolved NCC-05 locator is stale.');
      return attemptStaleLocator(now);
    }

    cache.locator = { payload, fetchedAt: now };
    log(`NCC-05 locator resolved (ttl=${ttl}s, updated_at=${updated}).`);
    return payload;
  } catch (err) {
    warn('NCC-05 resolver error:', err?.message || err);
    return attemptStaleLocator(now);
  } finally {
    resolver.close();
  }
}

function attemptStaleLocator(now) {
  if (staleFallbackEnabled && cache.locator && now <= cache.locator.fetchedAt + staleFallbackSeconds) {
    warn('Using stale NCC-05 locator due to missing fresh data.');
    return cache.locator.payload;
  }
  return null;
}

async function queryPublicationRelays(filter) {
  const promises = PUBLICATION_RELAYS.map(relay => queryRelayForEvents(relay, filter));
  const settled = await Promise.allSettled(promises);
  return settled.reduce((acc, result) => {
    if (result.status === 'fulfilled') {
      return acc.concat(result.value);
    }
    warn(`Publication relay query failed: ${result.reason}`);
    return acc;
  }, []);
}

function queryRelayForEvents(relayUrl, filters) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrl);
    const events = [];
    const subId = 'client-service-' + Math.random().toString().slice(2, 6);
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        resolve(events);
      }
    }, publicationRelayTimeoutMs);

    ws.onopen = () => {
      ws.send(serializeNostrMessage(createReqMessage(subId, filters)));
    };

    ws.onmessage = message => {
      const parsed = parseNostrMessage(message.data.toString());
      if (!parsed) return;
      const [type, ...payload] = parsed;

      if (type === 'EVENT') {
        const [receivedSubId, event] = payload;
        if (receivedSubId !== subId) return;
        events.push(event);
      } else if (type === 'EOSE') {
        const [receivedSubId] = payload;
        if (receivedSubId === subId && !settled) {
          settled = true;
          clearTimeout(timeout);
          ws.close();
          resolve(events);
        }
      }
    };

    ws.onerror = err => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(err);
      }
    };

    ws.onclose = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(events);
      }
    };
  });
}

function pickBestServiceRecord(events, now, options = {}) {
  const candidates = new Map();

  for (const event of events) {
    if (!event || event.kind !== 30059) continue;
    if (!validateEvent(event) || !verifyEvent(event)) {
      warn(`Invalid NCC-02 event rejected: ${event?.id}`);
      continue;
    }
    const tags = Object.fromEntries(event.tags);
    const exp = Number(tags.exp) || 0;
    const isExpired = exp > 0 && now > exp;
    if (!options.allowExpired && isExpired) continue;
    const existing = candidates.get(event.id);
    if (!existing || event.created_at > existing.created_at || (event.created_at === existing.created_at && event.id > existing.id)) {
      candidates.set(event.id, event);
    }
  }

  const ordered = [...candidates.values()].sort((a, b) => {
    if (b.created_at !== a.created_at) return b.created_at - a.created_at;
    return b.id.localeCompare(a.id);
  });

  return ordered[0] || null;
}

function determineEndpoint(ncc02Event, locatorPayload) {
  const now = Math.floor(Date.now() / 1000);
  const tags = Object.fromEntries(ncc02Event.tags);
  const exp = Number(tags.exp) || 0;
  const isServiceFresh = !exp || now <= exp;
  let preferredEndpoint = null;
  let ncc02Url = null;

  if (isServiceFresh) {
    ncc02Url = tags.u;
    log(`Selected NCC-02 fallback URL: ${ncc02Url}, K=${tags.k || 'N/A'}`);
  } else {
    warn('Selected NCC-02 event is expired.');
  }

  if (locatorPayload && Array.isArray(locatorPayload.endpoints) && locatorPayload.endpoints.length > 0) {
    const ttl = Number(locatorPayload.ttl) || 0;
    const updated = Number(locatorPayload.updated_at) || 0;
    const isFresh = ttl > 0 && now <= updated + ttl;
    if (isFresh) {
      log('Fresh NCC-05 locator found.');
      const normalizedEndpoints = normalizeLocatorEndpoints(locatorPayload.endpoints);
      const selection = choosePreferredEndpoint(normalizedEndpoints, {
        torPreferred: TOR_PREFERRED,
        expectedK: NCC02_EXPECTED_KEY
      });
      if (selection.endpoint) {
        preferredEndpoint = selection.endpoint;
        log(`Preferred endpoint from NCC-05: ${preferredEndpoint.url} (${preferredEndpoint.protocol}/${preferredEndpoint.family})`);
      } else if (selection.reason) {
        const message = selection.reason === 'k-mismatch'
          ? `K mismatch for NCC-05 WSS endpoint (expected ${selection.expected} but got ${selection.actual}). Rejecting.`
          : selection.reason === 'missing-k'
            ? "NCC-05 WSS endpoint missing 'k'. Rejecting." 
            : 'No usable NCC-05 endpoint selected.';
        log(message);
        (selection.reason === 'k-mismatch') ? error(message) : warn(message);
      }
    } else {
      warn('NCC-05 locator is stale or missing TTL.');
    }
  }

  if (preferredEndpoint && preferredEndpoint.url) {
    return preferredEndpoint.url;
  }

  if (ncc02Url) {
    log(`Falling back to NCC-02 URL: ${ncc02Url}`);
    if (ncc02Url.startsWith('wss://')) {
      if (!tags.k || tags.k !== NCC02_EXPECTED_KEY) {
        const message = `NCC-02 fallback WSS endpoint 'k' mismatch (expected ${NCC02_EXPECTED_KEY}, got ${tags.k || 'N/A'}).`;
        log(message);
        error(message);
        return null;
      }
    }
    return ncc02Url;
  }

  warn('No valid endpoint could be resolved from NCC-05 or NCC-02 records.');
  return null;
}

async function connectAndTest(endpointUrl) {
  if (!endpointUrl) {
    error('No endpoint URL provided to connect and test.');
    return;
  }
  log(`Attempting to connect to resolved endpoint: ${endpointUrl}`);
  const wsOptions = endpointUrl.startsWith('wss://') ? { rejectUnauthorized: false } : {};
  const ws = new WebSocket(endpointUrl, wsOptions);

  return new Promise((resolve, reject) => {
    const subId = 'test-req-' + Math.random().toString().slice(2, 6);
    let eoseReceived = false;
    let eventReceived = false;

    ws.onopen = () => {
      log('Connected. Sending REQ for NCC-02 event.');
      const filter = {
        kinds: [30059],
        authors: [SERVICE_PUBKEY],
        '#d': [SERVICE_ID],
        limit: 1
      };
      ws.send(serializeNostrMessage(createReqMessage(subId, filter)));
    };

    ws.onmessage = event => {
      const message = parseNostrMessage(event.data.toString());
      if (!message) return;
      if (message[0] === 'EVENT') {
        const [, receivedSubId, receivedEvent] = message;
        if (receivedSubId === subId && receivedEvent.kind === 30059) {
          log(`Received NCC-02 event ${receivedEvent.id}`);
          eventReceived = true;
        }
      } else if (message[0] === 'EOSE') {
        if (message[1] === subId) {
          log('Received EOSE for test REQ.');
          eoseReceived = true;
        }
      }

      if (eoseReceived && eventReceived) {
        log('REQ roundtrip successful.');
        ws.close();
        resolve(true);
      } else if (eoseReceived && !eventReceived) {
        warn('EOSE received but expected event missing.');
        ws.close();
        resolve(false);
      }
    };

    ws.onerror = err => {
      error('WebSocket error during connection test:', err);
      reject(err);
    };

    ws.onclose = () => {
      log('Disconnected from service endpoint.');
      if (!eoseReceived || !eventReceived) {
        reject('Connection closed before successful REQ roundtrip.');
      }
    };
  });
}

async function main() {
  try {
    const resolvedEndpoint = await resolveServiceEndpoint();
    if (resolvedEndpoint) {
      log(`Service endpoint resolved to: ${resolvedEndpoint}`);
      const testResult = await connectAndTest(resolvedEndpoint);
      if (testResult) {
        log('Client successfully resolved, connected, and performed REQ roundtrip.');
      } else {
        const failureMessage = 'Client failed REQ roundtrip test.';
        log(failureMessage);
        error(failureMessage);
      }
    } else {
      const failureMessage = 'Failed to resolve service endpoint.';
      log(failureMessage);
      error(failureMessage);
    }
  } catch (err) {
    error('Client main execution failed:', err);
  } finally {
    process.exit(0);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export { resolveServiceEndpoint };
