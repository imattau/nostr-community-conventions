import { strict as assert } from 'assert';
import { test } from 'node:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { ensureOnionEndpoint } from '../ncc06-sidecar/onion-service.js';

test('ensureOnionEndpoint provisions and reuses an onion service via Tor control', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ncc06-onion-'));
  const cachePath = path.join(tempDir, 'onion-service.json');
  const torControlConfig = { enabled: true, servicePort: 123 };

  const response = [{ serviceId: 'example123', privateKey: 'ED25519-V3:cached' }];
  const { TorControlClass, calls } = makeFakeTorControl(response);
  const result = await ensureOnionEndpoint({
    torControl: torControlConfig,
    cacheFile: cachePath,
    relayPort: 7000,
    TorControlClass
  });

  assert.equal(result.address, 'example123.onion');
  assert.equal(result.servicePort, 123);
  assert.equal(calls[0].keySpec, 'NEW:ED25519-V3');
  assert.equal(calls[0].portMapping, '123,127.0.0.1:7000');

  const saved = JSON.parse(await fs.readFile(cachePath, 'utf-8'));
  assert.equal(saved.privateKey, 'ED25519-V3:cached');

  const { TorControlClass: TorControlClass2, calls: calls2 } = makeFakeTorControl(response);
  await ensureOnionEndpoint({
    torControl: torControlConfig,
    cacheFile: cachePath,
    relayPort: 7100,
    TorControlClass: TorControlClass2
  });
  assert.equal(calls2[0].keySpec, 'ED25519-V3:cached');
  assert.equal(calls2[0].portMapping, '123,127.0.0.1:7100');

  await fs.rm(tempDir, { recursive: true, force: true });
});

function makeFakeTorControl(responses) {
  let callIndex = 0;
  const calls = [];
  class FakeTorControl {
    constructor(options) {
      this.options = options;
    }
    async connect() {}
    async authenticate() {}
    async addOnion(keySpec, portMapping) {
      calls.push({ keySpec, portMapping });
      const index = Math.min(callIndex, responses.length - 1);
      callIndex += 1;
      const { serviceId, privateKey } = responses[index];
      return { ServiceID: serviceId, PrivateKey: privateKey };
    }
    close() {}
  }
  return { TorControlClass: FakeTorControl, calls };
}
