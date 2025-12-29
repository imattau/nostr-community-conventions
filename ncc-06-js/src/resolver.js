import WebSocket from 'ws';
import { SimplePool } from 'nostr-tools';
import { NCC05Resolver } from 'ncc-05-js';
import { validateNcc02, parseNcc02Tags } from './ncc02.js';
import { validateLocatorFreshness, normalizeLocatorEndpoints } from './ncc05.js';
import { choosePreferredEndpoint } from './selector.js';

const DEFAULT_RELAY_TIMEOUT_MS = 5000;

/**
 * Resolve a concrete service endpoint by applying NCC-06 resolution order.
 */
export async function resolveServiceEndpoint(options = {}) {
  const {
    bootstrapRelays = [],
    servicePubkey,
    serviceId,
    locatorId,
    expectedK,
    torPreferred = false,
    locatorSecretKey,
    ncc05TimeoutMs = 5000,
    publicationRelayTimeoutMs = DEFAULT_RELAY_TIMEOUT_MS,
    pool, // Allow passing a shared pool
    ncc02Resolver, // Injection for testing
    resolveLocator,
    now
  } = options;

  if (!servicePubkey) {
    throw new Error('servicePubkey is required');
  }
  if (!serviceId) {
    throw new Error('serviceId is required');
  }
  if (!locatorId) {
    throw new Error('locatorId is required');
  }
  if (!bootstrapRelays.length) {
    throw new Error('At least one bootstrap relay is required');
  }

  // 1. Resolve NCC-02 Service Record
  const timestamp = now ?? Math.floor(Date.now() / 1000);
  const locatorResolver = resolveLocator ?? defaultResolveLocator;

  let serviceRecord;
  if (ncc02Resolver) {
    serviceRecord = await ncc02Resolver.resolve(servicePubkey, serviceId, {});
  } else {
    const poolToUse = pool || new SimplePool();
    try {
      const filters = [{
        kinds: [30059],
        authors: [servicePubkey],
        '#d': [serviceId]
      }];
      const events = await new Promise((resolve) => {
        const results = [];
        const sub = poolToUse.subscribeMany(bootstrapRelays, filters, {
          onevent(e) { results.push(e); },
          oneose() { sub.close(); resolve(results); }
        });
        setTimeout(() => { sub.close(); resolve(results); }, publicationRelayTimeoutMs);
      });

      // Sort and validate
      const validEvents = events
        .filter(e => validateNcc02(e, { expectedAuthor: servicePubkey, expectedD: serviceId, now: timestamp }))
        .sort((a, b) => b.created_at - a.created_at);
      
      if (validEvents[0]) {
        const tags = parseNcc02Tags(validEvents[0]);
        serviceRecord = {
          endpoint: tags.u,
          fingerprint: tags.k,
          expiry: Number(tags.exp),
          eventId: validEvents[0].id,
          pubkey: validEvents[0].pubkey
        };
      }
    } finally {
      if (!pool) poolToUse.close(bootstrapRelays);
    }
  }
  
  if (!serviceRecord) {
    throw new Error(`No valid NCC-02 record found for ${serviceId}`);
  }
  
  // 2. Resolve NCC-05 Locator
  const locatorPayload = await locatorResolver({
    bootstrapRelays,
    servicePubkey,
    locatorId,
    locatorSecretKey,
    timeout: ncc05TimeoutMs
  });

  // 3. Determine Endpoint
  const selection = determineEndpoint({
    serviceRecord,
    locatorPayload,
    expectedK,
    torPreferred,
    now: timestamp
  });

  return {
    endpoint: selection.endpoint,
    source: selection.source,
    locatorPayload,
    serviceRecord,
    selection
  };
}

function determineEndpoint({ serviceRecord, locatorPayload, expectedK, torPreferred, now }) {
  // serviceRecord is { endpoint, fingerprint, expiry, attestations, ... }
  // It is already validated (signature, expiry).
  
  const ncc02Url = serviceRecord.endpoint;
  const k = serviceRecord.fingerprint;
  // expiry check was done by resolver, but we check if we need to?
  // NCC02Resolver throws if expired. So we can assume it's fresh.
  
  const result = {
    endpoint: null,
    source: null,
    reason: null,
    evidence: null
  };

  if (locatorPayload && validateLocatorFreshness(locatorPayload, { now })) {
    const normalized = normalizeLocatorEndpoints(locatorPayload.endpoints || []);
    const selection = choosePreferredEndpoint(normalized, {
      torPreferred,
      expectedK
    });
    if (selection.endpoint) {
      return {
        endpoint: selection.endpoint.url,
        source: 'locator',
        reason: 'locator',
        evidence: selection
      };
    }
    result.reason = selection.reason;
    result.evidence = selection;
  }

  if (ncc02Url) {
    const isSecure = ncc02Url.match(/^(wss|https|tls|tcps):\/\//) || (ncc02Url.includes('://') && ncc02Url.split(':')[0].endsWith('s'));
    
    if (isSecure && expectedK && k && k !== expectedK) {
      return {
        endpoint: null,
        source: 'ncc02',
        reason: 'k-mismatch',
        evidence: { expected: expectedK, actual: k }
      };
    }
    return {
      endpoint: ncc02Url,
      source: 'ncc02',
      reason: 'fallback',
      evidence: { endpoint: ncc02Url, fingerprint: k }
    };
  }

  result.reason = result.reason || 'no-endpoint';
  return result;
}

async function defaultResolveLocator({
  bootstrapRelays,
  servicePubkey,
  locatorId,
  locatorSecretKey,
  timeout
}) {
  const resolver = new NCC05Resolver({
    bootstrapRelays,
    timeout
  });
  try {
    return await resolver.resolve(servicePubkey, locatorSecretKey, locatorId, {
      strict: false,
      gossip: false
    });
  } finally {
    if (resolver && typeof resolver.close === 'function') {
      resolver.close();
    }
  }
}

