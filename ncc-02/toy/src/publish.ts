import { SimplePool } from 'nostr-tools';
import { NCC02Builder } from 'ncc-02-js';
import { NCC05Publisher } from 'ncc-05';
import { CONFIG } from './config';
import { getKeys } from './keys';

export async function publishDemo(customEndpoint?: string) {
  const keys = getKeys();
  const pool = new SimplePool();
  
  console.log("--- Publishing Demo Records ---");
  console.log(`Operator Pubkey: ${keys.operator.pk}`);

  // 1. Publish NCC-02 Service Record
  const builder = new NCC02Builder(keys.operator.sk); 
  // Updated API: createServiceRecord(options)
  const serviceEvent = await builder.createServiceRecord({
      serviceId: CONFIG.serviceId,
      endpoint: "https://public-fallback.demo.com",
      fingerprint: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef", // Dummy fingerprint
      expiryDays: 7
  });

  console.log("Publishing NCC-02 Event...", serviceEvent.id);
  // Using Promise.any for robustness
  await Promise.any(pool.publish(CONFIG.relays, serviceEvent));
  console.log("NCC-02 Published.");

  // 2. Publish NCC-05 Locator
  // Pass existing pool
  const ncc05Pub = new NCC05Publisher({ pool });
  
  const endpoint = customEndpoint || "https://private-premium.demo.com";
  
  console.log(`Publishing NCC-05 Locator for ${keys.authorisedClient.pk}...`);
  
  // New API accepts string keys
  await ncc05Pub.publishWrapped(
      CONFIG.relays,
      keys.operator.sk, // string (hex)
      [keys.authorisedClient.pk],
      {
          v: 1,
          updated_at: Math.floor(Date.now() / 1000),
          ttl: 3600,
          endpoints: [{
              uri: endpoint,
              type: 'https',
              priority: 1,
              family: 'ipv4'
          }]
      },
      CONFIG.serviceId
  );
  
  console.log("NCC-05 Published.");
  
  // Cleanup
  pool.close(CONFIG.relays);
}