import { normalizeLocatorEndpoints } from './ncc05.js';

function pickByPriority(list) {
  if (!list.length) return null;
  return [...list].sort((a, b) => a.priority - b.priority)[0];
}

function findByFamily(list, family) {
  return list.find(ep => ep.family === family);
}

/**
 * Choose which endpoint to connect to based on NCC-06 policy.
 * - prefers onion when torPreferred.
 * - prefers WSS endpoints with matching k.
 */
export function choosePreferredEndpoint(endpoints = [], options = {}) {
  const { torPreferred = false, expectedK } = options;
  const normalized = endpoints.length ? endpoints : [];
  const wssEndpoints = normalized.filter(ep => ep.protocol === 'wss');
  const wsEndpoints = normalized.filter(ep => ep.protocol === 'ws');

  let candidate = null;
  if (torPreferred) {
    candidate = findByFamily(wssEndpoints, 'onion') || findByFamily(wsEndpoints, 'onion');
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
        actual: candidate.k
      };
    }
  }
  return { endpoint: candidate };
}

export { normalizeLocatorEndpoints };
