import crypto from 'crypto';
import fs from 'fs';
import { scheduleWithJitter, ensureSelfSignedCert, fromNsec, getPublicIPv4, detectGlobalIPv6, computeKFromCertPem } from 'ncc-06-js';
import { getPublicKey } from 'nostr-tools/pure';
import { buildInventory } from './inventory.js';
import { buildRecords } from './builder.js';
import { publishToRelays } from './publisher.js';
import { updateService, addLog } from './db.js';
import { checkTor } from './tor-check.js';
import { provisionOnion } from './onion-service.js';

export async function runPublishCycle(service) {
  const { id, name, service_nsec, service_id, config, state, type } = service;
  const secretKey = fromNsec(service_nsec);
  const publicKey = getPublicKey(secretKey);
  
  console.log(`[App] Starting publish cycle for service: ${name} (${id})`);
  
  // Mark as probing
  updateService(id, { state: { ...state, is_probing: true } });

  // 0. Optional: Generate Self-Signed Cert
  const shouldSelfSign = config.generate_self_signed !== false;
  let expectedKey = config.ncc02ExpectedKey || null;
  if (shouldSelfSign) {
    let certInfo = null;
    try {
      const altNames = config.probe_url ? [new URL(config.probe_url).hostname] : ['localhost'];
      certInfo = await ensureSelfSignedCert({
        targetDir: `./certs/${id}`,
        altNames
      });
    } catch (err) {
      addLog('error', `Cert generation failed for ${name}: ${err.message}`, { serviceId: id });
    }

    if (certInfo?.certPath) {
      try {
        const certPem = await fs.promises.readFile(certInfo.certPath, 'utf8');
        const computedKey = computeKFromCertPem(certPem);
        if (computedKey) {
          expectedKey = computedKey;
        }
      } catch (err) {
        addLog('error', `Failed to compute TLS fingerprint for ${name}: ${err.message}`, { serviceId: id });
      }
    }
  }

  // 1. Tor Provisioning (Stored in DB)
  let torAddress = null;
  if (config.protocols?.tor) {
    try {
      // Migration check: if onion-service.json exists, use it once and delete it
      const migrationFile = `./onion-${service_id}.json`;
      const legacyFile = './onion-service.json';
      let existingKey = config.onion_private_key;

      if (!existingKey) {
        const fileToRead = fs.existsSync(migrationFile) ? migrationFile : (fs.existsSync(legacyFile) ? legacyFile : null);
        if (fileToRead) {
          try {
            const data = JSON.parse(fs.readFileSync(fileToRead, 'utf8'));
            existingKey = data.privateKey;
            console.log(`[App] Migrated onion key for ${name} from ${fileToRead}`);
            fs.unlinkSync(fileToRead); // Clean up
          } catch (e) {}
        }
      }

      const torRes = await provisionOnion({
        serviceId: id,
        torControl: config.tor_control,
        privateKey: existingKey,
        localPort: config.local_port || config.port || 3000
      });

      if (torRes) {
        torAddress = torRes.address;
        // If key changed (or was migrated), persist to DB
        if (torRes.privateKey !== config.onion_private_key) {
          updateService(id, { config: { ...config, onion_private_key: torRes.privateKey } });
        }
      }
    } catch (err) {
      console.warn(`[App] Tor provisioning failed for ${name}: ${err.message}`);
    }
  }

  // 2. Probe & Inventory
  const ipv4 = await getPublicIPv4();
  const ipv6 = detectGlobalIPv6();
  const torStatus = await checkTor();
  
  const inventory = await buildInventory({ ...config, type, torAddress, ncc02ExpectedKey: expectedKey }, { ipv4, ipv6 }, torStatus);
  
  // Stable hashing to prevent redundant updates
  const stableInventory = inventory.map(e => ({ url: e.url, priority: e.priority, family: e.family }));
  const stableProfile = {
    name: config.profile?.name,
    about: config.profile?.about,
    picture: config.profile?.picture
  };
  const locatorHash = crypto.createHash('sha256')
    .update(JSON.stringify(stableInventory))
    .update(JSON.stringify(stableProfile))
    .digest('hex');

  const primaryEndpoint = inventory[0] || null;
  const primarySignature = primaryEndpoint
    ? `${primaryEndpoint.url}|${primaryEndpoint.family || ''}|${primaryEndpoint.protocol || ''}|${primaryEndpoint.k || ''}`
    : 'none';
  const primaryEndpointHash = crypto.createHash('sha256')
    .update(primarySignature)
    .digest('hex');

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

  console.debug(`[App] Service ${name} hash comparison (primary): current=${primaryEndpointHash}, last=${state.last_primary_endpoint_hash}`);
  console.debug(`[App] Service ${name} hash comparison (locator): current=${locatorHash}, last=${state.last_endpoints_hash}`);

  const isFirstRunForService = !state.last_published_ncc02_id;

  const locatorChanged = !state.last_endpoints_hash || locatorHash !== state.last_endpoints_hash;
  const primaryChanged = !state.last_published_ncc02_id || primaryEndpointHash !== (state.last_primary_endpoint_hash || null);
  const shouldPublishNcc05 = locatorChanged || isIntervalReached;

  const isIntervalPublish = isIntervalReached && !locatorChanged;
  const isFirstRun = isFirstRunForService;

  if (!isFirstRun && !primaryChanged && !shouldPublishNcc05) {
    const finalState = { ...state, is_probing: false, last_inventory: inventory };
    updateService(id, { state: finalState });
    return finalState;
  }

  const reasonParts = [];
  if (isFirstRun) reasonParts.push('Initial');
  if (primaryChanged && !isFirstRun) reasonParts.push('Primary endpoint change');
  if (locatorChanged) reasonParts.push('Locator change');
  if (isIntervalPublish) reasonParts.push('Interval');
  const reason = reasonParts.length ? reasonParts.join(' / ') : 'Trigger';

  console.log(`[App] Publishing ${name} due to: ${reason}`);

  // 4. Publish
  let publicationRelays = config.publication_relays || [];
  
  // If Private Mode, do not publish to external relays
  if (config.service_mode === 'private') {
    publicationRelays = [];
    console.log(`[App] Service ${name} is Private. Skipping external publication.`);
  }

  const eventsToPublish = [];
  if (primaryChanged) {
    eventsToPublish.push(ncc02Event);
  }
  if (shouldPublishNcc05) {
    eventsToPublish.push(ncc05EventTemplate);
  }

  // Add Kind 0 (Metadata) if profile exists and we have something to publish
  if (config.profile && eventsToPublish.length > 0) {
    const metadata = {
      name: (config.profile.name || name).toLowerCase().replace(/\s+/g, '_'),
      display_name: config.profile.name || name,
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

  const publishResults = eventsToPublish.length > 0
    ? await publishToRelays(publicationRelays, eventsToPublish, secretKey)
    : {};

  // 5. Update State in DB
  const newState = {
    ...state,
    is_probing: false,
    last_published_ncc02_id: primaryChanged ? ncc02Event.id : state.last_published_ncc02_id,
    last_primary_endpoint_hash: primaryChanged ? primaryEndpointHash : state.last_primary_endpoint_hash,
    last_endpoints_hash: shouldPublishNcc05 ? locatorHash : state.last_endpoints_hash,
    last_inventory: inventory,
    last_success_per_relay: { ...state.last_success_per_relay, ...publishResults },
    last_full_publish_timestamp: now,
    tor_status: torStatus
  };

  updateService(id, { state: newState });
  
  const publishedSummaries = [];
  if (primaryChanged) {
    const summaryId = ncc02Event?.id ? `${ncc02Event.id.slice(0, 8)}...` : 'pending';
    publishedSummaries.push(`NCC-02: ${summaryId}`);
  }
  if (shouldPublishNcc05) {
    const summaryId = ncc05EventTemplate?.id ? `${ncc05EventTemplate.id.slice(0, 8)}...` : 'pending';
    publishedSummaries.push(`NCC-05: ${summaryId}`);
  }
  const eventInfo = publishedSummaries.join(' | ') || 'N/A';

  const logMetadata = {
    serviceId: id,
    reason
  };
  if (primaryChanged && ncc02Event?.id) logMetadata.ncc02 = ncc02Event.id;
  if (shouldPublishNcc05 && ncc05EventTemplate?.id) logMetadata.ncc05 = ncc05EventTemplate.id;
  const kind0Event = eventsToPublish.find(e => e.kind === 0);
  if (kind0Event) logMetadata.kind0 = kind0Event.id;

  addLog('info', `Published updates for ${name} (${reason}) [${eventInfo}]`, logMetadata);
  
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
