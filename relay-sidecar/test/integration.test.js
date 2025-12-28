import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { createMockRelay } from './mock-relay.js';
import { runPublishCycle } from '../src/app.js';
import { generateKeypair } from 'ncc-06-js';

test('integration: full publish cycle to local mock relay', async () => {
  const relay = createMockRelay();
  const relayUrl = relay.url();
  const { secretKey, publicKey, npub } = generateKeypair();
  
  const statePath = path.resolve(process.cwd(), './test-state.json');
  if (fs.existsSync(statePath)) fs.unlinkSync(statePath);

  const config = {
    secretKey,
    publicKey,
    npub,
    serviceId: 'relay',
    locatorId: 'relay-locator',
    endpoints: [{ url: 'ws://localhost:7000', priority: 1 }],
    publicationRelays: [relayUrl],
    refreshIntervalMinutes: 60,
    ncc02ExpiryDays: 1,
    ncc05TtlHours: 1,
    statePath
  };

  const initialState = {
    last_published_ncc02_id: null,
    last_endpoints_hash: null,
    last_success_per_relay: {},
    last_full_publish_timestamp: 0
  };

  try {
    const newState = await runPublishCycle(config, initialState);

    // Wait for async publish to settle
    await new Promise(r => setTimeout(r, 3000));

    const events = relay.receivedEvents();
    
    // We expect 2 events: NCC-02 (30059) and NCC-05 (30058)
    assert.strictEqual(events.length, 2);
    
    const kinds = events.map(e => e.kind);
    assert.ok(kinds.includes(30059));
    assert.ok(kinds.includes(30058));

    assert.strictEqual(newState.last_success_per_relay[relayUrl].success, true);
    assert.ok(newState.last_published_ncc02_id);
    assert.ok(fs.existsSync(statePath));

  } finally {
    await relay.close();
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  }
});
