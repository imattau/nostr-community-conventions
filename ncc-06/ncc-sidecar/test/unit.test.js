import { test } from 'node:test';
import assert from 'node:assert';
import { buildInventory } from '../src/inventory.js';
import { buildRecords } from '../src/builder.js';
import { generateKeypair } from 'ncc-06-js';

test('inventory sorting logic', async () => {
  const endpoints = [
    { url: 'ws://ipv4', family: 'ipv4', priority: 50 },
    { url: 'ws://onion.onion', family: 'onion', priority: 50 },
    { url: 'wss://secure', family: 'ipv4', priority: 10, k: 'key' }
  ];

  const config = {
    protocols: { ipv4: true, ipv6: true, tor: true },
    primary_protocol: 'ipv4',
    endpoints: endpoints
  };

  const inventory = await buildInventory(config, {}, {});
  
  // Since primary_protocol is 'ipv4', ws://ipv4 should get priority 1 and be first
  assert.strictEqual(inventory[0].url, 'ws://ipv4');
  assert.strictEqual(inventory[0].priority, 1);
  
  // wss://secure (priority 10) was NOT the primary family, so it stays or is pushed
  // Actually our logic pushes non-primary down.
  assert.strictEqual(inventory[1].url, 'wss://secure');
  
  // onion should be in there too
  assert.ok(inventory.find(e => e.family === 'onion'));
});

test('inventory respects preferred protocol override', async () => {
  const config = {
    protocols: { ipv4: true },
    preferred_protocol: 'https',
    port: 8443
  };
  const inventory = await buildInventory(config, { ipv4: '203.0.113.5' }, {});
  const ipv4Endpoint = inventory.find(ep => ep.family === 'ipv4');
  assert.ok(ipv4Endpoint, 'Expected an IPv4 endpoint');
  assert.strictEqual(ipv4Endpoint.protocol, 'https');
  assert.strictEqual(ipv4Endpoint.url, 'https://203.0.113.5:8443');
});

test('builder produces deterministic events', async () => {
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

  const { ncc02Event, ncc05EventTemplate } = await buildRecords(config, inventory);

  assert.strictEqual(ncc02Event.kind, 30059);
  assert.strictEqual(ncc02Event.pubkey, publicKey);
  
  const dTag = ncc02Event.tags.find(t => t[0] === 'd');
  assert.strictEqual(dTag[1], 'test-service');

  assert.strictEqual(ncc05EventTemplate.kind, 30058);
  const locDTag = ncc05EventTemplate.tags.find(t => t[0] === 'd');
  assert.strictEqual(locDTag[1], 'test-locator');
});
