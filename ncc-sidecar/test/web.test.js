import { test, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { initDb } from '../src/db.js';
import { startWebServer } from '../src/web.js';

const TEST_DB = './test-web.db';

test('Web API and Setup Flow', async (t) => {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  initDb(TEST_DB);
  
  // Start server on a high port to avoid conflicts
  const server = await startWebServer(4000);

  await t.test('GET /api/setup/status returns uninitialized', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/setup/status'
    });
    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(response.body), { initialized: false });
  });

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
      }
    });
    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(response.body), { success: true });
  });

  await t.test('GET /api/setup/status returns initialized now', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/setup/status'
    });
    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(JSON.parse(response.body), { initialized: true });
  });

  await t.test('GET /api/status returns app state', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/status'
    });
    assert.strictEqual(response.statusCode, 200);
    const data = JSON.parse(response.body);
    assert.strictEqual(data.status, 'running');
    assert.deepStrictEqual(data.config, { foo: 'bar' });
  });

  after(async () => {
    await server.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });
});
