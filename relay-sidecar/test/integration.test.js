import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { createMockRelay } from './mock-relay.js';
import { runPublishCycle } from '../src/app.js';
import { generateKeypair } from 'ncc-06-js';
import { initDb } from '../src/db.js';

test('integration: full publish cycle to local mock relay', async () => {
  const relay = createMockRelay();
  const relayUrl = relay.url();
  const { secretKey, publicKey, npub } = generateKeypair();
  
  const statePath = path.resolve(process.cwd(), './test-state.json');
  const dbPath = path.resolve(process.cwd(), './test-integration-1.db');
  if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  initDb(dbPath);

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
    assert.ok(fs.existsSync(dbPath), 'Database file should exist');

  } finally {
    await relay.close();
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  }
});


test('integration: change detection logic (IP and Onion changes)', async () => {
  const relay = createMockRelay();
  const relayUrl = relay.url();
  const { secretKey, publicKey, npub } = generateKeypair();
  const statePath = path.resolve(process.cwd(), './test-state-changes.json');
  const dbPath = path.resolve(process.cwd(), './test-integration-2.db');
  if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  initDb(dbPath);

  const configBase = {
    secretKey, publicKey, npub,
    serviceId: 'relay', locatorId: 'relay-locator',
    publicationRelays: [relayUrl],
    refreshIntervalMinutes: 60, ncc02ExpiryDays: 1, ncc05TtlHours: 1,
    statePath
  };

  try {
    let state = { last_full_publish_timestamp: 0 };

    // 1. Initial Publish
    console.log('--- Step 1: Initial ---');
    const config1 = { ...configBase, endpoints: [{ url: 'ws://1.1.1.1:7000', priority: 1 }] };
    state = await runPublishCycle(config1, state);
    await new Promise(r => setTimeout(r, 500));
    assert.strictEqual(relay.receivedEvents().length, 2, 'Should publish initial events');

    // 2. Same Config (Should skip)
    console.log('--- Step 2: No Change ---');
    state = await runPublishCycle(config1, state);
    assert.strictEqual(relay.receivedEvents().length, 2, 'Should NOT publish when nothing changed');

    // 3. IP Change
    console.log('--- Step 3: IP Change ---');
    const config2 = { ...configBase, endpoints: [{ url: 'ws://2.2.2.2:7000', priority: 1 }] };
    state = await runPublishCycle(config2, state);
    await new Promise(r => setTimeout(r, 500));
    assert.strictEqual(relay.receivedEvents().length, 4, 'Should publish when IP changes');

    // 4. Onion Change
    console.log('--- Step 4: Onion Change ---');
    const config3 = { ...configBase, endpoints: [{ url: 'ws://abcdef.onion:7000', priority: 1 }] };
    state = await runPublishCycle(config3, state);
    await new Promise(r => setTimeout(r, 500));
    assert.strictEqual(relay.receivedEvents().length, 6, 'Should publish when Onion address changes');

  } finally {
    await relay.close();
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  }
});

