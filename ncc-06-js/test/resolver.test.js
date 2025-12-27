import { test } from 'node:test';
import { strict as assert } from 'assert';
import { resolveServiceEndpoint } from '../src/resolver.js';
import { buildNcc02ServiceRecord } from '../src/ncc02.js';
import { buildLocatorPayload } from '../src/ncc05.js';
import { generateKeypair } from '../src/keys.js';

const SERVICE_ID = 'relay';
const LOCATOR_ID = 'relay-locator';

function buildServiceEvent({ secretKey, serviceId, endpoint, fingerprint }) {
  return buildNcc02ServiceRecord({
    secretKey,
    serviceId,
    endpoint,
    fingerprint,
    expirySeconds: 60
  });
}

test('resolver prefers NCC-05 endpoint when k matches', async () => {
  const { secretKey, publicKey } = generateKeypair();
  const serviceEvent = buildServiceEvent({
    secretKey,
    serviceId: SERVICE_ID,
    endpoint: 'wss://fallback',
    fingerprint: 'TESTKEY:match'
  });
  const locatorPayload = buildLocatorPayload({
    ttl: 60,
    endpoints: [
      { url: 'wss://match', protocol: 'wss', priority: 1, k: 'TESTKEY:match' }
    ]
  });

  const result = await resolveServiceEndpoint({
    bootstrapRelays: ['wss://example'],
    servicePubkey: publicKey,
    serviceId: SERVICE_ID,
    locatorId: LOCATOR_ID,
    expectedK: 'TESTKEY:match',
    queryRelayEvents: async () => [serviceEvent],
    resolveLocator: async () => locatorPayload
  });

  assert.equal(result.endpoint, 'wss://match');
  assert.equal(result.source, 'locator');
});

test('resolver falls back to NCC-02 when locator k mismatches', async () => {
  const { secretKey, publicKey } = generateKeypair();
  const serviceEvent = buildServiceEvent({
    secretKey,
    serviceId: SERVICE_ID,
    endpoint: 'wss://fallback',
    fingerprint: 'TESTKEY:match'
  });
  const locatorPayload = buildLocatorPayload({
    ttl: 60,
    endpoints: [
      { url: 'wss://mismatch', protocol: 'wss', priority: 1, k: 'TESTKEY:bad' }
    ]
  });

  const result = await resolveServiceEndpoint({
    bootstrapRelays: ['wss://example'],
    servicePubkey: publicKey,
    serviceId: SERVICE_ID,
    locatorId: LOCATOR_ID,
    expectedK: 'TESTKEY:match',
    queryRelayEvents: async () => [serviceEvent],
    resolveLocator: async () => locatorPayload
  });

  assert.equal(result.endpoint, 'wss://fallback');
  assert.equal(result.source, 'ncc02');
  assert.equal(result.selection.reason, 'fallback');
});
