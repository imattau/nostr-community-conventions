import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { initDb, getConfig, setConfig, isInitialized, addLog, getLogs } from '../src/db.js';

const TEST_DB = './test-sidecar.db';

test('Database Operations', async (t) => {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  initDb(TEST_DB);

  await t.test('initial state is uninitialized', () => {
    assert.strictEqual(isInitialized(), false);
  });

  await t.test('set and get config', () => {
    setConfig('test_key', { foo: 'bar' });
    const val = getConfig('test_key');
    assert.deepStrictEqual(val, { foo: 'bar' });
  });

  await t.test('isInitialized returns true after admin set', () => {
    setConfig('admin_pubkey', 'pubkey');
    assert.strictEqual(isInitialized(), true);
  });

  await t.test('logging operations', () => {
    addLog('info', 'test message', { meta: 'data' });
    const logs = getLogs();
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].level, 'info');
    assert.strictEqual(logs[0].message, 'test message');
  });

  after(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });
});
