import crypto from 'crypto';
import { buildRecords } from '../builder.js';
import { NCC05Publisher } from 'ncc-05-js';
import { addLog } from '../db.js';

const locatorPublisher = new NCC05Publisher({ timeout: 5000 });

export async function buildEncryptedLocatorEvent({ publicationRelays, recipients, payload, secretKey, identifier, service }) {
  if (!recipients.length || !publicationRelays.length) return null;
  try {
    if (recipients.length === 1) {
      return await locatorPublisher.publish(publicationRelays, secretKey, payload, {
        identifier,
        recipientPubkey: recipients[0],
        privateLocator: true
      });
    }
    return await locatorPublisher.publishWrapped(publicationRelays, secretKey, recipients, payload, {
      identifier,
      privateLocator: true
    });
  } catch (err) {
    console.warn(`[Registry] Failed to encrypt NCC-05 locator for ${service.name}: ${err.message}`);
    addLog('error', `Encrypted NCC-05 publish failed for ${service.name}: ${err.message}`, {
      serviceId: service.id,
      error: err.message
    });
    return null;
  }
}

export function computeInventoryHash(inventory, profile) {
  const stableInventory = inventory.map(e => ({ url: e.url, priority: e.priority, family: e.family }));
  const stableProfile = {
    name: profile?.name,
    about: profile?.about,
    picture: profile?.picture
  };
  return crypto.createHash('sha256')
    .update(JSON.stringify(stableInventory))
    .update(JSON.stringify(stableProfile))
    .digest('hex');
}

export function computePrimaryHash(endpoint) {
  const primarySignature = endpoint
    ? `${endpoint.url}|${endpoint.family || ''}|${endpoint.protocol || ''}|${endpoint.k || ''}`
    : 'none';
  return crypto.createHash('sha256')
    .update(primarySignature)
    .digest('hex');
}

export async function prepareServiceRecords({ service, filteredInventory, normalizedRecipients, secretKey, publicKey }) {
  const { ncc02Event, ncc05EventTemplate: baselineNcc05Event, locatorPayload } = await buildRecords({
    ...service.config,
    ncc02ExpiryDays: service.config.ncc02_expiry_days || 14,
    ncc05TtlHours: service.config.ncc05_ttl_hours || 1,
    secretKey,
    publicKey,
    serviceId: service.service_id,
    locatorId: service.service_id + '-locator'
  }, filteredInventory, {
    privateRecipients: normalizedRecipients
  });

  return { ncc02Event, baselineNcc05Event, locatorPayload };
}
