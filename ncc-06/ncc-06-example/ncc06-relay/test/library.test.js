import { strict as assert } from 'assert';
import { test } from 'node:test';
import { generateSecretKey, getPublicKey, verifyEvent, finalizeEvent } from 'nostr-tools/pure';
import { nip44 } from 'nostr-tools';
import { KINDS, NCC02Builder, NCC02Error, NCC02Resolver } from 'ncc-02-js';
import { NCC05Resolver, NCC05Publisher } from 'ncc-05-js';

// Stub pool that resolves to a pre-signed NCC-05 event.
class StubPool {
  constructor(event) {
    this.event = event;
  }
  querySync() {
    return Promise.resolve([this.event]);
  }
  close() {}
}

class DummyPublisherPool {
  publish(relays, event) {
    return relays.map(() => Promise.resolve(event));
  }
  close() {}
}

const hexToUint8 = hex => new Uint8Array(Buffer.from(hex, 'hex'));

class GossipPool {
  constructor({ locatorEvent, relayListEvent }) {
    this.locatorEvent = locatorEvent;
    this.relayListEvent = relayListEvent;
    this.lastQueryRelays = [];
    this.getCalls = [];
  }

  get() {
    this.getCalls.push(true);
    return Promise.resolve(this.relayListEvent);
  }

  querySync(relays) {
    this.lastQueryRelays = [...relays];
    return Promise.resolve([this.locatorEvent]);
  }

  close() {}
}

class NCC02StubPool {
  constructor({ serviceEvent, attestations = [], revocations = [] }) {
    this.serviceEvent = serviceEvent;
    this.attestations = attestations;
    this.revocations = revocations;
  }

  subscribeMany(_relays, filters, callbacks) {
    const events = [];
    for (const filter of filters) {
      const kind = filter?.kinds?.[0];
      if (kind === KINDS.SERVICE_RECORD && this.serviceEvent) {
        events.push(this.serviceEvent);
      } else if (kind === KINDS.ATTESTATION) {
        events.push(...this.attestations);
      } else if (kind === KINDS.REVOCATION) {
        events.push(...this.revocations);
      }
    }

    setImmediate(() => {
      events.forEach(event => callbacks.onevent(event));
      callbacks.oneose();
    });

    return {
      close() {}
    };
  }

  close() {}
}

test('NCC-02 builder produces verifiable service records, attestations, and revocations', () => {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const builder = new NCC02Builder(sk);

  const serviceEvent = builder.createServiceRecord({
    serviceId: 'relay',
    endpoint: 'wss://127.0.0.1:7001',
    fingerprint: 'TESTKEY:Ncc06TestKey',
    expiryDays: 1
  });

  assert.equal(serviceEvent.kind, 30059, 'Service record must use kind 30059');
  assert.ok(serviceEvent.tags.some(tag => tag[0] === 'd' && tag[1] === 'relay'));
  assert.ok(serviceEvent.tags.some(tag => tag[0] === 'u' && tag[1] === 'wss://127.0.0.1:7001'));
  assert.ok(serviceEvent.tags.some(tag => tag[0] === 'k' && tag[1] === 'TESTKEY:Ncc06TestKey'));
  assert.ok(serviceEvent.tags.some(tag => tag[0] === 'exp'), 'Expiration tag must be present');
  assert.ok(verifyEvent(serviceEvent), 'Service record signature must verify');

  const attestation = builder.createAttestation({
    subjectPubkey: pk,
    serviceId: 'relay',
    serviceEventId: serviceEvent.id,
    level: 'verified',
    validDays: 1
  });
  assert.ok(attestation.tags.some(tag => tag[0] === 'e' && tag[1] === serviceEvent.id));
  assert.equal(attestation.kind, 30060);
  assert.ok(verifyEvent(attestation), 'Attestation signature must verify');

  const revocation = builder.createRevocation({
    attestationId: attestation.id,
    reason: 'test-revoke'
  });
  assert.ok(revocation.tags.some(tag => tag[0] === 'e' && tag[1] === attestation.id));
  assert.equal(revocation.kind, 30061);
  assert.ok(verifyEvent(revocation), 'Revocation signature must verify');
});

async function createLocatorEvent({ sk, payload }) {
  const pk = getPublicKey(sk);
  return finalizeEvent({
    kind: 30058,
    created_at: Math.floor(Date.now() / 1000),
    pubkey: pk,
    tags: [['d', 'relay-locator']],
    content: JSON.stringify(payload)
  }, sk);
}

function toHex(u8) {
  return Buffer.from(u8).toString('hex');
}

test('NCC-05 resolver honors TTL freshness and strict mode', async () => {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const now = Math.floor(Date.now() / 1000);

  const freshPayload = {
    ttl: 600,
    updated_at: now,
    endpoints: [{ url: 'wss://example.com', protocol: 'wss', priority: 1 }]
  };
  const freshEvent = await createLocatorEvent({ sk, payload: freshPayload });
  const freshResolver = new NCC05Resolver({
    pool: new StubPool(freshEvent),
    timeout: 1000
  });
  const resolvedFresh = await freshResolver.resolve(pk, undefined, 'relay-locator', {
    strict: false,
    gossip: false
  });
  assert.ok(resolvedFresh, 'Fresh locator must resolve');
  assert.equal(resolvedFresh.ttl, 600);
  assert.equal(resolvedFresh.endpoints[0].url, 'wss://example.com');
  freshResolver.close();

  const expiredPayload = {
    ttl: -10,
    updated_at: now,
    endpoints: [{ url: 'wss://example.com', protocol: 'wss', priority: 1 }]
  };
  const expiredEvent = await createLocatorEvent({ sk, payload: expiredPayload });
  const expiredResolver = new NCC05Resolver({
    pool: new StubPool(expiredEvent),
    timeout: 1000
  });
  const resolvedExpired = await expiredResolver.resolve(pk, undefined, 'relay-locator', {
    strict: true,
    gossip: false
  });
  assert.equal(resolvedExpired, null, 'Strict mode should reject expired locators');
  expiredResolver.close();
});

test('NCC-05 resolver shares public locators without secrets', async () => {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const payload = {
    ttl: 600,
    updated_at: Math.floor(Date.now() / 1000),
    endpoints: [{ url: 'wss://public.example', protocol: 'wss', priority: 1 }]
  };

  const publicEvent = await createLocatorEvent({ sk, payload });
  const resolver = new NCC05Resolver({
    pool: new StubPool(publicEvent),
    timeout: 1000
  });

  const resolved = await resolver.resolve(pk, undefined, 'relay-locator', {
    strict: false,
    gossip: false
  });
  assert.ok(resolved, 'Public locator must resolve without a locator secret');
  assert.equal(resolved.endpoints[0].url, 'wss://public.example');
  resolver.close();
});

test('NCC-05 resolver decrypts wrapped locators for multiple recipients', async () => {
  const publisherSk = generateSecretKey();
  const publisherPk = getPublicKey(publisherSk);
  const recipientSk = generateSecretKey();
  const recipientPk = getPublicKey(recipientSk);
  const recipient2Sk = generateSecretKey();
  const recipient2Pk = getPublicKey(recipient2Sk);

  const payload = {
    ttl: 300,
    updated_at: Math.floor(Date.now() / 1000),
    endpoints: [{ url: 'wss://wrapped.example', protocol: 'wss', priority: 1 }]
  };

  const publisher = new NCC05Publisher({
    pool: new DummyPublisherPool(),
    timeout: 1000
  });
  const wrappedEvent = await publisher.publishWrapped(
    ['wss://unused'],
    toHex(publisherSk),
    [recipientPk, recipient2Pk],
    payload,
    'relay-locator'
  );
  publisher.close();

  const resolver = new NCC05Resolver({
    pool: new StubPool(wrappedEvent),
    timeout: 1000
  });

  const resolved = await resolver.resolve(publisherPk, toHex(recipientSk), 'relay-locator', {
    strict: false,
    gossip: false
  });
  assert.ok(resolved, 'Wrapped locator should resolve for recipient');
  assert.equal(resolved.endpoints[0].url, 'wss://wrapped.example');

  const resolved2 = await resolver.resolve(publisherPk, toHex(recipient2Sk), 'relay-locator', {
    strict: false,
    gossip: false
  });
  assert.ok(resolved2, 'Wrapped locator should resolve for second recipient');
  resolver.close();
});

test('NCC-05 resolver decrypts targeted friend locator records', async () => {
  const publisherSk = generateSecretKey();
  const publisherPk = getPublicKey(publisherSk);
  const friendSk = generateSecretKey();
  const friendPk = getPublicKey(friendSk);
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    ttl: 300,
    updated_at: now,
    endpoints: [{ url: 'ws://friend.example:9090', protocol: 'ws', priority: 1 }]
  };
  const conversationKey = nip44.getConversationKey(hexToUint8(publisherSk), friendPk);
  const encryptedContent = nip44.encrypt(JSON.stringify(payload), conversationKey);
  const encryptedEvent = finalizeEvent({
    kind: 30058,
    created_at: now,
    pubkey: publisherPk,
    tags: [['d', 'relay-locator']],
    content: encryptedContent
  }, publisherSk);

  const resolver = new NCC05Resolver({
    pool: new StubPool(encryptedEvent),
    bootstrapRelays: ['wss://bootstrap.friend'],
    timeout: 1000
  });

  const publicResolveAttempt = await resolver.resolve(publisherPk, undefined, 'relay-locator', { strict: true, gossip: false });
  assert.equal(publicResolveAttempt, null, 'Friend-to-friend private locator should not resolve without locator secret');

  const resolved = await resolver.resolve(publisherPk, friendSk, 'relay-locator', { strict: true, gossip: false });
  assert.ok(resolved, 'Friend-to-friend encrypted locator should be resolvable');
  assert.equal(resolved.endpoints[0].url, 'ws://friend.example:9090');
  resolver.close();
});

test('NCC-05 resolver extends relays via gossip discovery', async () => {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const payloadEvent = await createLocatorEvent({
    sk,
    payload: {
      ttl: 120,
      updated_at: Math.floor(Date.now() / 1000),
      endpoints: [{ url: 'ws://gossip.example', protocol: 'ws', priority: 1 }]
    }
  });
  const relayListEvent = finalizeEvent({
    kind: 10002,
    created_at: Math.floor(Date.now() / 1000),
    pubkey: pk,
    tags: [
      ['r', 'wss://friend.relays.io'],
      ['r', 'wss://backup.example']
    ],
    content: ''
  }, sk);

  const pool = new GossipPool({ locatorEvent: payloadEvent, relayListEvent });
  const resolver = new NCC05Resolver({
    pool,
    bootstrapRelays: ['wss://bootstrap.example'],
    timeout: 1000
  });

  const resolved = await resolver.resolve(pk, undefined, 'relay-locator', { gossip: true });
  assert.ok(resolved, 'Locator should resolve even with gossip discovery');
  assert.ok(pool.getCalls.length > 0, 'Gossip discovery should be invoked');
  const expectedRelays = ['wss://bootstrap.example', 'wss://friend.relays.io', 'wss://backup.example'];
  assert.deepEqual(pool.lastQueryRelays.sort(), expectedRelays.sort());
  resolver.close();
});

test('NCC-05 resolver returns null for malformed locator payloads', async () => {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const malformedEvent = finalizeEvent({
    kind: 30058,
    created_at: Math.floor(Date.now() / 1000),
    pubkey: pk,
    tags: [['d', 'relay-locator']],
    content: 'not-json'
  }, sk);

  const resolver = new NCC05Resolver({
    pool: new StubPool(malformedEvent),
    bootstrapRelays: ['wss://bootstrap.invalid'],
    timeout: 1000
  });

  const payload = await resolver.resolve(pk, undefined, 'relay-locator', { gossip: false });
  assert.equal(payload, null, 'Malformed content should not resolve');
  resolver.close();
});

test('NCC-05 resolver ignores payloads with missing endpoints', async () => {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const missingPayloadEvent = finalizeEvent({
    kind: 30058,
    created_at: Math.floor(Date.now() / 1000),
    pubkey: pk,
    tags: [['d', 'relay-locator']],
    content: JSON.stringify({ ttl: 100, updated_at: Math.floor(Date.now() / 1000) })
  }, sk);

  const resolver = new NCC05Resolver({
    pool: new StubPool(missingPayloadEvent),
    bootstrapRelays: ['wss://bootstrap.invalid'],
    timeout: 1000
  });

  const payload = await resolver.resolve(pk, undefined, 'relay-locator', { gossip: false });
  assert.equal(payload, null, 'Payloads without endpoints should be treated as invalid');
  resolver.close();
});

test('NCC-02 resolver honors trusted CA attestations', async () => {
  const serviceSk = generateSecretKey();
  const servicePk = getPublicKey(serviceSk);
  const serviceBuilder = new NCC02Builder(serviceSk);
  const serviceEvent = serviceBuilder.createServiceRecord({
    serviceId: 'relay',
    endpoint: 'wss://example.com',
    fingerprint: 'TESTKEY:trusted',
    expiryDays: 1
  });

  const caSk = generateSecretKey();
  const caPk = getPublicKey(caSk);
  const caBuilder = new NCC02Builder(caSk);
    const attestation = caBuilder.createAttestation({
      subjectPubkey: servicePk,
      serviceId: 'relay',
      serviceEventId: serviceEvent.id
    });

  const pool = new NCC02StubPool({ serviceEvent, attestations: [attestation] });
  const resolver = new NCC02Resolver(['wss://placeholder'], {
    pool,
    trustedCAPubkeys: [caPk]
  });

  const resolved = await resolver.resolve(servicePk, 'relay', { requireAttestation: true });
  assert.equal(resolved.endpoint, 'wss://example.com');
  assert.equal(resolved.fingerprint, 'TESTKEY:trusted');
  assert.equal(resolved.attestations.length, 1);
});

test('NCC-02 resolver rejects untrusted attestation sources', async () => {
  const serviceSk = generateSecretKey();
  const servicePk = getPublicKey(serviceSk);
  const serviceBuilder = new NCC02Builder(serviceSk);
  const serviceEvent = serviceBuilder.createServiceRecord({
    serviceId: 'relay',
    endpoint: 'wss://example.com',
    fingerprint: 'TESTKEY:trusted',
    expiryDays: 1
  });

  const caSk = generateSecretKey();
  const caBuilder = new NCC02Builder(caSk);
    const attestation = caBuilder.createAttestation({
      subjectPubkey: servicePk,
      serviceId: 'relay',
      serviceEventId: serviceEvent.id
    });

  const pool = new NCC02StubPool({ serviceEvent, attestations: [attestation] });
  const resolver = new NCC02Resolver(['wss://placeholder'], {
    pool,
    trustedCAPubkeys: []
  });

  await assert.rejects(
    () => resolver.resolve(servicePk, 'relay', { requireAttestation: true }),
    err => err instanceof NCC02Error && err.code === 'POLICY_FAILURE'
  );
});

test('NCC-02 resolver rejects attestations that have been revoked', async () => {
  const serviceSk = generateSecretKey();
  const servicePk = getPublicKey(serviceSk);
  const serviceBuilder = new NCC02Builder(serviceSk);
  const serviceEvent = serviceBuilder.createServiceRecord({
    serviceId: 'relay',
    endpoint: 'wss://example.com',
    fingerprint: 'TESTKEY:trusted',
    expiryDays: 1
  });

  const caSk = generateSecretKey();
  const caPk = getPublicKey(caSk);
  const caBuilder = new NCC02Builder(caSk);
    const attestation = caBuilder.createAttestation({
      subjectPubkey: servicePk,
      serviceId: 'relay',
      serviceEventId: serviceEvent.id
    });
    const revocation = caBuilder.createRevocation({
      attestationId: attestation.id
    });

  const pool = new NCC02StubPool({
    serviceEvent,
    attestations: [attestation],
    revocations: [revocation]
  });
  const resolver = new NCC02Resolver(['wss://placeholder'], {
    pool,
    trustedCAPubkeys: [caPk]
  });

  await assert.rejects(
    () => resolver.resolve(servicePk, 'relay', { requireAttestation: true }),
    err => err instanceof NCC02Error && err.code === 'POLICY_FAILURE'
  );
});
