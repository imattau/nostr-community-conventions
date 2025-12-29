import crypto from 'crypto';
import fs from 'fs';
import { scheduleWithJitter, ensureSelfSignedCert, fromNsec, fromNpub, getPublicIPv4, detectGlobalIPv6, computeKFromCertPem } from 'ncc-06-js';
import { getPublicKey } from 'nostr-tools/pure';
import { buildInventory } from './inventory.js';
import { buildRecords } from './builder.js';
import { publishToRelays } from './publisher.js';
import { updateService, addLog, getConfig, getServices } from './db.js';
import { checkTor } from './tor-check.js';
import { provisionOnion } from './onion-service.js';
import { NCC05Publisher } from 'ncc-05-js';

const locatorPublisher = new NCC05Publisher({ timeout: 5000 });

function normalizeRecipientPubkeys(values = []) {
  if (!Array.isArray(values)) return [];
  const cleaned = new Set();
  for (const raw of values) {
    if (!raw) continue;
    let candidate = String(raw).trim();
    if (!candidate) continue;
    if (candidate.startsWith('0x')) {
      candidate = candidate.slice(2);
    }
    if (/^[0-9a-f]{64}$/i.test(candidate)) {
      cleaned.add(candidate.toLowerCase());
      continue;
    }
    try {
      const decoded = fromNpub(candidate);
      if (/^[0-9a-f]{64}$/i.test(decoded)) {
        cleaned.add(decoded.toLowerCase());
      }
    } catch (err) {
      // ignore invalid transmissions
    }
  }
  return Array.from(cleaned);
}

async function buildEncryptedLocatorEvent({ publicationRelays, recipients, payload, secretKey, identifier, service }) {
  if (!recipients.length || !publicationRelays.length) return null;
  try {
    if (recipients.length === 1) {
      return await locatorPublisher.publish(publicationRelays, secretKey, payload, {
        identifier,
        recipientPubkey: recipients[0],
        privateLocator: true
      });
    }
    return await locatorPublisher.publishWrapped(publicationRelays, secretKey, recipients, payload, {
      identifier,
      privateLocator: true
    });
  } catch (err) {
    console.warn(`[App] Failed to encrypt NCC-05 locator for ${service.name}: ${err.message}`);
    addLog('error', `Encrypted NCC-05 publish failed for ${service.name}: ${err.message}`, {
      serviceId: service.id,
      error: err.message
    });
    return null;
  }
}

export async function runPublishCycle(service, options = {}) {
  const { forcePublish = false } = options;
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
  const normalizedRecipients = normalizeRecipientPubkeys(config.ncc05_recipients);
  const configuredAppConfig = getConfig('app_config') || {};
  const appPublicationRelays = Array.isArray(configuredAppConfig.publication_relays) ? configuredAppConfig.publication_relays : [];
  let fallbackPublicationRelays = appPublicationRelays;
  if (!fallbackPublicationRelays.length) {
    const allServices = getServices();
    const sidecarService = allServices.find(s => s.type === 'sidecar');
    if (sidecarService && Array.isArray(sidecarService.config?.publication_relays) && sidecarService.config.publication_relays.length) {
      fallbackPublicationRelays = sidecarService.config.publication_relays;
    }
  }
  const configuredPublicationRelays = Array.isArray(config.publication_relays) && config.publication_relays.length
    ? config.publication_relays
    : fallbackPublicationRelays;
  let publicationRelays = configuredPublicationRelays;
  if (config.service_mode === 'private' && normalizedRecipients.length === 0) {
    publicationRelays = [];
    console.log(`[App] Service ${name} is Private but has no NCC-05 recipients configured. Skipping locator publication.`);
  }
  
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

  const profileSnapshot = config.profile ? {
    name: config.profile.name || '',
    about: config.profile.about || '',
    picture: config.profile.picture || '',
    nip05: config.profile.nip05 || ''
  } : null;
  const profileHash = profileSnapshot ? crypto.createHash('sha256').update(JSON.stringify(profileSnapshot)).digest('hex') : null;
  const profileChanged = profileHash && profileHash !== state.last_profile_hash;

  const primaryEndpoint = inventory[0] || null;
  const primarySignature = primaryEndpoint
    ? `${primaryEndpoint.url}|${primaryEndpoint.family || ''}|${primaryEndpoint.protocol || ''}|${primaryEndpoint.k || ''}`
    : 'none';
  const primaryEndpointHash = crypto.createHash('sha256')
    .update(primarySignature)
    .digest('hex');

  // 2. Build Records
  const { ncc02Event, ncc05EventTemplate: baselineNcc05Event, locatorPayload } = buildRecords({
    ...config,
    ncc02ExpiryDays: config.ncc02_expiry_days || 14,
    ncc05TtlHours: config.ncc05_ttl_hours || 1,
    secretKey,
    publicKey,
    serviceId: service_id,
    locatorId: service_id + '-locator'
  }, inventory);

  let ncc05EventTemplate = baselineNcc05Event;
  if (config.service_mode === 'private') {
    if (normalizedRecipients.length && publicationRelays.length) {
      const encryptedEvent = await buildEncryptedLocatorEvent({
        publicationRelays,
        recipients: normalizedRecipients,
        payload: locatorPayload,
        secretKey,
        identifier: config.locatorId || `${service_id}-locator`,
        service
      });
      ncc05EventTemplate = encryptedEvent || null;
    } else {
      ncc05EventTemplate = null;
      if (!normalizedRecipients.length) {
        console.log(`[App] Private service ${name} has no recipient NPUBs configured; NCC-05 locator publication disabled.`);
      }
      if (!publicationRelays.length) {
        console.log(`[App] Private service ${name} has no publication relays available; NCC-05 locator publication disabled.`);
      }
    }
  }

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
  const actualPrimaryChanged = !state.last_published_ncc02_id || primaryEndpointHash !== (state.last_primary_endpoint_hash || null);
  const primaryChanged = forcePublish || actualPrimaryChanged;
  const shouldPublishNcc05Raw = forcePublish || locatorChanged || isIntervalReached;
  const shouldPublishNcc05 = shouldPublishNcc05Raw && !!ncc05EventTemplate;

  const isIntervalPublish = isIntervalReached && !locatorChanged;
  const isFirstRun = isFirstRunForService;

  if (!isFirstRun && !primaryChanged && !shouldPublishNcc05 && !profileChanged) {
    const finalState = { ...state, is_probing: false, last_inventory: inventory };
    updateService(id, { state: finalState });
    return finalState;
  }

  const reasonParts = [];
  if (isFirstRun) reasonParts.push('Initial');
  if (actualPrimaryChanged && !isFirstRun) reasonParts.push('Primary endpoint change');
  if (locatorChanged) reasonParts.push('Locator change');
  if (isIntervalPublish) reasonParts.push('Interval');
  if (forcePublish) reasonParts.push('Manual republish');
  if (profileChanged) reasonParts.push('Profile update');
  const reason = reasonParts.length ? reasonParts.join(' / ') : 'Trigger';

  console.log(`[App] Publishing ${name} due to: ${reason}`);

  // 4. Publish
  const eventsToPublish = [];
  if (primaryChanged) {
    eventsToPublish.push(ncc02Event);
  }
  if (shouldPublishNcc05) {
    eventsToPublish.push(ncc05EventTemplate);
  }

  // Add Kind 0 (Metadata) if profile exists and we've either got other events or the profile changed
  if (config.profile) {
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
    if (eventsToPublish.length > 0 || profileChanged) {
      eventsToPublish.push(kind0Event);
    }
  }

  const publishResults = eventsToPublish.length > 0
    ? await publishToRelays(publicationRelays, eventsToPublish, secretKey)
    : {};

  const kind0Event = eventsToPublish.find(e => e.kind === 0);

  // 5. Update State in DB
  const newState = {
    ...state,
    is_probing: false,
    last_published_ncc02_id: primaryChanged ? ncc02Event.id : state.last_published_ncc02_id,
    last_primary_endpoint_hash: primaryChanged ? primaryEndpointHash : state.last_primary_endpoint_hash,
    last_endpoints_hash: shouldPublishNcc05 ? locatorHash : state.last_endpoints_hash,
    last_published_ncc05_id: shouldPublishNcc05 ? ncc05EventTemplate?.id : state.last_published_ncc05_id,
    last_published_kind0_id: kind0Event ? kind0Event.id : state.last_published_kind0_id,
    last_profile_hash: profileHash || state.last_profile_hash,
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

  const primarySummary = primaryEndpoint ? {
    url: primaryEndpoint.url,
    family: primaryEndpoint.family,
    protocol: primaryEndpoint.protocol,
    tlsFingerprint: primaryEndpoint.tlsFingerprint || primaryEndpoint.k || expectedKey || null
  } : null;

  const logMetadata = {
    serviceId: id,
    reason,
    publishResults
  };
  if (primaryChanged && ncc02Event?.id) logMetadata.ncc02 = ncc02Event.id;
  if (shouldPublishNcc05 && ncc05EventTemplate?.id) logMetadata.ncc05 = ncc05EventTemplate.id;
  if (kind0Event) logMetadata.kind0 = kind0Event.id;
  if (normalizedRecipients.length) {
    logMetadata.privateRecipients = normalizedRecipients;
  }
  if (primarySummary) {
    logMetadata.primaryEndpoint = primarySummary;
  }
  if (ncc02Event) {
    logMetadata.ncc02Content = ncc02Event.content;
    logMetadata.ncc02Tags = ncc02Event.tags;
  }
  if (shouldPublishNcc05 && locatorPayload) {
    logMetadata.ncc05Content = ncc05EventTemplate?.content;
    logMetadata.ncc05Tags = ncc05EventTemplate?.tags;
    logMetadata.locatorPayload = locatorPayload;
  }

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
