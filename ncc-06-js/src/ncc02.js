import { finalizeEvent, getPublicKey, validateEvent, verifyEvent } from 'nostr-tools/pure';

const DEFAULT_KIND = 30059;

/**
 * Build an NCC-02 service record event.
 */
export function buildNcc02ServiceRecord({
  secretKey,
  serviceId,
  endpoint,
  fingerprint,
  expirySeconds = 14 * 24 * 60 * 60,
  createdAt,
  kind = DEFAULT_KIND
}) {
  if (!secretKey) {
    throw new Error('secretKey is required');
  }
  const timestamp = createdAt ?? Math.floor(Date.now() / 1000);
  const expiresAt = timestamp + Number(expirySeconds);
  const tags = [
    ['d', serviceId],
    ['exp', expiresAt.toString()]
  ];
  if (endpoint) tags.push(['u', endpoint]);
  if (fingerprint) tags.push(['k', fingerprint]);

  const event = {
    kind,
    pubkey: getPublicKey(secretKey),
    created_at: timestamp,
    tags,
    content: ''
  };
  return finalizeEvent(event, secretKey);
}

export function parseNcc02Tags(event) {
  if (!event || !Array.isArray(event.tags)) {
    return {};
  }
  return Object.fromEntries(event.tags);
}

export function validateNcc02(event, { expectedAuthor, expectedD, now, allowExpired = false } = {}) {
  if (!event || event.kind !== DEFAULT_KIND) {
    return false;
  }
  if (!validateEvent(event) || !verifyEvent(event)) {
    return false;
  }
  const tags = parseNcc02Tags(event);
  if (expectedAuthor && event.pubkey !== expectedAuthor) {
    return false;
  }
  if (expectedD && tags.d !== expectedD) {
    return false;
  }
  const timestamp = now ?? Math.floor(Date.now() / 1000);
  const exp = Number(tags.exp) || 0;
  if (!allowExpired && exp > 0 && timestamp > exp) {
    return false;
  }
  return true;
}
