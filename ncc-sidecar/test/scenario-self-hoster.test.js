import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';
globalThis.WebSocket = WebSocket;

import { createMockRelay } from './mock-relay.js';
import { runPublishCycle } from '../src/app.js';
import { initDb } from '../src/db.js';
import { generateKeypair, resolveServiceEndpoint } from 'ncc-06-js';
import { finalizeEvent } from 'nostr-tools/pure';

test('Scenario: Self-Hoster with Dynamic IP and Onion Fallback', async () => {
  // 1. Setup Identities
  const { secretKey: serviceSk, publicKey: servicePk, npub: serviceNpub } = generateKeypair();
  
  // 2. Start Infrastructure
  const serviceRelay = createMockRelay();   // The actual relay being hosted
  const discoveryRelay = createMockRelay(); // The public bootstrap relay (e.g. Damus)
  
  const serviceUrl = serviceRelay.url();
  const discoveryUrl = discoveryRelay.url();
  const mockOnion = 'ws://v76zt...fake.onion:80';

  const dbPath = path.resolve(process.cwd(), './test-self-hoster.db');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  initDb(dbPath);

  // 3. Configure Sidecar for this service
  const config = {
    secretKey: serviceSk,
    publicKey: servicePk,
    npub: serviceNpub,
    serviceId: 'relay',
    locatorId: 'relay-locator',
    endpoints: [
      { url: mockOnion, family: 'onion', priority: 10 },
      { url: serviceUrl, family: 'ipv4', priority: 1 } 
    ],
    publicationRelays: [discoveryUrl],
    refreshIntervalMinutes: 60,
    ncc02ExpiryDays: 1,
    ncc05TtlHours: 1,
    service_mode: 'public',
    protocols: { ipv4: true, ipv6: true, tor: true },
    primary_protocol: 'ipv4'
  };

  try {
    // 4. Run Sidecar (Publish discovery records to the bootstrap relay)
    console.log('[Test] Running Sidecar publish cycle...');
    // We pass empty probe results to ensure it uses our manual test endpoints
    await runPublishCycle(config, { last_full_publish_timestamp: 0 }, {}, {});
    
    console.log('[Test] Sidecar publish complete.');
    // Give some time for the mock relays to "receive" the events
    await new Promise(r => setTimeout(r, 1000));

    // 5. Client Resolution (The "Discovery" phase)
    console.log('[Test] Client resolving service via bootstrap relay (Choice A: Onion Prefer)...');
    
    // Test Choice A: Client is Tor-capable and prefers Onion
    const resOnion = await resolveServiceEndpoint({
      bootstrapRelays: [discoveryUrl],
      servicePubkey: servicePk,
      serviceId: 'relay',
      locatorId: 'relay-locator',
      torPreferred: true,
      ncc05TimeoutMs: 2000,
      publicationRelayTimeoutMs: 2000
    });
    console.log('[Test] Resolved Choice A:', resOnion.endpoint);

    assert.strictEqual(resOnion.endpoint, mockOnion, 'Should resolve to onion when Tor is preferred');
    assert.strictEqual(resOnion.source, 'locator', 'Should have used NCC-05 locator');

    console.log('[Test] Client resolving service via bootstrap relay (Choice B: IP Prefer)...');
    // Test Choice B: Client is NOT Tor-capable, falls back to reachable IP
    const resLocal = await resolveServiceEndpoint({
      bootstrapRelays: [discoveryUrl],
      servicePubkey: servicePk,
      serviceId: 'relay',
      locatorId: 'relay-locator',
      torPreferred: false,
      ncc05TimeoutMs: 2000,
      publicationRelayTimeoutMs: 2000
    });
    console.log('[Test] Resolved Choice B:', resLocal.endpoint);

    assert.strictEqual(resLocal.endpoint, serviceUrl, 'Should resolve to local IP when Tor is NOT preferred');

    if (resLocal.endpoint.includes('.onion')) {
      throw new Error('Test failed: Resolved to onion when expecting local IP. Check selector priority logic.');
    }

    // 6. Meaningful Action: Client connects to the resolved service and publishes an event
    console.log(`[Test] Client connecting to resolved endpoint: ${resLocal.endpoint}`);
    const clientWs = new WebSocket(resLocal.endpoint);
    
    const meaningfulAction = new Promise((resolve, reject) => {
      console.log('[Test] inside meaningfulAction promise');
      const { secretKey: clientSk } = generateKeypair();
      const testEvent = finalizeEvent({
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: 'Hello from discovered relay!'
      }, clientSk);

      clientWs.on('open', () => {
        console.log('[Test] clientWs opened');
        clientWs.send(JSON.stringify(['EVENT', testEvent]));
      });

      clientWs.on('message', (data) => {
        const raw = data.toString();
        console.log('[Test] clientWs received message:', raw);
        const msg = JSON.parse(raw);
        if (msg[0] === 'OK' && msg[1] === testEvent.id) {
          console.log('[Test] Successfully performed meaningful action on discovered relay!');
          clientWs.close();
          resolve(true);
        } else {
          console.log('[Test] Message did not match expected OK for', testEvent.id);
        }
      });

      clientWs.on('error', (err) => {
        console.error('[Test] clientWs error:', err);
        reject(err);
      });
      
      setTimeout(() => { 
        clientWs.close(); 
        reject(new Error('Action timeout waiting for OK for ' + testEvent.id)); 
      }, 10000);

    });

    const success = await meaningfulAction;
    assert.ok(success, 'Meaningful action should succeed');

  } finally {
    await serviceRelay.close();
    await discoveryRelay.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  }
});