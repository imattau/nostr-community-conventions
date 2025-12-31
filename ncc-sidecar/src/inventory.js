import fs from 'fs';
import { buildExternalEndpoints } from 'ncc-06-js';

/**
 * Builds a multimodal list of endpoints using detection and user preferences.
 */
export async function buildInventory(config = {}, networkProbe = {}, _torStatus = {}) {
  const { protocols = {}, primary_protocol = 'ipv4' } = config;
  
  // If we have manual endpoints in config, we use them. 
  // Otherwise we use detected ones.
  const manualEndpoints = config.endpoints || [];
  
  // Use ncc-06-js helper for high-level detection
  const detectedEndpoints = await buildExternalEndpoints({
    tor: { enabled: !!protocols.tor },
    ipv4: { enabled: !!protocols.ipv4, address: networkProbe.ipv4 },
    ipv6: { enabled: !!protocols.ipv6, address: networkProbe.ipv6 },
    wsPort: config.port || 80,
    wssPort: config.port || 443,
    ncc02ExpectedKey: config.ncc02ExpectedKey || null,
    ensureOnionService: async () => {
      // 1. Check for manual onion address in config
      if (config.onion_address) {
        return { address: config.onion_address, servicePort: 80 };
      }
      
      // 2. Check for hostname file path
      if (config.onion_hostname_path && fs.existsSync(config.onion_hostname_path)) {
        try {
          const hostname = fs.readFileSync(config.onion_hostname_path, 'utf8').trim();
          return { address: hostname, servicePort: 80 };
        } catch (err) {
          console.warn('[Inventory] Failed to read onion hostname file:', err.message);
        }
      }

      // 3. Use pre-provisioned address from app.js (if any)
      if (config.torAddress) {
        return { address: config.torAddress, servicePort: 80 };
      }
      
      return null;
    }
  });

  // Combine: manual ones take precedence if they match a family we want to use
  let finalEndpoints = [...manualEndpoints];
  
  // If no manual ones for a family that is enabled, add detected
  if (protocols.ipv4 && !finalEndpoints.some(e => e.family === 'ipv4') && networkProbe.ipv4) {
    const d = detectedEndpoints.find(e => e.family === 'ipv4');
    if (d) finalEndpoints.push(d);
  }
  if (protocols.ipv6 && !finalEndpoints.some(e => e.family === 'ipv6') && networkProbe.ipv6) {
    const d = detectedEndpoints.find(e => e.family === 'ipv6');
    if (d) finalEndpoints.push(d);
  }
  if (protocols.tor && !finalEndpoints.some(e => e.family === 'onion')) {
    const d = detectedEndpoints.find(e => e.family === 'onion');
    if (d) finalEndpoints.push(d);
  }

  // Adjust priorities and schemes based on primary_protocol and service type
  const expectedKey = config.ncc02ExpectedKey;
  const secureProtocols = new Set(['wss', 'https', 'tls', 'tcps']);

  return finalEndpoints.map(ep => {
    let priority = ep.priority || 100;
    if (ep.family === primary_protocol) {
      priority = 1; // Boost the preferred one to the top
    } else {
      // Keep its existing priority or push down
      if (priority === 1) priority = 10; 
    }

    // Adjust URI scheme based on service type
    let url = ep.url;
    const isWeb = config.type === 'blossom' || config.type === 'custom';
    
    if (isWeb) {
      if (url.startsWith('ws://')) url = url.replace('ws://', 'http://');
      if (url.startsWith('wss://')) url = url.replace('wss://', 'https://');
    }

    // Force http for onion if web service
    if (ep.family === 'onion' && isWeb && url.startsWith('ws://')) {
        url = url.replace('ws://', 'http://');
    }

    const normalizedProtocol = url.split('://')[0].toLowerCase();
    const endpoint = { ...ep, url, priority, protocol: normalizedProtocol };
    if (!endpoint.k && expectedKey && secureProtocols.has(normalizedProtocol)) {
      endpoint.k = expectedKey;
    }
    const fingerprint = endpoint.k || expectedKey;
    return { ...endpoint, tlsFingerprint: fingerprint };

  }).sort((a, b) => a.priority - b.priority);
}
