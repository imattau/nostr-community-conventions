import os from 'os';
import { ensureOnionEndpoint } from './onion-service.js';

const IPV4_PRIORITY = 10;
const IPV6_PRIORITY = 20;
const ONION_PRIORITY = 30;

/**
 * Return the internal relay URL used for publishing events.
 */
export function getLocalRelayUrl(config = {}) {
  const relay = config.relay || {};
  if (relay.localUrl) {
    return relay.localUrl;
  }
  const host = relay.host || '127.0.0.1';
  const port = relay.port || 7000;
  const proto = relay.protocol || 'ws';
  return `${proto}://${host}:${port}`;
}

/**
 * Build the externally advertised endpoints for NCC-05.
 * This function does not probe the network; it only emits what the operator configured
 * or what can be derived automatically (onion, IPv6 interface, optional IP lookup).
 */
export async function buildExternalEndpoints({
  tor,
  ipv4,
  ipv6,
  wsPort = 7000,
  wssPort = 7447,
  ncc02ExpectedKey,
  publicIpv4Sources = ['https://api.ipify.org?format=json']
} = {}) {
  const endpoints = [];
  const timestamp = Date.now();
  const addEndpoint = (entry) => {
    endpoints.push({ ...entry, index: endpoints.length, addedAt: timestamp });
  };

  if (tor?.enabled) {
    try {
      const onion = await ensureOnionEndpoint({
        torControl: tor,
        cacheFile: tor?.serviceFile,
        relayPort: wsPort
      });
      if (onion) {
        addEndpoint({
          url: `ws://${onion.address}:${onion.servicePort}`,
          priority: ONION_PRIORITY,
          family: 'onion',
          protocol: 'ws'
        });
      }
    } catch (err) {
      console.warn('[Sidecar] Onion endpoint could not be created:', err.message);
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
    const address = ipv4.address || await getPublicIPv4({ sources: ipv4.publicSources ?? publicIpv4Sources });
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
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.index - b.index;
    })
    .map(({ index, addedAt, ...entry }) => entry);
}

/**
 * Enumerate interfaces and return the first global IPv6 address.
 */
export function detectGlobalIPv6() {
  const netIfaces = os.networkInterfaces();
  for (const ifaceList of Object.values(netIfaces)) {
    if (!Array.isArray(ifaceList)) continue;
    for (const addrInfo of ifaceList) {
      if (addrInfo.family !== 'IPv6' || addrInfo.internal) continue;
      const value = addrInfo.address.toLowerCase();
      if (value.startsWith('::1')) continue;
      if (value.startsWith('fe80')) continue;
      if (value.startsWith('fc00') || value.startsWith('fd00')) continue;
      if (!(value.startsWith('2') || value.startsWith('3'))) continue;
      return value;
    }
  }
  return null;
}

/**
 * Query public IPv4 discovery endpoints and return the first valid IPv4 string.
 */
export async function getPublicIPv4({ sources = ['https://api.ipify.org?format=json'] } = {}) {
  const matcher = /((25[0-5]|2[0-4]\d|[01]?\d?\d)(\.|$)){4}/;
  for (const source of sources) {
    try {
      const res = await fetch(source);
      if (!res.ok) continue;
      const text = await res.text();
      let payload = text.trim();
      if (payload.startsWith('{') || payload.startsWith('[')) {
        try {
          const parsed = JSON.parse(payload);
          payload = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
        } catch {
          // ignore parse errors, fall through to regex
        }
      }
      const match = payload.match(matcher);
      if (match) {
        return match[0];
      }
    } catch (err) {
      continue;
    }
  }
  return null;
}

