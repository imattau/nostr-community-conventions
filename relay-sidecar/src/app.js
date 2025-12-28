import crypto from 'crypto';
import { scheduleWithJitter, ensureSelfSignedCert } from 'ncc-06-js';
import { buildInventory } from './inventory.js';
import { buildRecords } from './builder.js';
import { publishToRelays } from './publisher.js';
import { setState, addLog } from './db.js';

export async function runPublishCycle(config, state) {
  console.log(`[App] Starting publish cycle for ${config.npub || 'service'}`);

  // 0. Optional: Generate Self-Signed Cert
  if (config.generate_self_signed) {
    try {
      const cert = await ensureSelfSignedCert({
        targetDir: './certs',
        altNames: config.endpoints.map(e => new URL(e.url).hostname).filter(h => h !== 'localhost')
      });
      addLog('info', 'Self-signed certificate ensured', { certPath: cert.certPath });
    } catch (err) {
      addLog('error', `Failed to generate self-signed cert: ${err.message}`);
    }
  }

  // 1. Inventory
  const inventory = await buildInventory(config.endpoints);
  const inventoryHash = crypto.createHash('sha256').update(JSON.stringify(inventory)).digest('hex');

  // 2. Build Records
  const { ncc02Event, ncc05EventTemplate, locatorPayload } = buildRecords(config, inventory);

  // 3. Change Detection
  const now = Date.now();
  const timeSinceLastPublish = now - (state.last_full_publish_timestamp || 0);
  const isIntervalReached = timeSinceLastPublish > config.refreshIntervalMinutes * 60 * 1000;
  const isChanged = inventoryHash !== state.last_endpoints_hash;

  if (!isChanged && !isIntervalReached) {
    console.log(`[App] No changes detected and refresh interval not reached. Skipping publish.`);
    return state;
  }

  console.log(`[App] Publishing records (${isChanged ? 'Change detected' : 'Interval reached'})...`);

  // 4. Publish
  const relays = [...new Set(config.publicationRelays)];
  const publishResults = await publishToRelays(relays, [ncc02Event, ncc05EventTemplate], config.secretKey);

  // 5. Update State
  const newState = {
    ...state,
    last_published_ncc02_id: ncc02Event.id,
    last_endpoints_hash: inventoryHash,
    last_success_per_relay: { ...state.last_success_per_relay, ...publishResults },
    last_full_publish_timestamp: now
  };

  setState('app_state', newState);
  console.log(`[App] Cycle complete. Next refresh in ~${config.refreshIntervalMinutes} minutes.`);
  
  return newState;
}


export function startScheduler(config, state) {
  const loop = async () => {
    try {
      await runPublishCycle(config, state);
    } catch (err) {
      console.error(`[Scheduler] Cycle failed: ${err.message}`);
    }

    const baseMs = config.refreshIntervalMinutes * 60 * 1000;
    const delay = scheduleWithJitter(baseMs, 0.15);
    setTimeout(loop, delay);
  };

  loop();
}
