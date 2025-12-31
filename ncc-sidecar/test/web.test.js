import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { initDb } from '../src/db.js';
import { startWebServer } from '../src/web.js';

const TEST_DB = './test-web.db';

test('Web API and Setup Flow', async (t) => {
  let server;
  const localRemote = { remoteAddress: '127.0.0.1' };

  try {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    initDb(TEST_DB);

    // Start server on a high port to avoid conflicts
    server = await startWebServer(4000, undefined, { skipListen: true });

    console.log('WEBTEST: before setup status');
    await t.test('GET /api/setup/status returns uninitialized', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/setup/status',
        ...localRemote
      });
      assert.strictEqual(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), { initialized: false });
    });

    console.log('WEBTEST: before setup init');
    await t.test('POST /api/setup/init initializes the app', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/setup/init',
        payload: {
          adminPubkey: 'admin-pk',
          service: {
            type: 'relay',
            name: 'Test Relay',
            service_id: 'relay',
            service_nsec: 'nsec1...'
          },
          config: { foo: 'bar' }
        },
        ...localRemote
      });
      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.success, true);
      assert.ok(body.sidecar_nsec, 'should return sidecar secret');
      assert.ok(body.sidecar_npub, 'should return sidecar public key');
    });

    console.log('WEBTEST: before setup status after init');
    await t.test('GET /api/setup/status returns initialized now', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/setup/status',
        ...localRemote
      });
      assert.strictEqual(response.statusCode, 200);
      assert.deepStrictEqual(JSON.parse(response.body), { initialized: true });
    });

    console.log('WEBTEST: before status');
    await t.test('GET /api/status returns app state', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/status',
        ...localRemote
      });
      assert.strictEqual(response.statusCode, 200);
      const data = JSON.parse(response.body);
      assert.strictEqual(data.status, 'running');
      assert.strictEqual(data.config.foo, 'bar');
    });

    console.log('WEBTEST: before remote reject');
    await t.test('rejects remote clients when local enforcement is active', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/services',
        remoteAddress: '198.51.100.42'
      });
      assert.strictEqual(response.statusCode, 403);
      assert.deepStrictEqual(JSON.parse(response.body), { error: 'Remote access disabled. Set NCC_SIDECAR_ALLOW_REMOTE=true to override.' });
    });
  } catch (err) {
    console.error('web.test error', err);
    throw err;
  } finally {
    if (server) {
      await server.close();
    }
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  }
});
