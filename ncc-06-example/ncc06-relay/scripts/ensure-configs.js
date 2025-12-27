import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { getPublicKey, nip19 } from 'nostr-tools';
import { getExpectedK } from '../../../ncc-06-js/src/k.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const rootConfigPath = path.resolve(projectRoot, 'config.json');
const rootConfig = JSON.parse(readFileSync(rootConfigPath, 'utf-8'));
const RELAY_URL = rootConfig.relayUrl || 'ws://127.0.0.1:7000';
const RELAY_HOST = rootConfig.relayHost || '127.0.0.1';
const RELAY_PORT = rootConfig.relayPort || 7000;
const RELAY_WSS_PORT = rootConfig.relayWssPort || 7447;

const sidecarConfigPath = path.resolve(projectRoot, 'ncc06-sidecar/config.json');
const clientConfigPath = path.resolve(projectRoot, 'ncc06-client/config.json');

const SERVICE_SEED = process.env.NCC06_SERVICE_SEED || 'ncc06-service-seed';
const LOCATOR_FRIEND_SEED = process.env.NCC06_LOCATOR_FRIEND_SEED || 'ncc06-locator-friend-seed';

const serviceSk = crypto.createHash('sha256').update(SERVICE_SEED).digest('hex');
const servicePk = getPublicKey(serviceSk);
const serviceNpub = nip19.npubEncode(servicePk);

const locatorFriendSk = crypto.createHash('sha256').update(LOCATOR_FRIEND_SEED).digest('hex');
const locatorFriendPk = getPublicKey(locatorFriendSk);

const NCC02_KEY_SOURCE = process.env.NCC06_NCC02_KEY_SOURCE || 'cert';
const SIDE_CAR_DIR = path.resolve(projectRoot, 'ncc06-sidecar');
const defaultExternalEndpoints = {
  ipv4: {
    enabled: true,
    protocol: 'wss',
    address: RELAY_HOST,
    port: RELAY_WSS_PORT,
    publicSources: ['https://api.ipify.org?format=json']
  },
  ipv6: {
    enabled: false,
    protocol: 'wss'
  }
};

const determineKMode = () => {
  const envMode = process.env.NCC06_K_MODE;
  if (envMode) return envMode;
  if (NCC02_KEY_SOURCE === 'generate') return 'generate';
  if (NCC02_KEY_SOURCE === 'test') return 'static';
  return 'tls_spki';
};

const deriveKConfig = () => {
  const mode = determineKMode();
  const config = { mode };
  if (mode === 'static') {
    config.value = 'TESTKEY:relay-local-dev-1';
  } else if (mode === 'tls_spki') {
    const certPath = path.resolve(__dirname, '..', rootConfig.relayTlsCert || './certs/server.crt');
    const relativePath = path.relative(SIDE_CAR_DIR, certPath);
    config.certPath = relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
  } else if (mode === 'generate') {
    config.persistPath = './k.txt';
  }
  return config;
};

const kConfig = deriveKConfig();
const expectedK = getExpectedK(
  { k: kConfig, externalEndpoints: defaultExternalEndpoints },
  { baseDir: SIDE_CAR_DIR }
);

const defaultSidecarConfig = {
  serviceSk,
  servicePk,
  serviceNpub,
  relayUrl: RELAY_URL,
  ncc02ExpectedKey: expectedK,
  ncc02ExpectedKeySource: kConfig.mode,
  ncc02ExpSeconds: 1209600,
  ncc05TtlSeconds: 3600,
  publicationRelays: [RELAY_URL],
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
  },
  externalEndpoints: defaultExternalEndpoints,
  k: kConfig
};

const defaultClientConfig = {
  relayUrl: RELAY_URL,
  serviceIdentityUri: `wss://${serviceNpub}`,
  servicePubkey: servicePk,
  serviceNpub,
  ncc02ExpectedKey: expectedK,
  serviceId: defaultSidecarConfig.serviceId,
  locatorId: defaultSidecarConfig.locatorId,
  publicationRelays: [RELAY_URL],
  staleFallbackSeconds: 600,
  torPreferred: false,
  ncc05TimeoutMs: 5000,
  locatorSecretKey: locatorFriendSk,
  locatorFriendPubkey: locatorFriendPk
};
defaultClientConfig.ncc02ExpectedKeySource = defaultSidecarConfig.ncc02ExpectedKeySource;

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
