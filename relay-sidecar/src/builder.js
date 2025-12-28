import { buildNcc02ServiceRecord, buildLocatorPayload } from 'ncc-06-js';

export function buildRecords(config, inventory) {
  // 1. Build NCC-02 Service Record
  // We use the first endpoint as the 'u' value fallback if possible
  const primaryEndpoint = inventory[0]?.url || '';
  const primaryK = inventory[0]?.k || null;

  const ncc02Event = buildNcc02ServiceRecord({
    secretKey: config.secretKey,
    serviceId: config.serviceId,
    endpoint: primaryEndpoint,
    fingerprint: primaryK,
    expirySeconds: config.ncc02ExpiryDays * 24 * 60 * 60
  });

  // 2. Build NCC-05 Locator Payload
  const locatorPayload = buildLocatorPayload({
    endpoints: inventory,
    ttl: config.ncc05TtlHours * 3600
  });

  // Build the NCC-05 Event manually or via a helper if added later
  // For now, we'll build it here using the same identity
  const createdAt = Math.floor(Date.now() / 1000);
  const expiration = createdAt + locatorPayload.ttl;
  
  const ncc05EventTemplate = {
    kind: 30058,
    pubkey: config.publicKey,
    created_at: createdAt,
    tags: [
      ['d', config.locatorId],
      ['expiration', expiration.toString()]
    ],
    content: JSON.stringify(locatorPayload)
  };

  // Note: finalizedEvent will be done in the app/publisher to ensure fresh timestamps if needed
  
  return {
    ncc02Event,
    ncc05EventTemplate,
    locatorPayload
  };
}
