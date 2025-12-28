import WebSocket from 'ws';
import { NCC05Resolver } from 'ncc-05-js';
import { NCC02Resolver } from 'ncc-02-js';
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

  const timestamp = now ?? Math.floor(Date.now() / 1000);
  const locatorResolver = resolveLocator ?? defaultResolveLocator;

  // 1. Resolve NCC-02 Service Record using the library
  let serviceRecord;
  try {
    const resolver = ncc02Resolver || new NCC02Resolver(bootstrapRelays, { pool });
    serviceRecord = await resolver.resolve(servicePubkey, serviceId, {
       // We can pass options if needed, e.g. minLevel
    });
  } catch (err) {
    // Map library errors or rethrow?
    // The library throws generic Error or NCC02Error.
    // We can just let it propagate or wrap.
    // Existing code threw "No valid NCC-02 service record available".
    // We'll let the library error bubble up as it provides more detail.
    throw err;
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
    resolver.close();
  }
}

