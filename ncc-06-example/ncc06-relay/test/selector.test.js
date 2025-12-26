import { strict as assert } from 'assert';
import { test } from 'node:test';
import { normalizeLocatorEndpoints, choosePreferredEndpoint } from '../client/selector.js';

test('choosePreferredEndpoint prefers onion when torPreferred and meets k expectations', () => {
  const endpoints = [
    { url: 'wss://127.0.0.1:7001', protocol: 'wss', family: 'ipv4', priority: 10, k: 'GOOD' },
    { url: 'wss://exampleonion.onion:443', protocol: 'wss', family: 'onion', priority: 5, k: 'GOOD' },
    { url: 'ws://[::1]:7000', protocol: 'ws', family: 'ipv6', priority: 20, k: 'GOOD' }
  ];

  const normalized = normalizeLocatorEndpoints(endpoints);
  const selection = choosePreferredEndpoint(normalized, { torPreferred: true, expectedK: 'GOOD' });
  assert.ok(selection.endpoint, 'Should return a selected endpoint');
  assert.equal(selection.endpoint.url, 'wss://exampleonion.onion:443', 'Tor preferred should pick onion endpoint');
});

test('choosePreferredEndpoint reports reason on k mismatch', () => {
  const endpoints = [
    { url: 'wss://secure.example.com', protocol: 'wss', family: 'ipv4', priority: 3, k: 'BAD' }
  ];

  const normalized = normalizeLocatorEndpoints(endpoints);
  const selection = choosePreferredEndpoint(normalized, { expectedK: 'GOOD' });
  assert.equal(selection.endpoint, null, 'Should not return an endpoint when k is wrong');
  assert.equal(selection.reason, 'k-mismatch');
  assert.equal(selection.expected, 'GOOD');
  assert.equal(selection.actual, 'BAD');
});

test('normalizeLocatorEndpoints detects IPv6 and onion families correctly', () => {
  const endpoints = [
    { url: 'ws://127.0.0.1:7000', protocol: 'ws', priority: 10 },
    { url: 'ws://[::1]:7000', protocol: 'ws', priority: 8 },
    { url: 'wss://exampleonion.onion', protocol: 'wss', priority: 1 }
  ];
  const normalized = normalizeLocatorEndpoints(endpoints);
  const familyMap = Object.fromEntries(normalized.map(ep => [ep.url, ep.family]));
  assert.equal(familyMap['ws://127.0.0.1:7000'], 'ipv4');
  assert.equal(familyMap['ws://[::1]:7000'], 'ipv6');
  assert.equal(familyMap['wss://exampleonion.onion'], 'onion');
});

test('choosePreferredEndpoint falls back to fastest WS IPv6 endpoint when no wss is available', () => {
  const endpoints = [
    { url: 'ws://127.0.0.1:7000', protocol: 'ws', family: 'ipv4', priority: 20 },
    { url: 'ws://[::1]:7001', protocol: 'ws', family: 'ipv6', priority: 5 }
  ];

  const normalized = normalizeLocatorEndpoints(endpoints);
  const selection = choosePreferredEndpoint(normalized, {});
  assert.ok(selection.endpoint, 'Should select an endpoint even without wss');
  assert.equal(selection.endpoint.url, 'ws://[::1]:7001', 'Should prefer lower-priority IPv6 ws endpoint');
});
