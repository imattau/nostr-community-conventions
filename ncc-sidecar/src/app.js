import crypto from 'crypto';
import { scheduleWithJitter, ensureSelfSignedCert, fromNsec, getPublicIPv4, detectGlobalIPv6 } from 'ncc-06-js';
import { getPublicKey } from 'nostr-tools/pure';
import { buildInventory } from './inventory.js';
import { buildRecords } from './builder.js';
import { publishToRelays } from './publisher.js';
import { updateService, addLog } from './db.js';
import { checkTor } from './tor-check.js';

export async function runPublishCycle(service) {
  const { id, name, service_nsec, service_id, config, state } = service;
  const secretKey = fromNsec(service_nsec);
  const publicKey = getPublicKey(secretKey);
  
  console.log(`[App] Starting publish cycle for service: ${name} (${id})`);
  
  // Mark as probing
  updateService(id, { state: { ...state, is_probing: true } });

  // 0. Optional: Generate Self-Signed Cert
  if (config.generate_self_signed) {
    try {
      const altNames = config.probe_url ? [new URL(config.probe_url).hostname] : ['localhost'];
      await ensureSelfSignedCert({
        targetDir: `./certs/${id}`,
        altNames
      });
    } catch (err) {
      addLog('error', `Cert generation failed for ${name}: ${err.message}`, { serviceId: id });
    }
  }

  // 1. Probe & Inventory
  const ipv4 = await getPublicIPv4();
  const ipv6 = detectGlobalIPv6();
  const torStatus = await checkTor();
  
  const inventory = await buildInventory(config, { ipv4, ipv6 }, torStatus);
  const inventoryHash = crypto.createHash('sha256').update(JSON.stringify(inventory)).digest('hex');

  // 2. Build Records
  const { ncc02Event, ncc05EventTemplate, locatorPayload } = buildRecords({
    ...config,
    ncc02ExpiryDays: config.ncc02_expiry_days || 14,
    ncc05TtlHours: config.ncc05_ttl_hours || 1,
    secretKey,
    publicKey,
    serviceId: service_id,
    locatorId: service_id + '-locator'
  }, inventory);

  // Update DB with inventory immediately so UI sees it
  updateService(id, { state: { ...state, last_inventory: inventory } });

  // 3. Change Detection
  const now = Date.now();
  const timeSinceLastPublish = now - (state.last_full_publish_timestamp || 0);
  const isIntervalReached = timeSinceLastPublish > (config.refresh_interval_minutes || 60) * 60 * 1000;
  const isChanged = inventoryHash !== state.last_endpoints_hash;
  const isFirstRunForService = !state.last_published_ncc02_id;

  if (!isFirstRunForService && !isChanged && !isIntervalReached && state.last_published_ncc02_id) {
    const finalState = { ...state, is_probing: false, last_inventory: inventory };
    updateService(id, { state: finalState });
    return finalState;
  }

  // 4. Publish
  let publicationRelays = config.publication_relays || [];
  
  // If Private Mode, do not publish to external relays
  if (config.service_mode === 'private') {
    publicationRelays = [];
    console.log(`[App] Service ${name} is Private. Skipping external publication.`);
  }

  const eventsToPublish = [ncc02Event, ncc05EventTemplate];

  // Add Kind 0 (Metadata) if profile exists
  if (config.profile) {
    const metadata = {
      name: config.profile.name || name,
      about: config.profile.about,
      picture: config.profile.picture,
      nip05: config.profile.nip05
    };
    // Remove undefined keys
    Object.keys(metadata).forEach(k => metadata[k] === undefined && delete metadata[k]);

    const kind0Event = {
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify(metadata)
    };
    eventsToPublish.push(kind0Event);
  }

  const publishResults = await publishToRelays(publicationRelays, eventsToPublish, secretKey);

  // 5. Update State in DB
  const newState = {
    ...state,
    is_probing: false,
    last_published_ncc02_id: ncc02Event.id,
    last_endpoints_hash: inventoryHash,
    last_inventory: inventory,
    last_success_per_relay: { ...state.last_success_per_relay, ...publishResults },
    last_full_publish_timestamp: now,
    tor_status: torStatus
  };

  updateService(id, { state: newState });
  addLog('info', `Published updates for ${name}`, { serviceId: id });
  
  return newState;
}

export function startManager(getServices) {
  const loop = async () => {
    const services = getServices().filter(s => s.status === 'active');
    for (const service of services) {
      try {
        await runPublishCycle(service);
      } catch (err) {
        console.error(`[Manager] Service ${service.name} failed: ${err.message}`);
        addLog('error', `Service cycle failed: ${err.message}`, { serviceId: service.id });
      }
    }
    setTimeout(loop, 60000); // Check every minute
  };
  loop();
}