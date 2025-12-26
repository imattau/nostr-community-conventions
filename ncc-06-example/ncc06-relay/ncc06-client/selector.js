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

function normalizeEndpoint(endpoint) {
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
  };
}

export function normalizeLocatorEndpoints(endpoints = []) {
  return endpoints
    .map(normalizeEndpoint)
    .filter(Boolean);
}

function pickByPriority(list) {
  if (!list.length) return null;
  return [...list].sort((a, b) => a.priority - b.priority)[0];
}

export function choosePreferredEndpoint(endpoints = [], options = {}) {
  const { torPreferred = false, expectedK } = options;
  const wssEndpoints = endpoints.filter(ep => ep.protocol === 'wss');
  const wsEndpoints = endpoints.filter(ep => ep.protocol === 'ws');

  const findOnion = list => list.find(ep => ep.family === 'onion');

  let candidate = null;
  if (torPreferred) {
    candidate = findOnion(wssEndpoints) || findOnion(wsEndpoints);
  }

  if (!candidate) {
    candidate = pickByPriority(wssEndpoints) || pickByPriority(wsEndpoints);
  }

  if (!candidate) {
    return { endpoint: null, reason: 'no-endpoint' };
  }

  if (candidate.protocol === 'wss') {
    if (!candidate.k) {
      return { endpoint: null, reason: 'missing-k' };
    }
    if (expectedK && candidate.k !== expectedK) {
      return {
        endpoint: null,
        reason: 'k-mismatch',
        expected: expectedK,
        actual: candidate.k,
      };
    }
  }

  return { endpoint: candidate };
}
