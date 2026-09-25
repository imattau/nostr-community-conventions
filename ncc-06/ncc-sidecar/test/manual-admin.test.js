import { test } from 'node:test';
import assert from 'node:assert';
import { nip19 } from 'nostr-tools';
import { parseManualAdminPubkey } from '../ui/src/lib/adminKeyParser.js';

const knownHex = 'b5d34eedc7d8f81ceaa5ed377b5a2d534ee949fae0c5ab3bae0a576aa7475cbf';
const knownNpub = nip19.npubEncode(knownHex);

test('parseManualAdminPubkey accepts npub bech32 variants', () => {
  assert.strictEqual(parseManualAdminPubkey(knownNpub), knownHex);
  assert.strictEqual(parseManualAdminPubkey(knownNpub.toUpperCase()), knownHex);
  assert.strictEqual(parseManualAdminPubkey(`  ${knownNpub} `), knownHex);
});

test('parseManualAdminPubkey accepts raw hex string', () => {
  assert.strictEqual(parseManualAdminPubkey(knownHex), knownHex);
  assert.strictEqual(parseManualAdminPubkey(knownHex.toUpperCase()), knownHex);
});

test('parseManualAdminPubkey rejects garbage input', () => {
  assert.throws(() => parseManualAdminPubkey('foo'), /invalid admin pubkey/);
  assert.throws(() => parseManualAdminPubkey('npub1loremipsumxxxxxxxxxxxxxx'), /Invalid npub/);
});
