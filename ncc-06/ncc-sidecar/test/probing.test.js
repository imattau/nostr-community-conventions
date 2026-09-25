import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { runPublishCycle } from '../src/app.js';
import { initDb, addService, getServices } from '../src/db.js';
import { generateKeypair } from 'ncc-06-js';

test('Probing state transitions', async () => {
  const dbPath = path.resolve(process.cwd(), './test-probing.db');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  initDb(dbPath);

  const { nsec } = generateKeypair();
  const service = {
    id: 1,
    name: 'Test Probing',
    service_id: 'test',
    service_nsec: nsec,
    config: {
      protocols: { ipv4: true, ipv6: false, tor: false },
      refresh_interval_minutes: 60
    },
    state: {}
  };

  addService(service);

  // 1. First run should clear probing flag
  console.log('[Test] Running first cycle...');
  const state1 = await runPublishCycle(getServices()[0]);
  assert.strictEqual(state1.is_probing, false, 'Probing flag should be false after first run');
  assert.ok(state1.last_inventory, 'Inventory should be populated');

  // 2. Second run (no change) should also clear probing flag
  console.log('[Test] Running second cycle (no change)...');
  await runPublishCycle(getServices()[0]);
  const finalState = getServices()[0].state;
  assert.strictEqual(finalState.is_probing, false, 'Probing flag in DB should be false after skip-publish run');

  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
});
