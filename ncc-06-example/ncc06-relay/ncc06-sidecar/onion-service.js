import fs from 'fs';
import path from 'path';

import { TorControl } from './tor-control.js';

export async function ensureOnionEndpoint({ torControl, cacheFile, relayPort }) {
  if (!torControl?.enabled) {
    return null;
  }

  const baseDir = path.resolve(__dirname);
  const resolvedCache = path.resolve(baseDir, torControl.serviceFile || cacheFile || './onion-service.json');
  let saved = null;
  if (fs.existsSync(resolvedCache)) {
    try {
      const data = fs.readFileSync(resolvedCache, 'utf-8');
      saved = JSON.parse(data);
    } catch (err) {
      console.warn('[Sidecar] Failed to parse cached onion data:', err.message);
    }
  }

  const client = new TorControl({
    host: torControl.host,
    port: torControl.port,
    password: torControl.password,
    timeout: torControl.timeout
  });

  try {
    await client.connect();
    await client.authenticate();

    const keySpec = saved?.privateKey ? saved.privateKey : 'NEW:ED25519-V3';
    const servicePort = torControl.servicePort || 80;
    const localPort = relayPort;
    const portMapping = `${servicePort},127.0.0.1:${localPort}`;
    const response = await client.addOnion(keySpec, portMapping);
    const serviceId = response.ServiceID;
    const privateKey = response.PrivateKey ?? saved?.privateKey;

    if (!serviceId || !privateKey) {
      throw new Error('Tor control did not return service id or private key');
    }

    const record = {
      serviceId,
      privateKey,
      servicePort,
      createdAt: Date.now()
    };
    fs.writeFileSync(resolvedCache, JSON.stringify(record, null, 2));

    return {
      address: `${serviceId}.onion`,
      servicePort
    };
  } finally {
    client.close();
  }
}
