import { test } from 'node:test';
import { strict as assert } from 'assert';
import { choosePreferredEndpoint } from '../src/selector.js';

test('chooses WSS endpoint with matching k', () => {
  const { endpoint, reason } = choosePreferredEndpoint([
    { url: 'wss://match', protocol: 'wss', priority: 1, k: 'TESTKEY:match' }
  ], { expectedK: 'TESTKEY:match' });
  assert.ok(endpoint);
  assert.equal(endpoint.url, 'wss://match');
  assert.equal(reason, undefined);
});

test('rejects mismatched k', () => {
  const result = choosePreferredEndpoint([
    { url: 'wss://bad', protocol: 'wss', priority: 1, k: 'TESTKEY:bad' }
  ], { expectedK: 'TESTKEY:expected' });
  assert.equal(result.reason, 'k-mismatch');
  assert.equal(result.endpoint, null);
});

test('returns missing k reason', () => {
  const result = choosePreferredEndpoint([
    { url: 'wss://no-k', protocol: 'wss', priority: 1 }
  ]);
  assert.equal(result.reason, 'missing-k');
});
