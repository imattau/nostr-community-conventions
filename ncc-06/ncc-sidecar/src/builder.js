import { buildNcc02ServiceRecord, buildLocatorPayload } from 'ncc-06-js';
import { encryptPrivateRecipients } from 'ncc-02-js';

export async function buildRecords(config, inventory, options = {}) {
  const isPrivate = config.service_mode === 'private';
  const privateRecipients = Array.isArray(options.privateRecipients) ? options.privateRecipients : [];
  const encryptedRecipients = (isPrivate && privateRecipients.length)
    ? await encryptPrivateRecipients(config.secretKey, privateRecipients)
    : undefined;

  // 1. Build NCC-02 Service Record
  // In private mode, we typically don't publish a 'u' tag (endpoint) in the NCC-02 record.
  const primaryEndpoint = isPrivate ? undefined : (inventory[0]?.url || '');
  const primaryK = inventory[0]?.k || null;

  const ncc02Event = await buildNcc02ServiceRecord({
    secretKey: config.secretKey,
    serviceId: config.serviceId,
    endpoint: primaryEndpoint,
    fingerprint: primaryK,
    expirySeconds: config.ncc02ExpiryDays * 24 * 60 * 60,
    isPrivate,
    privateRecipients: encryptedRecipients
  });

  // 2. Build NCC-05 Locator Payload
  const locatorPayload = buildLocatorPayload({
    endpoints: inventory,
    ttl: config.ncc05_ttl_hours * 3600
  });


  const createdAt = Math.floor(Date.now() / 1000);
  const expiration = createdAt + locatorPayload.ttl;
  
  const tags = [
    ['d', config.locatorId],
    ['expiration', expiration.toString()]
  ];

  if (isPrivate) {
    tags.push(['private', 'true']);
  }
  
  const ncc05EventTemplate = {
    kind: 30058,
    pubkey: config.publicKey,
    created_at: createdAt,
    tags,
    content: JSON.stringify(locatorPayload)
  };


  // Note: finalizedEvent will be done in the app/publisher to ensure fresh timestamps if needed
  
  return {
    ncc02Event,
    ncc05EventTemplate,
    locatorPayload
  };
}
