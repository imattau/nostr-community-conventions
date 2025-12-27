import { strict as assert } from 'assert';
import { test } from 'node:test';
import { computeKFromCertPem, getExpectedK } from '../src/k.js';
import { readFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import path from 'path';
import os from 'os';

test('computeKFromCertPem produces stable base64url output', () => {
  const certPath = path.resolve('../ncc-06-example/ncc06-relay/certs/server.crt');
  const pem = readFileSync(certPath, 'utf-8');
  const value = computeKFromCertPem(pem);
  assert.equal(value, 'SOXWTCHPUG9ZLaZ4NgH2kKp5Hmqnaj1tXNI90SY44Mw');
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
