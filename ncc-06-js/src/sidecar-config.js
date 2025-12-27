import { DEFAULT_TTL_SECONDS } from './ncc05.js';
import { getExpectedK } from './k.js';

const DEFAULT_TOR_CONTROL = {
  enabled: false,
  host: '127.0.0.1',
  port: 9051,
  password: '',
  servicePort: 80,
  serviceFile: './onion-service.json',
  timeout: 5000
};

function uniqueList(items) {
  const seen = new Set();
  return items.filter(item => {
    if (!item) return false;
    const normalized = item.trim();
    if (seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

/**
 * Build a deployable sidecar config object that mirrors the example's defaults.
 */
export function buildSidecarConfig({
  serviceSk,
  servicePk,
  serviceNpub,
  relayUrl,
  serviceId = 'relay',
  locatorId = 'relay-locator',
  publicationRelays = [],
  publishRelays,
  ncc02ExpSeconds = 14 * 24 * 60 * 60,
  ncc05TtlSeconds = DEFAULT_TTL_SECONDS,
  torControl = DEFAULT_TOR_CONTROL,
  externalEndpoints = {},
  k = {},
  baseDir = process.cwd(),
  ncc02ExpectedKeySource
} = {}) {
  if (!serviceSk || !servicePk || !serviceNpub) {
    throw new Error('service keypair must be provided');
  }
  if (!relayUrl) {
    throw new Error('relayUrl is required');
  }

  const expectedKey = getExpectedK({ k, externalEndpoints }, { baseDir });
  const normalizedPublicationRelays = uniqueList([relayUrl, ...publicationRelays]);
  const normalizedPublishRelays = uniqueList([
    relayUrl,
    ...(publishRelays ?? normalizedPublicationRelays)
  ]);
  const keySource = ncc02ExpectedKeySource ?? k.mode ?? 'auto';

  return {
    serviceSk,
    servicePk,
    serviceNpub,
    relayUrl,
    serviceId,
    locatorId,
    publicationRelays: normalizedPublicationRelays,
    publishRelays: normalizedPublishRelays,
    ncc02ExpSeconds,
    ncc05TtlSeconds,
    ncc02ExpectedKey: expectedKey,
    ncc02ExpectedKeySource: keySource,
    externalEndpoints,
    torControl,
    k
  };
}

/**
 * Build a client config that matches the NCC-06 example expectations.
 */
export function buildClientConfig({
  relayUrl,
  servicePubkey,
  serviceNpub,
  serviceIdentityUri,
  locatorSecretKey,
  locatorFriendPubkey,
  publicationRelays = [],
  staleFallbackSeconds = 600,
  torPreferred = false,
  ncc05TimeoutMs = 5000,
  serviceId,
  locatorId,
  expectedK
} = {}) {
  if (!relayUrl) {
    throw new Error('relayUrl is required');
  }
  const identityUri =
    serviceIdentityUri || (serviceNpub ? `wss://${serviceNpub}` : undefined);
  if (!identityUri) {
    throw new Error('serviceIdentityUri or serviceNpub is required');
  }
  if (!servicePubkey) {
    throw new Error('servicePubkey is required');
  }
  const publicationList = uniqueList([relayUrl, ...publicationRelays]);

  return {
    relayUrl,
    serviceIdentityUri: identityUri,
    servicePubkey,
    serviceNpub: serviceNpub ?? '',
    publicationRelays: publicationList,
    staleFallbackSeconds,
    torPreferred,
    ncc05TimeoutMs,
    locatorSecretKey,
    locatorFriendPubkey,
    serviceId,
    locatorId,
    ncc02ExpectedKey: expectedK
  };
}
