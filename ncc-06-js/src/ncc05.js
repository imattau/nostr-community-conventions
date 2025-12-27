export const DEFAULT_TTL_SECONDS = 3600;

/**
 * Build a locator payload that matches NCC-05 expectations.
 */
export function buildLocatorPayload({ endpoints = [], ttl = DEFAULT_TTL_SECONDS, updatedAt } = {}) {
  const timestamp = updatedAt ?? Math.floor(Date.now() / 1000);
  return {
    ttl,
    updated_at: timestamp,
    endpoints: endpoints.map(normalizeEndpoint)
  };
}

/**
 * Parse string content from a stored locator event.
 */
export function parseLocatorPayload(content) {
  if (typeof content !== 'string') {
    return null;
  }
  try {
    return JSON.parse(content);
  } catch (err) {
    return null;
  }
}

/**
 * Check TTL/updated_at to determine if locator is fresh.
 */
export function validateLocatorFreshness(payload, { now, allowStale = false } = {}) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const timestamp = now ?? Math.floor(Date.now() / 1000);
  const ttl = Number(payload.ttl) || 0;
  const updated = Number(payload.updated_at) || 0;
  if (ttl <= 0) {
    return false;
  }
  if (allowStale) {
    return true;
  }
  return timestamp <= updated + ttl;
}

/**
 * Normalize endpoint definitions retrieved from locator payloads.
 */
export function normalizeLocatorEndpoints(endpoints = []) {
  return endpoints
    .map(normalizeEndpoint)
    .filter(Boolean);
}

function normalizeEndpoint(endpoint = {}) {
  const url = endpoint.url || endpoint.uri || endpoint.value;
  if (!url) {
    return null;
  }
  const protocol = endpoint.protocol || endpoint.type || (url.startsWith('wss://') ? 'wss' : 'ws');
  const family = detectFamily(url, endpoint.family);
  const priority = Number(endpoint.priority ?? endpoint.prio ?? 0);
  const k = endpoint.k || endpoint.fingerprint || null;
  return {
    url,
    protocol,
    family,
    priority,
    k,
    raw: endpoint
  };
}

function detectFamily(url, override) {
  if (override) {
    return override;
  }
  if (!url) {
    return 'unknown';
  }
  if (url.includes('.onion')) {
    return 'onion';
  }
  if (url.includes('[') && url.includes(']')) {
    return 'ipv6';
  }
  return 'ipv4';
}
