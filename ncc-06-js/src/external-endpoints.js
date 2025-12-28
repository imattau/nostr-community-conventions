import os from 'os';

const IPV4_PRIORITY = 10;
const IPV6_PRIORITY = 20;
const ONION_PRIORITY = 30;

/**
 * Build a list of external endpoints that the operator wants to publish.
 * The helper never probes reachability; it only reflects config + the optional onion helper.
 */
export async function buildExternalEndpoints({
  tor,
  ipv4,
  ipv6,
  wsPort = 7000,
  wssPort = 7447,
  ncc02ExpectedKey,
  ensureOnionService,
  publicIpv4Sources = ['https://api.ipify.org?format=json']
} = {}) {
  const endpoints = [];
  const timestamp = Date.now();

  const addEndpoint = (entry) =>
    endpoints.push({ ...entry, index: endpoints.length, createdAt: timestamp });

  if (tor?.enabled && typeof ensureOnionService === 'function') {
    try {
      const onion = await ensureOnionService();
      if (onion) {
        addEndpoint({
          url: `ws://${onion.address}:${onion.servicePort}`,
          priority: ONION_PRIORITY,
          family: 'onion',
          protocol: 'ws'
        });
      }
    } catch (err) {
      console.warn('[NCC06] Onion endpoint could not be created:', err.message);
    }
  }

  if (ipv6?.enabled) {
    const address = detectGlobalIPv6();
    if (address) {
      const protocol = ipv6.protocol || 'ws';
      const port = ipv6.port || (protocol === 'wss' ? wssPort : wsPort);
      const url = `${protocol}://[${address}]:${port}`;
      addEndpoint({
        url,
        priority: IPV6_PRIORITY,
        family: 'ipv6',
        protocol,
        k: protocol === 'wss' ? ncc02ExpectedKey : undefined
      });
    }
  }

  if (ipv4?.enabled) {
    const protocol = ipv4.protocol || 'wss';
    const port = ipv4.port || (protocol === 'wss' ? wssPort : wsPort);
    const address = ipv4.address || (await getPublicIPv4({ sources: ipv4.publicSources ?? publicIpv4Sources }));
    if (address) {
      addEndpoint({
        url: `${protocol}://${address}:${port}`,
        priority: IPV4_PRIORITY,
        family: 'ipv4',
        protocol,
        k: protocol === 'wss' ? ncc02ExpectedKey : undefined
      });
    }
  }

  return endpoints
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.index - b.index;
    })
    .map(({ index: _index, createdAt: _createdAt, ...endpoint }) => endpoint);
}

/**
 * Look for the first non-internal, global IPv6 address.
 */
export function detectGlobalIPv6() {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!Array.isArray(iface)) continue;
    for (const addr of iface) {
      if (addr.family !== 'IPv6' || addr.internal) continue;
      const value = addr.address.toLowerCase();
      if (value.startsWith('::1')) continue;
      if (value.startsWith('fe80')) continue;
      if (value.startsWith('fc00') || value.startsWith('fd00')) continue;
      if (!value.startsWith('2') && !value.startsWith('3')) continue;
      return value;
    }
  }
  return null;
}

/**
 * Query public IPv4 services to fetch the external IPv4 address.
 */
export async function getPublicIPv4({ sources = ['https://api.ipify.org?format=json'] } = {}) {
  const matcher = /((25[0-5]|2[0-4]\d|[01]?\d?\d)(\.|$)){4}/;
  for (const source of sources) {
    try {
      const res = await fetch(source);
      if (!res.ok) continue;
      const text = (await res.text()).trim();
      if (text.startsWith('{') || text.startsWith('[')) {
        try {
          const parsed = JSON.parse(text);
          if (typeof parsed === 'object' && parsed !== null) {
            const ip = parsed.ip || parsed.address || parsed.result;
            if (typeof ip === 'string' && matcher.test(ip)) {
              return ip;
            }
          }
        } catch {
          // ignore parse errors
        }
      }
      const match = text.match(matcher);
      if (match) {
        return match[0];
      }
    } catch (err) {
      continue;
    }
  }
  return null;
}

export function normalizeRelayUrl(url) {
  if (!url) return '';
  let normalized = url.trim();
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  if (!normalized.includes('://')) {
    normalized = `wss://${normalized}`;
  }
  return normalized;
}

export function normalizeRelays(relays) {
  if (!Array.isArray(relays)) return [];
  const normalized = relays
    .filter(Boolean)
    .map(normalizeRelayUrl);
  return [...new Set(normalized)];
}


