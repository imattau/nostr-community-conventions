import { test } from 'node:test';
import assert from 'node:assert';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { 
  buildAdminRecoveryPayload, createAdminRecoveryEvent, parseBackupEvent 
} from '../src/list-backup.js';

test('Admin Recovery: build, encrypt for admin, and decrypt', async () => {
  const sidecarSecretKey = generateSecretKey();
  const adminSecretKey = generateSecretKey();
  const adminPubkey = getPublicKey(adminSecretKey);

  const sidecarService = {
    service_id: 'mysidecar',
    service_nsec: 'nsec1...', // dummy for this test logic
    config: {
      onion_private_key: 'onion-secret-key'
    }
  };

  const payload = buildAdminRecoveryPayload(sidecarService);
  assert.strictEqual(payload.sidecar_nsec, sidecarService.service_nsec);
  assert.strictEqual(payload.onion_private_key, 'onion-secret-key');

  // Sidecar encrypts for Admin
  const event = createAdminRecoveryEvent({
    secretKey: sidecarSecretKey,
    adminPubkey: adminPubkey,
    payload
  });

  // Admin decrypts using THEIR secretKey and the Sidecar's pubkey
  const sidecarPubkey = getPublicKey(sidecarSecretKey);
  const parsed = parseBackupEvent(event, adminSecretKey, sidecarPubkey);
  
  assert.strictEqual(parsed.sidecar_nsec, sidecarService.service_nsec);
  assert.strictEqual(parsed.onion_private_key, 'onion-secret-key');
});
