import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TorControl } from './tor-control.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function ensureOnionEndpoint({ torControl, cacheFile, localPort }) {
  // If explicitly disabled, skip
  if (torControl?.enabled === false) {
    return null;
  }

  // Determine cache file location
  const resolvedCache = cacheFile 
    ? path.resolve(process.cwd(), cacheFile) 
    : path.resolve(process.cwd(), 'onion-service.json');

  let saved = null;
  if (fs.existsSync(resolvedCache)) {
    try {
      const data = fs.readFileSync(resolvedCache, 'utf-8');
      saved = JSON.parse(data);
    } catch (err) {
      console.warn('[Sidecar] Failed to parse cached onion data:', err.message);
    }
  }

  // Use configured control port or defaults
  const client = new TorControl({
    host: torControl?.host || '127.0.0.1',
    port: torControl?.port || 9051,
    password: torControl?.password,
    timeout: 2000 // Short timeout to avoid hanging
  });

  try {
    await client.connect();
    
    // Attempt authentication (empty if no password provided)
    try {
      await client.authenticate();
    } catch (err) {
      // If auth fails, maybe we don't need it? Or password wrong.
      // Re-throw if password was provided.
      if (torControl?.password) throw err;
      // Otherwise, assume it might be fine or will fail on command
      console.warn('[Onion] Auth failed/skipped (might be required):', err.message);
    }

    const keySpec = saved?.privateKey ? saved.privateKey : 'NEW:ED25519-V3';
    const servicePort = 80; // Standard HTTP/WS port for Onion
    const targetPort = localPort || 3000;
    const portMapping = `${servicePort},127.0.0.1:${targetPort}`;
    
    const response = await client.addOnion(keySpec, portMapping);
    const serviceId = response.ServiceID;
    const privateKey = response.PrivateKey ?? saved?.privateKey;

    if (!serviceId) {
      throw new Error('Tor control did not return service id');
    }

    // Save only if we have a private key (to persist identity)
    if (privateKey) {
      const record = {
        serviceId,
        privateKey,
        servicePort,
        createdAt: Date.now()
      };
      fs.writeFileSync(resolvedCache, JSON.stringify(record, null, 2));
    }

    return {
      address: `${serviceId}.onion`,
      servicePort
    };
  } catch (err) {
    // Return error details so caller can decide (e.g. show Red dot)
    throw err;
  } finally {
    client.close();
  }
}
