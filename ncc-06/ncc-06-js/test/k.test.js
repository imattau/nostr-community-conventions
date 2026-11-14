import { strict as assert } from 'assert';
import { test } from 'node:test';
import selfsigned from 'selfsigned';
import { computeKFromCertPem, getExpectedK } from '../src/k.js';
import { rmSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';

test('computeKFromCertPem returns a stable 32-byte base64url fingerprint', async () => {
  const { cert } = await selfsigned.generate(
    [{ name: 'commonName', value: 'example.test' }],
    { keySize: 2048, days: 1 }
  );
  const first = computeKFromCertPem(cert);
  const second = computeKFromCertPem(cert);

  assert.equal(first, second);
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(first, 'base64url').length, 32);
});

test('generate mode persists and reuses k value', () => {
  const tmpDir = path.join(os.tmpdir(), `ncc06-k-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const persistPath = path.join(tmpDir, 'k.txt');
  const cfg = { k: { mode: 'generate', persistPath } };

  const first = getExpectedK(cfg);
  assert.equal(first.length, 43); // base64url of 32 bytes

  const second = getExpectedK(cfg);
  assert.equal(second, first);

  rmSync(tmpDir, { recursive: true, force: true });
});

test('missing static value throws error', () => {
  assert.throws(() => getExpectedK({ k: { mode: 'static' } }), /k\.value is required/);
});

test('missing persistPath throws error', () => {
  assert.throws(() => getExpectedK({ k: { mode: 'generate' } }), /k\.persistPath is required/);
});

test('missing certPath throws error', () => {
  assert.throws(() => getExpectedK({ k: { mode: 'tls_spki' } }), /k\.certPath is required/);
});
