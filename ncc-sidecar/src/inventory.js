import fs from 'fs';
import { buildExternalEndpoints } from 'ncc-06-js';
import { ensureOnionEndpoint } from './onion-service.js';

/**
 * Builds a multimodal list of endpoints using detection and user preferences.
 */
export async function buildInventory(config = {}, networkProbe = {}, torStatus = {}) {
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
    ensureOnionService: async () => {
      // 1. Check for manual onion address in config
      if (config.onion_address) {
        return { address: config.onion_address, servicePort: config.port || 80 };
      }
      
      // 2. Check for hostname file path
      if (config.onion_hostname_path && fs.existsSync(config.onion_hostname_path)) {
        try {
          const hostname = fs.readFileSync(config.onion_hostname_path, 'utf8').trim();
          return { address: hostname, servicePort: config.port || 80 };
        } catch (err) {
          console.warn('[Inventory] Failed to read onion hostname file:', err.message);
        }
      }

      // 3. Attempt to create/retrieve via Tor Control
      try {
        const torRes = await ensureOnionEndpoint({
          torControl: {
            enabled: true,
            host: config.tor_control?.host || '127.0.0.1',
            port: config.tor_control?.port || 9051,
            password: config.tor_control?.password
          },
          cacheFile: config.onion_cache_file || `./onion-${config.service_id || 'service'}.json`,
          localPort: config.local_port || config.port || 3000
        });
        if (torRes) {
          return { address: torRes.address, servicePort: torRes.servicePort };
        }
      } catch (err) {
        // Log specifically so we can see why it failed (e.g. auth required)
        console.warn(`[Inventory] Tor control failed: ${err.message}`);
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

  // Adjust priorities based on primary_protocol preference
  return finalEndpoints.map(ep => {
    let priority = ep.priority || 100;
    if (ep.family === primary_protocol) {
      priority = 1; // Boost the preferred one to the top
    } else {
      // Keep its existing priority or push down
      if (priority === 1) priority = 10; 
    }
    return { ...ep, priority };
  }).sort((a, b) => a.priority - b.priority);
}