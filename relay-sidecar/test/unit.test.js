import { test } from 'node:test';
import assert from 'node:assert';
import { buildInventory } from '../src/inventory.js';
import { buildRecords } from '../src/builder.js';
import { generateKeypair, toNsec } from 'ncc-06-js';

test('inventory sorting logic', async () => {
  const endpoints = [
    { url: 'ws://ipv4', family: 'ipv4', priority: 50 },
    { url: 'ws://onion.onion', family: 'onion', priority: 50 },
    { url: 'wss://secure', family: 'ipv4', priority: 10, k: 'key' }
  ];

  const inventory = await buildInventory(endpoints);
  
  // Secure wss://secure (priority 10) should be first
  assert.strictEqual(inventory[0].url, 'wss://secure');
  // onion should be next due to family score even if priorities are same
  assert.strictEqual(inventory[1].family, 'onion');
  // insecure ipv4 last
  assert.strictEqual(inventory[2].url, 'ws://ipv4');
});

test('builder produces deterministic events', () => {
  const { secretKey, publicKey } = generateKeypair();
  const config = {
    secretKey,
    publicKey,
    serviceId: 'test-service',
    locatorId: 'test-locator',
    ncc02ExpiryDays: 1,
    ncc05TtlHours: 1
  };
  const inventory = [
    { url: 'wss://test', family: 'ipv4', priority: 1, k: 'key' }
  ];

  const { ncc02Event, ncc05EventTemplate } = buildRecords(config, inventory);

  assert.strictEqual(ncc02Event.kind, 30059);
  assert.strictEqual(ncc02Event.pubkey, publicKey);
  
  const dTag = ncc02Event.tags.find(t => t[0] === 'd');
  assert.strictEqual(dTag[1], 'test-service');

  assert.strictEqual(ncc05EventTemplate.kind, 30058);
  const locDTag = ncc05EventTemplate.tags.find(t => t[0] === 'd');
  assert.strictEqual(locDTag[1], 'test-locator');
});
