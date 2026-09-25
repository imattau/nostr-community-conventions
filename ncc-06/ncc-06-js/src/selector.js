import { normalizeLocatorEndpoints } from './ncc05.js';

function pickByPriority(list) {
  if (!list.length) return null;
  return [...list].sort((a, b) => a.priority - b.priority)[0];
}

function findByFamily(list, family) {
  return list.find(ep => ep.family === family);
}

function isSecureProtocol(protocol) {
  return ['wss', 'https', 'tls', 'tcps'].includes(protocol) || (protocol && protocol.endsWith('s') && protocol !== 'ws');
}

/**
 * Choose which endpoint to connect to based on NCC-06 policy.
 * - prefers onion when torPreferred.
 * - filters by allowedProtocols (default: wss, ws).
 * - validates 'k' for secure protocols.
 */
export function choosePreferredEndpoint(endpoints = [], options = {}) {
  const { 
    torPreferred = false, 
    expectedK, 
    allowedProtocols = ['wss', 'ws'] 
  } = options;

  const normalized = endpoints.length ? endpoints : [];
  
  // Filter by allowed protocols
  const candidates = normalized.filter(ep => allowedProtocols.includes(ep.protocol));

  let selection = null;

  // Tor Preference: Look for onion in candidates
  if (torPreferred) {
    selection = findByFamily(candidates, 'onion');
  }

  // Priority Fallback
  if (!selection) {
    selection = pickByPriority(candidates);
  }

  if (!selection) {
    return { endpoint: null, reason: 'no-endpoint' };
  }

  // Security Validation
  if (isSecureProtocol(selection.protocol)) {
    if (!selection.k) {
      return { endpoint: null, reason: 'missing-k' };
    }
    if (expectedK && selection.k !== expectedK) {
      return {
        endpoint: null,
        reason: 'k-mismatch',
        expected: expectedK,
        actual: selection.k
      };
    }
  }

  return { endpoint: selection };
}

export { normalizeLocatorEndpoints };
