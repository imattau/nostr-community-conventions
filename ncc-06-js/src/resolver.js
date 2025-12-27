import WebSocket from 'ws';
import { NCC05Resolver } from 'ncc-05';
import { parseNostrMessage, serializeNostrMessage, createReqMessage } from './protocol.js';
import { validateNcc02, parseNcc02Tags } from './ncc02.js';
import { normalizeLocatorEndpoints, validateLocatorFreshness } from './ncc05.js';
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
    queryRelayEvents,
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
  const fetchEvents = queryRelayEvents ?? defaultQueryRelayEvents;
  const locatorResolver = resolveLocator ?? defaultResolveLocator;

  const filter = {
    kinds: [30059],
    authors: [servicePubkey],
    '#d': [serviceId],
    limit: 10
  };

  const events = await fetchEvents(bootstrapRelays, filter, { timeoutMs: publicationRelayTimeoutMs });
  const serviceEvent = pickBestServiceRecord(events, timestamp, serviceId);
  if (!serviceEvent) {
    throw new Error('No valid NCC-02 service record available');
  }

  const locatorPayload = await locatorResolver({
    bootstrapRelays,
    servicePubkey,
    locatorId,
    locatorSecretKey,
    timeout: ncc05TimeoutMs
  });

  const selection = determineEndpoint({
    serviceEvent,
    locatorPayload,
    expectedK,
    torPreferred,
    now: timestamp
  });

  return {
    endpoint: selection.endpoint,
    source: selection.source,
    locatorPayload,
    serviceEvent,
    selection
  };
}

function determineEndpoint({ serviceEvent, locatorPayload, expectedK, torPreferred, now }) {
  const tags = parseNcc02Tags(serviceEvent);
  const ncc02Url = tags.u;
  const isFreshService = !tags.exp || now <= Number(tags.exp);
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

  if (ncc02Url && isFreshService) {
    if (ncc02Url.startsWith('wss://') && expectedK && tags.k && tags.k !== expectedK) {
      return {
        endpoint: null,
        source: 'ncc02',
        reason: 'k-mismatch',
        evidence: { expected: expectedK, actual: tags.k }
      };
    }
    return {
      endpoint: ncc02Url,
      source: 'ncc02',
      reason: 'fallback',
      evidence: { tags }
    };
  }

  result.reason = result.reason || 'no-endpoint';
  return result;
}

function pickBestServiceRecord(events, now, expectedServiceId) {
  const candidates = [];
  for (const event of events) {
    if (!validateNcc02(event, { now, expectedD: expectedServiceId })) {
      continue;
    }
    candidates.push(event);
  }
  return candidates.sort((a, b) => {
    if (b.created_at !== a.created_at) {
      return b.created_at - a.created_at;
    }
    return b.id.localeCompare(a.id);
  })[0] || null;
}

async function defaultQueryRelayEvents(relays, filter, options = {}) {
  const queries = relays.map(relay => queryRelayForEvents(relay, filter, options.timeoutMs));
  const settled = await Promise.allSettled(queries);
  return settled.reduce((acc, item) => {
    if (item.status === 'fulfilled') {
      return acc.concat(item.value);
    }
    return acc;
  }, []);
}

function queryRelayForEvents(relayUrl, filter, timeoutMs = DEFAULT_RELAY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrl);
    const events = [];
    const subId = `ncc06-${Math.random().toString(16).slice(2, 8)}`;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        resolve(events);
      }
    }, timeoutMs);

    ws.onopen = () => {
      ws.send(serializeNostrMessage(createReqMessage(subId, filter)));
    };

    ws.onmessage = raw => {
      const message = parseNostrMessage(raw.data.toString());
      if (!message) {
        return;
      }
      const [type, ...payload] = message;
      if (type === 'EVENT') {
        const [receivedSubId, event] = payload;
        if (receivedSubId === subId) {
          events.push(event);
        }
      } else if (type === 'EOSE') {
        const [receivedSubId] = payload;
        if (receivedSubId === subId && !settled) {
          settled = true;
          clearTimeout(timer);
          ws.close();
          resolve(events);
        }
      }
    };

    ws.onerror = err => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    };

    ws.onclose = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(events);
      }
    };
  });
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
