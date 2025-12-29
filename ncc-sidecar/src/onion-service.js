import { TorControl } from './tor-control.js';

let controlClient = null;
const activeServices = new Map(); // serviceId -> { address, privateKey, servicePort }

async function getClient(config) {
  if (controlClient) return controlClient;

  const client = new TorControl({
    host: config?.host || '127.0.0.1',
    port: config?.port || 9051,
    password: config?.password,
    timeout: 2000
  });

  try {
    await client.connect();
    try {
      await client.authenticate();
    } catch (err) {
      if (config?.password) throw err;
      console.warn('[Onion] Auth failed/skipped:', err.message);
    }
    
    // Handle disconnect to clear state
    client.socket.on('close', () => {
      console.log('[Onion] Control connection closed. Resetting state.');
      controlClient = null;
      activeServices.clear();
    });

    controlClient = client;
    return client;
  } catch (err) {
    client.close();
    throw err;
  }
}

export async function provisionOnion({ serviceId, torControl, privateKey, localPort }) {
  if (torControl?.enabled === false) {
    // If disabled, we might want to remove it if it exists?
    // For now, just return null.
    return null;
  }

  // Check cache first
  const cached = activeServices.get(serviceId);
  if (cached) {
    // If key matches (or we have one and input is undefined), return cached
    if (privateKey === cached.privateKey || (!privateKey && cached.privateKey)) {
      return cached;
    }
    // If key changed, we need to re-provision.
    // Tor ADD_ONION doesn't support "update" easily without "DEL_ONION" first?
    // Actually, adding a new one is fine, but we should probably clean up old if we knew the ID?
    // Since we don't track the ephemeral ServiceID for deletion easily here without parsing address,
    // we'll just add new. The old one dies when connection closes or we can implement DEL_ONION later.
  }

  const client = await getClient(torControl);

  const keySpec = privateKey ? privateKey : 'NEW:ED25519-V3';
  const servicePort = 80;
  const targetPort = localPort || 3000;
  const portMapping = `${servicePort},127.0.0.1:${targetPort}`;
  
  // No Detached flag, rely on keep-alive
  const response = await client.addOnion(keySpec, portMapping);
  
  const address = `${response.ServiceID}.onion`;
  const newKey = response.PrivateKey || privateKey;

  const result = {
    address,
    privateKey: newKey,
    servicePort
  };

  activeServices.set(serviceId, result);
  return result;
}