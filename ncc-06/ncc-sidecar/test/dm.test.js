import test from 'node:test';
import assert from 'node:assert';
import { nip44 } from 'nostr-tools';
import { getPublicKey } from 'nostr-tools/pure';
import { sendInviteDM } from '../src/dm.js';

test('sendInviteDM encrypts with NIP-44 so clients can decrypt', async () => {
  const secretKey = '1'.repeat(64);
  const recipientPubkey = getPublicKey('2'.repeat(64));
  const relays = ['wss://example.com'];
  const message = 'Onion rotation completed';
  let capturedEvent = null;

  const result = await sendInviteDM({
    secretKey,
    recipientPubkey,
    message,
    relays,
    broadcast: async (broadcastRelays, event) => {
      capturedEvent = event;
      assert.deepStrictEqual(broadcastRelays, relays);
      return true;
    }
  });

  assert.strictEqual(result, true);
  assert.ok(capturedEvent);
  assert.deepStrictEqual(capturedEvent.tags.find(tag => tag[0] === 'encryption'), ['encryption', 'nip44']);

  const conversationKey = nip44.getConversationKey(secretKey, recipientPubkey);
  const decrypted = nip44.decrypt(capturedEvent.content, conversationKey);
  assert.strictEqual(decrypted, message);
});
