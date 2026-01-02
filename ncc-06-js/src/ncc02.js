import { NCC02Builder, verifyNCC02Event } from 'ncc-02-js';

const DEFAULT_EXPIRY_SECONDS = 14 * 24 * 60 * 60;

function ensureSecretKey(key) {
  if (!key) {
    throw new Error('secretKey is required');
  }
  return key;
}

export async function buildNcc02ServiceRecord({
  secretKey,
  serviceId,
  endpoint,
  fingerprint,
  expirySeconds = DEFAULT_EXPIRY_SECONDS,
  isPrivate = false,
  privateRecipients
}) {
  ensureSecretKey(secretKey);
  if (!serviceId) {
    throw new Error('serviceId is required');
  }
  const builder = new NCC02Builder(secretKey);
  const expiryDays = Number(expirySeconds) / (24 * 60 * 60);
  return builder.createServiceRecord({
    serviceId,
    endpoint,
    fingerprint,
    expiryDays,
    isPrivate,
    privateRecipients
  });
}

export function parseNcc02Tags(event) {
  if (!event || !Array.isArray(event.tags)) {
    return {};
  }
  return Object.fromEntries(event.tags);
}

export function validateNcc02(event, { expectedAuthor, expectedD, now, allowExpired = false } = {}) {
  if (!event || event.kind !== 30059) {
    return false;
  }
  if (!verifyNCC02Event(event)) {
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
