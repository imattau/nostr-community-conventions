import { test } from 'node:test';
import { strict as assert } from 'assert';
import { buildNcc02ServiceRecord, parseNcc02Tags, validateNcc02 } from '../src/ncc02.js';
import { generateKeypair } from '../src/keys.js';

test('builds and validates NCC-02 service record', async () => {
  const { secretKey, publicKey } = generateKeypair();
  const recipients = ['cipher-text-1', 'cipher-text-2'];
  const serviceEvent = await buildNcc02ServiceRecord({
    secretKey,
    serviceId: 'relay',
    endpoint: 'wss://127.0.0.1:7447',
    fingerprint: 'TESTKEY:resolver',
    expirySeconds: 60,
    isPrivate: true,
    privateRecipients: recipients
  });

  assert.equal(serviceEvent.pubkey, publicKey);
  const tags = parseNcc02Tags(serviceEvent);
  assert.equal(tags.d, 'relay');
  assert.equal(tags.u, 'wss://127.0.0.1:7447');
  assert.equal(tags.k, 'TESTKEY:resolver');
  assert.equal(tags.private, 'true');
  const privateTagCount = serviceEvent.tags.filter(t => t[0] === 'privateRecipients').length;
  assert.strictEqual(privateTagCount, recipients.length);
  assert.ok(validateNcc02(serviceEvent, { expectedAuthor: publicKey, expectedD: 'relay' }));
});
