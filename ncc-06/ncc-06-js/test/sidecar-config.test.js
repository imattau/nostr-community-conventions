import { test } from 'node:test';
import { strict as assert } from 'assert';
import {
  buildSidecarConfig,
  buildClientConfig,
  getRelayMode,
  setRelayMode
} from '../src/sidecar-config.js';

test('buildSidecarConfig constructs expected fields based on inputs', () => {
  const config = buildSidecarConfig({
    secretKey: 'hex',
    relayUrl: 'wss://test',
    relayMode: 'private'
  });
  assert.equal(config.relayUrl, 'wss://test');
  assert.equal(config.serviceUrl, 'wss://test');
  assert.equal(config.relayMode, 'private');
});

test('buildSidecarConfig supports serviceUrl and serviceMode aliases', () => {
  const config = buildSidecarConfig({
    secretKey: 'hex',
    serviceUrl: 'https://api.example.com',
    serviceMode: 'private'
  });
  assert.equal(config.serviceUrl, 'https://api.example.com');
  assert.equal(config.relayUrl, 'https://api.example.com');
  assert.equal(config.serviceMode, 'private');
  assert.equal(config.relayMode, 'private');
});

test('buildClientConfig enforces identity URI and relays', () => {
  const client = buildClientConfig({
    relayUrl: 'ws://relay',
    servicePubkey: 'pk',
    serviceNpub: 'npub',
    ncc02ExpectedKey: 'TESTKEY:abc',
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
