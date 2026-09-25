import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { createMockRelay } from './mock-relay.js';
import { runPublishCycle } from '../src/app.js';
import { generateKeypair } from 'ncc-06-js';
import { initDb, addService } from '../src/db.js';

test('integration: full publish cycle to local mock relay', async () => {
  const relay = createMockRelay();
  const relayUrl = relay.url();
  const { nsec } = generateKeypair();
  
  const dbPath = path.resolve(process.cwd(), './test-integration-1.db');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  initDb(dbPath);

  const service = {
    id: 1,
    name: 'Test Service',
    service_id: 'relay',
    service_nsec: nsec,
    config: {
      publication_relays: [relayUrl],
      refresh_interval_minutes: 60,
      ncc02_expiry_days: 1,
      ncc05_ttl_hours: 1,
      protocols: { ipv4: true, ipv6: true, tor: true },
      primary_protocol: 'ipv4'
    },
    state: {
      last_published_ncc02_id: null,
      last_endpoints_hash: null,
      last_primary_endpoint_hash: null,
      last_success_per_relay: {},
      last_full_publish_timestamp: 0
    }
  };

  // Add to DB so updateService works
  addService(service);

  try {
    const newState = await runPublishCycle(service);

    // Wait for async publish to settle
    await new Promise(r => setTimeout(r, 1000));

    const events = relay.receivedEvents();
    
    // We expect 2 events: NCC-02 (30059) and NCC-05 (30058)
    assert.strictEqual(events.length, 2);
    
    const kinds = events.map(e => e.kind);
    assert.ok(kinds.includes(30059));
    assert.ok(kinds.includes(30058));

    assert.strictEqual(newState.last_success_per_relay[relayUrl].success, true);
    assert.ok(newState.last_published_ncc02_id);
    assert.ok(fs.existsSync(dbPath), 'Database file should exist');

  } finally {
    await relay.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  }
});


test('integration: change detection logic (IP and Onion changes)', async () => {
  const relay = createMockRelay();
  const relayUrl = relay.url();
  const { nsec } = generateKeypair();
  const dbPath = path.resolve(process.cwd(), './test-integration-2.db');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  initDb(dbPath);

  const service = {
    id: 1,
    name: 'Test Service',
    service_id: 'relay',
    service_nsec: nsec,
    config: {
      publication_relays: [relayUrl],
      refresh_interval_minutes: 60,
      ncc02_expiry_days: 1,
      ncc05_ttl_hours: 1,
      protocols: { ipv4: true, ipv6: true, tor: true },
      primary_protocol: 'ipv4'
    },
    state: {
      last_published_ncc02_id: null,
      last_endpoints_hash: null,
      last_primary_endpoint_hash: null,
      last_success_per_relay: {},
      last_full_publish_timestamp: 0
    }
  };

  addService(service);

  try {
    // 1. Initial Publish
    console.log('--- Step 1: Initial ---');
    const state1 = await runPublishCycle(service);
    await new Promise(r => setTimeout(r, 500));
    assert.strictEqual(relay.receivedEvents().length, 2, 'Should publish initial events');

    // 2. Same Config (Should skip)
    console.log('--- Step 2: No Change ---');
    const service2 = { ...service, state: state1 };
    const state2 = await runPublishCycle(service2);
    assert.strictEqual(relay.receivedEvents().length, 2, 'Should NOT publish when nothing changed');

    // 3. Force change by altering state's hash
    console.log('--- Step 3: Change Detection ---');
    const service3 = { ...service2, state: { ...state2, last_endpoints_hash: 'stale' } };
    await runPublishCycle(service3);
    await new Promise(r => setTimeout(r, 500));
    const events = relay.receivedEvents();
    assert.strictEqual(events.length, 3, 'Should publish only NCC-05 when locator hash changes');
    assert.strictEqual(events.at(-1)?.kind, 30058, 'Last event should be NCC-05 locator update');

  } finally {
    await relay.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  }
});
