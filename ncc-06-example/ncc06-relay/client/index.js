import WebSocket from 'ws';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateEvent, verifyEvent } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import { NCC05Resolver } from 'ncc-05';
import { parseNostrMessage, serializeNostrMessage, createReqMessage } from '../relay/protocol.js';
import { normalizeLocatorEndpoints, choosePreferredEndpoint } from './selector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootConfigPath = path.resolve(__dirname, '../config.json');
const rootConfig = JSON.parse(readFileSync(rootConfigPath, 'utf-8'));

const clientConfigPath = path.resolve(__dirname, './config.json');
const clientConfig = JSON.parse(readFileSync(clientConfigPath, 'utf-8'));

const rootConfigDir = path.dirname(rootConfigPath);
const TLS_CERT_PATH = rootConfig.relayTlsCert ? path.resolve(rootConfigDir, rootConfig.relayTlsCert) : null;
let TLS_CA = null;
if (TLS_CERT_PATH) {
  try {
    TLS_CA = readFileSync(TLS_CERT_PATH);
  } catch (err) {
    console.warn(`[Client] WARNING: Unable to load TLS certificate for service endpoint: ${err?.message || err}`);
  }
}

const RELAY_URL = clientConfig.relayUrl || rootConfig.relayUrl;
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
const SERVICE_NPUB = identityPart;
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

async function resolveServiceEndpoint() {
  log(`Connecting to discovery relay at ${RELAY_URL} to resolve service endpoint for identity ${SERVICE_IDENTITY_URI} (${SERVICE_PUBKEY})...`);

  const serviceEvent = await fetchServiceRecord();
  const serviceTags = Object.fromEntries(serviceEvent.tags);
  const serviceRecord = {
    d: serviceTags.d,
    u: serviceTags.u,
    k: serviceTags.k,
    exp: parseInt(serviceTags.exp, 10) || 0,
  };
  log('Found service record:', serviceRecord);

  const locatorPayload = await fetchLocatorPayload();
  if (!locatorPayload) {
    warn('No NCC-05 locator payload resolved; relying on NCC-02 fallback.');
  }

  return determineEndpoint(serviceEvent, locatorPayload);
}

async function fetchServiceRecord() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(RELAY_URL);
    const subId = 'client-service-' + Math.random().toString().slice(2, 6);
    let bestEvent = null;
    let settled = false;

    ws.onopen = () => {
      log('Connected to discovery relay.');
      const filter = {
        kinds: [30059],
        authors: [SERVICE_PUBKEY],
        "#d": [SERVICE_ID],
        limit: 1,
      };
      ws.send(serializeNostrMessage(createReqMessage(subId, filter)));
    };

    ws.onmessage = message => {
      const parsed = parseNostrMessage(message.data.toString());
      if (!parsed) return;

      const [type, ...payload] = parsed;

      if (type === 'EVENT') {
        const [receivedSubId, event] = payload;
        if (receivedSubId !== subId || event.kind !== 30059) return;
        if (!validateEvent(event) || !verifyEvent(event)) {
          warn(`Invalid NCC-02 event received: ${event.id}`);
          return;
        }
        if (!bestEvent || event.created_at > bestEvent.created_at) {
          bestEvent = event;
        }
      } else if (type === 'EOSE') {
        const [receivedSubId] = payload;
        if (receivedSubId === subId && !settled) {
          settled = true;
          ws.close();
          if (bestEvent) {
            resolve(bestEvent);
          } else {
            reject(new Error('No NCC-02 service record found'));
          }
        }
      } else if (type === 'NOTICE') {
        const [notice] = payload;
        warn(`Relay NOTICE during NCC-02 fetch: ${notice}`);
      }
    };

    ws.onerror = err => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    ws.onclose = () => {
      log('Disconnected from discovery relay.');
    };
  });
}

async function fetchLocatorPayload() {
  const resolver = new NCC05Resolver({
    bootstrapRelays: [RELAY_URL],
    timeout: NCC05_TIMEOUT_MS,
  });

  try {
    const payload = await resolver.resolve(SERVICE_PUBKEY, LOCATOR_SECRET, LOCATOR_ID, {
      strict: false,
      gossip: false,
    });
    if (payload) {
      log(`NCC-05 locator resolved (ttl=${payload.ttl}s, updated_at=${payload.updated_at}).`);
    }
    return payload;
  } catch (err) {
    warn('NCC-05 resolver error:', err?.message || err);
    return null;
  } finally {
    resolver.close();
  }
}

function determineEndpoint(ncc02Event, locatorPayload) {
  const now = Math.floor(Date.now() / 1000);
  let preferredEndpoint = null;
  let ncc02Url = null;

  const tags = Object.fromEntries(ncc02Event.tags);
  const exp = tags.exp ? parseInt(tags.exp, 10) : 0;

  if (!exp || exp >= now) {
    ncc02Url = tags.u;
    log(`Fresh NCC-02 found. URL: ${ncc02Url}, K: ${tags.k || 'N/A'}`);
  } else {
    warn('NCC-02 event found but it is expired.');
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
        expectedK: NCC02_EXPECTED_KEY,
      });

      if (selection.endpoint) {
        preferredEndpoint = selection.endpoint;
        log(`Preferred endpoint from NCC-05: ${preferredEndpoint.url}, Protocol: ${preferredEndpoint.protocol}, Family: ${preferredEndpoint.family}, K: ${preferredEndpoint.k || 'N/A'}`);
      } else if (selection.reason) {
        const message = selection.reason === 'k-mismatch'
          ? `K mismatch for WSS endpoint. Expected: ${selection.expected}, Got: ${selection.actual}. Rejecting.`
          : selection.reason === 'missing-k'
            ? "WSS endpoint in NCC-05 missing 'k' value. Rejecting."
            : 'No usable NCC-05 endpoint could be selected.';
        log(message);
        if (selection.reason === 'k-mismatch') {
          error(message);
        } else {
          warn(message);
        }
      }
    } else {
      const expiredMessage = 'NCC-05 locator found but it is expired or not fresh.';
      log(expiredMessage);
      warn(expiredMessage);
    }
  }

  if (preferredEndpoint && preferredEndpoint.url) {
    return preferredEndpoint.url;
  } else if (ncc02Url) {
    log(`Falling back to NCC-02 URL: ${ncc02Url}`);
    if (ncc02Url.startsWith('wss://')) {
      if (!tags.k || tags.k !== NCC02_EXPECTED_KEY) {
        const fallbackMessage = `WSS endpoint from NCC-02 fallback missing or mismatched 'k' value. Expected: ${NCC02_EXPECTED_KEY}, Got: ${tags.k || 'N/A'}. Rejecting fallback.`;
        log(fallbackMessage);
        error(fallbackMessage);
        return null;
      }
    }
    return ncc02Url;
  } else {
    warn('No fresh NCC-05 or valid NCC-02 found.');
    return null;
  }
}

async function connectAndTest(endpointUrl) {
  if (!endpointUrl) {
    error("No endpoint URL provided to connect and test.");
    return;
  }

  log(`Attempting to connect to resolved endpoint: ${endpointUrl}`);
  const wsOptions = {};
  if (endpointUrl.startsWith('wss://')) {
    if (TLS_CA) {
      wsOptions.ca = TLS_CA;
    } else {
      wsOptions.rejectUnauthorized = false;
    }
  }
  const ws = new WebSocket(endpointUrl, wsOptions);

  return new Promise((resolve, reject) => {
    const subId = 'test-req-' + Math.random().toString().slice(2, 6);
    let eoseReceived = false;
    let eventReceived = false;

    ws.onopen = () => {
      log('Successfully connected to service endpoint. Sending REQ for a NCC-02 event...');
      const filter = {
        kinds: [30059],
        authors: [SERVICE_PUBKEY],
        "#d": [SERVICE_ID],
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
          log(`Received expected NCC-02 event: ${receivedEvent.id}`);
          eventReceived = true;
        }
      } else if (message[0] === 'EOSE') {
        if (message[1] === subId) {
          log('Received EOSE for test REQ.');
          eoseReceived = true;
        }
      }

      if (eoseReceived && eventReceived) {
        log('REQ roundtrip successful: Event received before EOSE.');
        ws.close();
        resolve(true);
      } else if (eoseReceived && !eventReceived) {
        warn('REQ roundtrip completed: EOSE received, but no expected event found.');
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
        reject("Connection closed before successful REQ roundtrip.");
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

main();
