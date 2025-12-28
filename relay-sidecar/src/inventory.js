import { buildExternalEndpoints } from 'ncc-06-js';

/**
 * Builds a multimodal list of endpoints using detection and user preferences.
 */
export async function buildInventory(config, networkProbe, torStatus) {
  const { protocols, primary_protocol } = config;
  
  // Use ncc-06-js helper for high-level detection and assembly
  const endpoints = await buildExternalEndpoints({
    tor: { enabled: protocols.tor },
    ipv4: { enabled: protocols.ipv4, address: networkProbe.ipv4 },
    ipv6: { enabled: protocols.ipv6, address: networkProbe.ipv6 },
    // We can add ports if we want them configurable later
    wsPort: 80,
    wssPort: 443,
    ensureOnionService: async () => {
      if (!protocols.tor || !torStatus?.running) return null;
      // In a real management scenario, we'd fetch the actual .onion here.
      // For now, if we don't have one, we use a placeholder or the detected one.
      // Since Tor check doesn't return the address yet, we'll assume it's external or manual for now.
      return null; 
    }
  });

  // Adjust priorities based on primary_protocol preference
  return endpoints.map(ep => {
    let priority = ep.priority;
    if (ep.family === primary_protocol) {
      priority = 1; // Boost the preferred one to the top
    } else {
      priority = ep.priority + 10; // Push others down
    }
    return { ...ep, priority };
  });
}