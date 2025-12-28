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
    { protocol: 'wss', url: 'wss://secure', k: null }
  ]);
  assert.equal(result.endpoint, null);
  assert.equal(result.reason, 'missing-k');
});

test('supports custom allowedProtocols and validates https k', () => {
  const endpoints = [
    { protocol: 'https', url: 'https://secure', k: 'key', priority: 1 },
    { protocol: 'http', url: 'http://insecure', priority: 2 }
  ];
  const result = choosePreferredEndpoint(endpoints, {
    allowedProtocols: ['https', 'http'],
    expectedK: 'key'
  });
  assert.equal(result.endpoint.url, 'https://secure');
});

test('rejects https with mismatched k', () => {
  const endpoints = [
    { protocol: 'https', url: 'https://secure', k: 'wrong', priority: 1 }
  ];
  const result = choosePreferredEndpoint(endpoints, {
    allowedProtocols: ['https'],
    expectedK: 'key'
  });
  assert.equal(result.endpoint, null);
  assert.equal(result.reason, 'k-mismatch');
});
