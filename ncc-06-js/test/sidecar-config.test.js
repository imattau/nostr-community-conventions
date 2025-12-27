import { test } from 'node:test';
import { strict as assert } from 'assert';
import {
  buildSidecarConfig,
  buildClientConfig,
  getRelayMode,
  setRelayMode
} from '../src/sidecar-config.js';

test('buildSidecarConfig constructs expected fields based on inputs', () => {
  const cfg = buildSidecarConfig({
    serviceSk: 'sk',
    servicePk: 'pk',
    serviceNpub: 'npub',
    relayUrl: 'ws://localhost:7000',
    k: { mode: 'static', value: 'TESTKEY:abc' },
    publicationRelays: ['ws://aux:7001'],
    externalEndpoints: {
      ipv4: { enabled: true, protocol: 'ws', address: '127.0.0.1', port: 7447 }
    }
  });

  assert.equal(cfg.serviceSk, 'sk');
  assert.equal(cfg.ncc02ExpectedKey, 'TESTKEY:abc');
  assert.deepEqual(cfg.publicationRelays[0], 'ws://localhost:7000');
  assert.ok(cfg.publishRelays.length >= 1);
});

test('buildClientConfig enforces identity URI and relays', () => {
  const client = buildClientConfig({
    relayUrl: 'ws://relay',
    servicePubkey: 'pk',
    serviceNpub: 'npub',
    expectedK: 'TESTKEY:abc',
    publicationRelays: ['ws://relay', 'ws://aux']
  });

  assert.equal(client.serviceIdentityUri, 'wss://npub');
  assert.equal(client.publicationRelays.length, 2);
  assert.equal(client.ncc02ExpectedKey, 'TESTKEY:abc');
});

test('getRelayMode default and setter', () => {
  assert.equal(getRelayMode({}), 'public');
  assert.equal(getRelayMode({ relayMode: 'private' }), 'private');
  const config = setRelayMode({}, 'private');
  assert.equal(config.relayMode, 'private');
  assert.throws(() => setRelayMode({}, 'unknown'));
});
