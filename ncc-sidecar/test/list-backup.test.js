import { test } from 'node:test';
import assert from 'node:assert';
import { generateSecretKey } from 'nostr-tools/pure';
import { buildBackupPayload, createBackupEvent, parseBackupEvent } from '../src/list-backup.js';

test('buildBackupPayload omits sensitive Tor config', () => {
  const payload = buildBackupPayload({
    services: [{
      service_id: 'relay',
      name: 'Relay',
      type: 'relay',
      config: {
        protocols: { ipv4: true },
        onion_private_key: 'secret',
        tor_control: { host: '127.0.0.1', password: 'pw' },
        publication_relays: ['wss://nos.lol']
      }
    }],
    admins: [{ pubkey: 'b5d34eefc7d8f81ceaa5ed377b5a2d534ee949fae0c5ab3bae0a576aa7475cbf' }],
    appConfig: { allow_remote: true }
  });

  assert.strictEqual(payload.version, 1);
  assert.strictEqual(payload.services.length, 1);
  assert.strictEqual(payload.services[0].config.onion_private_key, undefined);
  assert.strictEqual(payload.services[0].config.tor_control, undefined);
  assert.deepStrictEqual(payload.appConfig, { allow_remote: true });
});

test('createBackupEvent signs and parseBackupEvent validates roundtrip', () => {
  const secretKey = generateSecretKey();
  const payload = buildBackupPayload({
    services: [{
      service_id: 'relay',
      name: 'Relay',
      type: 'relay',
      config: { protocols: { ipv4: true } }
    }],
    admins: [],
    appConfig: { publication_relays: ['wss://nos.lol'] }
  });
  const event = createBackupEvent({ secretKey, payload, createdAt: 1234567890 });
  const parsed = parseBackupEvent(event);
  assert.strictEqual(parsed.version, 1);
  assert.deepStrictEqual(parsed.appConfig, payload.appConfig);
  assert.deepStrictEqual(parsed.services, payload.services);
});
