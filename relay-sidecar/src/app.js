import crypto from 'crypto';
import { scheduleWithJitter, ensureSelfSignedCert, fromNpub, getPublicIPv4, detectGlobalIPv6 } from 'ncc-06-js';
import { NCC05Publisher } from 'ncc-05-js';
import { buildInventory } from './inventory.js';
import { buildRecords } from './builder.js';
import { publishToRelays } from './publisher.js';
import { setState, addLog } from './db.js';
import { checkTor } from './tor-check.js';

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

  // 1. Probe & Inventory
  const ipv4 = await getPublicIPv4();
  const ipv6 = detectGlobalIPv6();
  const torStatus = await checkTor();
  
  const inventory = await buildInventory(config, { ipv4, ipv6 }, torStatus);
  const inventoryHash = crypto.createHash('sha256').update(JSON.stringify(inventory)).digest('hex');

  // 2. Build Records (Base templates)
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

  // 4. Advanced NCC-05 Logic (Privacy)
  const isPrivate = config.service_mode === 'private';
  const recipients = (config.authorized_recipients || [])
    .map(r => {
      try { return r.startsWith('npub1') ? fromNpub(r) : r; }
      catch (e) { return null; }
    })
    .filter(Boolean);

  const publicationRelays = [...new Set(config.publicationRelays)];
  let finalNcc05Event = ncc05EventTemplate;

  if (isPrivate && recipients.length > 0) {
    console.log(`[App] Encrypting locator for ${recipients.length} recipients...`);
    const ncc05Publisher = new NCC05Publisher();
    try {
      // We use the library to build the encrypted/wrapped event but publish via our local publisher
      // to maintain our "local-first" delivery strategy and SQLite logging.
      if (recipients.length === 1) {
        // Targeted NIP-44
        finalNcc05Event = await ncc05Publisher.publish([], config.secretKey, locatorPayload, {
          identifier: config.locatorId,
          recipientPubkey: recipients[0],
          privateLocator: true
        });
      } else {
        // Group Wrapped
        finalNcc05Event = await ncc05Publisher.publishWrapped([], config.secretKey, recipients, locatorPayload, {
          identifier: config.locatorId,
          privateLocator: true
        });
      }
      addLog('info', 'Encrypted NCC-05 locator built', { recipients: recipients.length });
    } catch (err) {
      addLog('error', `Failed to encrypt locator: ${err.message}`);
      // Fallback to the plaintext template (or we could abort)
    }
  }

  // 5. Delivery
  const publishResults = await publishToRelays(publicationRelays, [ncc02Event, finalNcc05Event], config.secretKey);

  // 6. Update State
  const newState = {
    ...state,
    last_published_ncc02_id: ncc02Event.id,
    last_published_ncc05_id: finalNcc05Event.id,
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
