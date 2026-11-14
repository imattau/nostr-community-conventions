import { test } from 'node:test';
import { strict as assert } from 'assert';
import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';
import {
  DEFAULT_BOOTSTRAP_RELAYS,
  NCC05Publisher,
  NCC05Resolver
} from '../dist/index.js';
import { MockRelay } from '../dist/mock-relay.js';

const now = () => Math.floor(Date.now() / 1000);

function payload(url, ttl = 3600, updatedAt = now()) {
  return {
    v: 1,
    ttl,
    updated_at: updatedAt,
    endpoints: [{ type: 'http', url, priority: 1, family: 'ipv4' }]
  };
}

async function withRelay(fn, options = {}) {
  const relay = new MockRelay(0, options);
  await relay.ready();
  const relayUrl = `ws://127.0.0.1:${relay.port}`;
  const pool = new SimplePool();
  try {
    await fn({ relay, pool, relayUrl });
  } finally {
    pool.close([relayUrl]);
    await relay.stop();
  }
}

test('resolve uses the requested d tag when the identity has several services', async () => {
  await withRelay(async ({ pool, relayUrl }) => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const publisher = new NCC05Publisher({ pool });

    await publisher.publish([relayUrl], sk, payload('http://api.example:8080'), {
      identifier: 'api',
      public: true
    });
    await publisher.publish([relayUrl], sk, payload('http://web.example:8080'), {
      identifier: 'web',
      public: true
    });

    const resolver = new NCC05Resolver({ bootstrapRelays: [relayUrl], pool });
    const api = await resolver.resolve(pk, undefined, 'api');
    const web = await resolver.resolve(pk, undefined, 'web');

    assert.equal(api?.endpoints[0].url, 'http://api.example:8080');
    assert.equal(web?.endpoints[0].url, 'http://web.example:8080');
  });
});

test('resolve falls through a malformed newest event to a valid older one', async () => {
  await withRelay(
    async ({ pool, relayUrl }) => {
      const sk = generateSecretKey();
      const pk = getPublicKey(sk);
      const publisher = new NCC05Publisher({ pool });

      await publisher.publish([relayUrl], sk, payload('http://fallback.example:8080'), {
        identifier: 'fallback',
        public: true
      });

      const malformed = finalizeEvent(
        {
          kind: 30058,
          created_at: now() + 1,
          tags: [['d', 'fallback']],
          content: 'not json'
        },
        sk
      );
      await pool.publish([relayUrl], malformed);

      const resolver = new NCC05Resolver({ bootstrapRelays: [relayUrl], pool });
      const result = await resolver.resolve(pk, undefined, 'fallback');

      assert.equal(result?.endpoints[0].url, 'http://fallback.example:8080');
    },
    { replaceable: false }
  );
});

test('resolve falls through an undecryptable newest event', async () => {
  await withRelay(
    async ({ pool, relayUrl }) => {
      const sk = generateSecretKey();
      const pk = getPublicKey(sk);
      const otherSk = generateSecretKey();
      const publisher = new NCC05Publisher({ pool });

      await publisher.publish([relayUrl], sk, payload('http://public.example:8080'), {
        identifier: 'private-then-public',
        public: true
      });

      const encrypted = nip44.encrypt(
        JSON.stringify(payload('http://private.example:8080', 3600, now() + 1)),
        nip44.getConversationKey(otherSk, pk)
      );
      const privateEvent = finalizeEvent(
        {
          kind: 30058,
          created_at: now() + 1,
          tags: [['d', 'private-then-public']],
          content: encrypted
        },
        sk
      );
      await pool.publish([relayUrl], privateEvent);

      const resolver = new NCC05Resolver({ bootstrapRelays: [relayUrl], pool });
      const readerSk = generateSecretKey(); // not the recipient
      const result = await resolver.resolve(pk, readerSk, 'private-then-public');

      assert.equal(result?.endpoints[0].url, 'http://public.example:8080');
    },
    { replaceable: false }
  );
});

test('default bootstrap relays are real relay URLs', () => {
  assert.ok(DEFAULT_BOOTSTRAP_RELAYS.length > 0);
  for (const relay of DEFAULT_BOOTSTRAP_RELAYS) {
    assert.match(relay, /^wss?:\/\//);
    assert.ok(!relay.includes('npub1...'));
  }
});

test('expired records are never returned, even without strict mode', async () => {
  await withRelay(async ({ pool, relayUrl }) => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const publisher = new NCC05Publisher({ pool });

    await publisher.publish(
      [relayUrl],
      sk,
      payload('http://expired.example:8080', 1, now() - 10),
      { identifier: 'expired', public: true }
    );

    const resolver = new NCC05Resolver({ bootstrapRelays: [relayUrl], pool });
    assert.equal(await resolver.resolve(pk, undefined, 'expired', { strict: false }), null);
    assert.equal(await resolver.resolve(pk, undefined, 'expired', { strict: true }), null);
  });
});
