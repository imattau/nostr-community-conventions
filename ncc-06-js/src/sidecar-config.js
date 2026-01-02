import { normalizeRelayUrl } from './external-endpoints.js';

const RELAY_MODE_PUBLIC = 'public';
const RELAY_MODE_PRIVATE = 'private';

function normalizeRelayMode(mode) {
  if (!mode) {
    return RELAY_MODE_PUBLIC;
  }
  const value = mode.toLowerCase();
  if (value !== RELAY_MODE_PUBLIC && value !== RELAY_MODE_PRIVATE) {
    throw new Error(`relayMode (or serviceMode) must be "${RELAY_MODE_PUBLIC}" or "${RELAY_MODE_PRIVATE}"`);
  }
  return value;
}

function uniqueList(arr) {
  return [...new Set(arr.filter(Boolean))];
}

export function getRelayMode(config = {}) {
  return normalizeRelayMode(config.relayMode || config.serviceMode);
}

export function setRelayMode(config = {}, mode) {
  const normalized = normalizeRelayMode(mode);
  return { ...config, relayMode: normalized, serviceMode: normalized };
}

/**
 * Build configuration for the NCC-06 Sidecar.
 */
export function buildSidecarConfig({
  secretKey,
  serviceUrl,
  relayUrl,
  serviceId = 'relay',
  locatorId = 'relay-locator',
  publicationRelays = [],
  publishRelays,
  persistPath,
  certPath,
  relayMode,
  serviceMode
}) {
  if (!secretKey) {
    throw new Error('secretKey is required');
  }
  
  const primaryUrl = serviceUrl || relayUrl;
  
  if (!primaryUrl) {
    throw new Error('serviceUrl (or relayUrl) is required');
  }

  const normalizedPrimaryUrl = normalizeRelayUrl(primaryUrl);
  const normalizedPublicationRelays = uniqueList([normalizedPrimaryUrl, ...publicationRelays]);
  const normalizedPublishRelays = uniqueList([
    normalizedPrimaryUrl,
    ...(publishRelays ?? normalizedPublicationRelays)
  ]);
  
  const mode = relayMode || serviceMode;
  const normalizedMode = normalizeRelayMode(mode);

  return {
    secretKey,
    serviceUrl: normalizedPrimaryUrl,
    relayUrl: normalizedPrimaryUrl, // Backward compatibility
    serviceId,
    locatorId,
    publicationRelays: normalizedPublicationRelays,
    publishRelays: normalizedPublishRelays,
    persistPath,
    certPath,
    relayMode: normalizedMode,
    serviceMode: normalizedMode // Alias
  };
}

/**
 * Build configuration for the NCC-06 Client.
 */
export function buildClientConfig({
  serviceIdentityUri,
  serviceNpub, // Deprecated, but supported
  servicePubkey,
  serviceUrl,
  relayUrl,
  publicationRelays = [],
  serviceId = 'relay',
  locatorId = 'relay-locator',
  ncc02ExpectedKey
}) {
  if (!serviceIdentityUri && !serviceNpub) {
    throw new Error('serviceIdentityUri (or serviceNpub) is required');
  }
  
  const primaryUrl = serviceUrl || relayUrl;

  if (!primaryUrl) {
    throw new Error('serviceUrl (or relayUrl) is required');
  }
  
  const normalizedPrimaryUrl = normalizeRelayUrl(primaryUrl);
  const publicationList = uniqueList([normalizedPrimaryUrl, ...publicationRelays]);

  return {
    serviceIdentityUri: serviceIdentityUri || (serviceNpub ? `wss://${serviceNpub}` : null),
    servicePubkey,
    serviceUrl: normalizedPrimaryUrl,
    relayUrl: normalizedPrimaryUrl, // Backward compatibility
    publicationRelays: publicationList,
    serviceId,
    locatorId,
    ncc02ExpectedKey
  };
}
