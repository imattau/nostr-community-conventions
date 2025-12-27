import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { getPublicKey, nip19 } from 'nostr-tools';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const rootConfigPath = path.resolve(projectRoot, 'config.json');
const rootConfig = JSON.parse(readFileSync(rootConfigPath, 'utf-8'));
const RELAY_URL = rootConfig.relayUrl || 'ws://127.0.0.1:7000';

const sidecarConfigPath = path.resolve(projectRoot, 'ncc06-sidecar/config.json');
const clientConfigPath = path.resolve(projectRoot, 'ncc06-client/config.json');

const SERVICE_SEED = process.env.NCC06_SERVICE_SEED || 'ncc06-service-seed';
const LOCATOR_FRIEND_SEED = process.env.NCC06_LOCATOR_FRIEND_SEED || 'ncc06-locator-friend-seed';

const serviceSk = crypto.createHash('sha256').update(SERVICE_SEED).digest('hex');
const servicePk = getPublicKey(serviceSk);
const serviceNpub = nip19.npubEncode(servicePk);

const locatorFriendSk = crypto.createHash('sha256').update(LOCATOR_FRIEND_SEED).digest('hex');
const locatorFriendPk = getPublicKey(locatorFriendSk);

const defaultSidecarConfig = {
  serviceSk,
  servicePk,
  serviceNpub,
  relayUrl: RELAY_URL,
  ncc02ExpectedKey: 'TESTKEY:relay-local-dev-1',
  ncc02ExpSeconds: 1209600,
  ncc05TtlSeconds: 3600,
  serviceId: 'relay',
  locatorId: 'relay-locator',
  torControl: {
    enabled: false,
    host: '127.0.0.1',
    port: 9051,
    password: '',
    servicePort: 80,
    serviceFile: './onion-service.json',
    timeout: 5000
  }
};

const defaultClientConfig = {
  relayUrl: RELAY_URL,
  serviceIdentityUri: `wss://${serviceNpub}`,
  servicePubkey: servicePk,
  serviceNpub,
  ncc02ExpectedKey: defaultSidecarConfig.ncc02ExpectedKey,
  serviceId: defaultSidecarConfig.serviceId,
  locatorId: defaultSidecarConfig.locatorId,
  torPreferred: false,
  ncc05TimeoutMs: 5000,
  locatorSecretKey: locatorFriendSk,
  locatorFriendPubkey: locatorFriendPk
};

const ensureFile = (filePath, payload) => {
  if (existsSync(filePath)) return;
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(payload, null, 2));
  console.log(`[setup] Created ${path.relative(projectRoot, filePath)}.`);
};

const main = () => {
  ensureFile(sidecarConfigPath, defaultSidecarConfig);
  ensureFile(clientConfigPath, defaultClientConfig);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
