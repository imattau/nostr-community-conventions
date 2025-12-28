import { normalizeLocatorEndpoints } from 'ncc-06-js';
import { getEndpointFingerprint } from './key-inspector.js';

/**
 * Produces a canonical ordered list of endpoints based on config and probes.
 */
export async function buildInventory(configEndpoints) {
  const inventory = [];

  for (const entry of configEndpoints) {
    const url = entry.url;
    let k = entry.k;

    // If k is not provided but protocol is secure, try to fetch it
    if (!k && isSecure(url)) {
      try {
        k = await getEndpointFingerprint(url);
      } catch (err) {
        console.warn(`[Inventory] Could not fetch fingerprint for ${url}: ${err.message}`);
      }
    }

    inventory.push({
      ...entry,
      k
    });
  }

  // Normalize and Sort via ncc-06-js helpers
  // ncc-06-js doesn't have a "sort by canonical rule" exported directly for locator payloads, 
  // but NCC-05 recommends family ordering. 
  // We'll use normalizeLocatorEndpoints which cleans them up.
  const normalized = normalizeLocatorEndpoints(inventory);

  return normalized.sort((a, b) => {
    // Canonical ordering: priority first
    if (a.priority !== b.priority) return a.priority - b.priority;
    
    // Then family: onion > ipv6 > ipv4
    const familyScore = { 'onion': 1, 'ipv6': 2, 'ipv4': 3, 'unknown': 4 };
    const scoreA = familyScore[a.family] || 5;
    const scoreB = familyScore[b.family] || 5;
    if (scoreA !== scoreB) return scoreA - scoreB;

    // Then secure before insecure
    const isSecA = isSecure(a.url);
    const isSecB = isSecure(b.url);
    if (isSecA !== isSecB) return isSecA ? -1 : 1;

    return a.url.localeCompare(b.url);
  });
}

function isSecure(url) {
  return url.startsWith('wss://') || url.startsWith('https://') || url.startsWith('tls://') || url.startsWith('tcps://');
}
