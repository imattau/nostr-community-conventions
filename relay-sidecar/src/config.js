import { readFileSync } from 'fs';
import path from 'path';
import { fromNsec, fromNpub, toNpub } from 'ncc-06-js';
import { getPublicKey } from 'nostr-tools/pure';

export function loadConfig(configPath = './config.json') {
  const absolutePath = path.resolve(process.cwd(), configPath);
  let fileConfig = {};
  
  try {
    fileConfig = JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw new Error(`Failed to load config at ${absolutePath}: ${err.message}`);
    }
  }

  const nsec = process.env.SERVICE_NSEC || fileConfig.service_nsec;
  if (!nsec) {
    throw new Error('SERVICE_NSEC is required (env or config.json)');
  }

  const sk = fromNsec(nsec);
  const pk = getPublicKey(sk);

  return {
    secretKey: sk,
    publicKey: pk,
    npub: toNpub(pk),
    serviceId: process.env.SERVICE_ID || fileConfig.service_id || 'relay',
    locatorId: process.env.LOCATOR_ID || fileConfig.locator_id || 'relay-locator',
    endpoints: fileConfig.endpoints || [],
    publicationRelays: fileConfig.publication_relays || [],
    refreshIntervalMinutes: Number(fileConfig.refresh_interval_minutes || 360),
    ncc02ExpiryDays: Number(fileConfig.ncc02_expiry_days || 3),
    ncc05TtlHours: Number(fileConfig.ncc05_ttl_hours || 12),
    statePath: path.resolve(process.cwd(), fileConfig.state_path || './state.json')
  };
}
