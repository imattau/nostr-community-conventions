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
