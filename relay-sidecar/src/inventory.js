import { buildExternalEndpoints } from 'ncc-06-js';

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
    wsPort: 80,
    wssPort: 443,
    ensureOnionService: async () => null
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
