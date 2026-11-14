import { test } from 'node:test';
import { strict as assert } from 'assert';
import { buildLocatorPayload, normalizeLocatorEndpoints, validateLocatorFreshness } from '../src/ncc05.js';

test('locator payload builds and validates freshness', () => {
  const payload = buildLocatorPayload({
    ttl: 60,
    endpoints: [{ url: 'ws://example.com', protocol: 'ws', priority: 1 }]
  });
  assert.equal(payload.ttl, 60);
  assert.ok(Array.isArray(payload.endpoints));
  assert.ok(validateLocatorFreshness(payload, { now: payload.updated_at + 10 }));
  assert.ok(!validateLocatorFreshness(payload, { now: payload.updated_at + 70 }));
});

test('normalizes locator endpoints', () => {
  const items = normalizeLocatorEndpoints([
    { url: 'wss://host', priority: 2, k: 'TESTKEY:1' },
    { uri: 'ws://host2', prio: 1 }
  ]);
  assert.equal(items[0].protocol, 'wss');
  assert.equal(items[1].protocol, 'ws');
});

test('infers the scheme and defaults priority to 1000', () => {
  const items = normalizeLocatorEndpoints([
    { uri: 'https://host' },
    { uri: 'http://host:8080' },
    { uri: 'wss://host' },
    { uri: '192.0.2.1:8080' }
  ]);

  assert.equal(items[0].protocol, 'https');
  assert.equal(items[1].protocol, 'http');
  assert.equal(items[2].protocol, 'wss');
  assert.equal(items[3].protocol, 'http');
  assert.equal(items[3].priority, 1000);
});

test('treats scheme-less uri as http so http(s) clients can use it', () => {
  const [endpoint] = normalizeLocatorEndpoints([{ uri: '203.0.113.10:8080' }]);
  assert.equal(endpoint.protocol, 'http');
  assert.equal(endpoint.url, '203.0.113.10:8080');
});
