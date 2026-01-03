import fs from 'fs';
import { 
  ensureSelfSignedCert, fromNsec, fromNpub, 
  getPublicIPv4, detectGlobalIPv6, computeKFromCertPem 
} from 'ncc-06-js';
import { getPublicKey } from 'nostr-tools/pure';
import { buildInventory } from './inventory.js';
import { publishToRelays } from './publisher.js';
import { updateService, addLog, getConfig, getServices } from './db.js';
import { checkTor } from './tor-check.js';
import { provisionOnion } from './onion-service.js';
import { maybePublishListBackup } from './list-sync.js';

// Services
import { notifyAdminsOnionUpdate } from './services/notification.js';
import { 
  buildEncryptedLocatorEvent, computeInventoryHash, 
  computePrimaryHash, prepareServiceRecords 
} from './services/registry.js';

function normalizeRecipientPubkeys(values = []) {
  const cleaned = new Set();
  for (const raw of values) {
    if (!raw) continue;
    let candidate = String(raw).trim();
    if (!candidate) continue;
    if (candidate.startsWith('0x')) candidate = candidate.slice(2);
    if (/^[0-9a-f]{64}$/i.test(candidate)) {
      cleaned.add(candidate.toLowerCase());
      continue;
    }
    try {
      const decoded = fromNpub(candidate);
      if (/^[0-9a-f]{64}$/i.test(decoded)) cleaned.add(decoded.toLowerCase());
    } catch (_err) {
      console.warn(`[App] Invalid recipient in config for ${candidate}:`, _err?.message || _err);
    }
  }
  return Array.from(cleaned);
}

function resolvePublicationContext(config, normalizedRecipients) {
  const configuredAppConfig = getConfig('app_config') || {};
  const appRelays = Array.isArray(configuredAppConfig.publication_relays) ? configuredAppConfig.publication_relays : [];
  let fallbackRelays = appRelays;
  if (!fallbackRelays.length) {
    const sidecarService = getServices().find(s => s.type === 'sidecar');
    if (sidecarService?.config?.publication_relays?.length) {
      fallbackRelays = sidecarService.config.publication_relays;
    }
  }

  const configuredRelays = Array.isArray(config.publication_relays) && config.publication_relays.length
    ? config.publication_relays
    : fallbackRelays;

  const publicationRelays = (Array.isArray(configuredRelays) ? configuredRelays : []).filter(Boolean);
  const canPublish = publicationRelays.length > 0 && !(config.service_mode === 'private' && normalizedRecipients.length === 0);

  return { publicationRelays, canPublish };
}

function describePublishState({ state, config, forcePublish, primaryEndpointHash, locatorHash, profileHash, ncc05EventTemplate, now = Date.now() }) {
  const timeSinceLastPublish = now - (state.last_full_publish_timestamp || 0);
  const refreshInterval = (config.refresh_interval_minutes || 60) * 60 * 1000;
  const isIntervalReached = timeSinceLastPublish > refreshInterval;

  const isFirstRun = !state.last_published_ncc02_id;
  const primaryChanged = forcePublish || !state.last_published_ncc02_id || primaryEndpointHash !== (state.last_primary_endpoint_hash || null);
  const locatorChanged = !state.last_endpoints_hash || locatorHash !== state.last_endpoints_hash;
  const shouldAttemptNcc05 = (forcePublish || locatorChanged || isIntervalReached) && !!ncc05EventTemplate;
  const profileChanged = Boolean(profileHash && profileHash !== state.last_profile_hash);

  const reasonParts = [];
  if (isFirstRun) reasonParts.push('Initial');
  if (primaryChanged && !isFirstRun) reasonParts.push('Endpoint change');
  if (locatorChanged) reasonParts.push('Locator change');
  if (isIntervalReached && !locatorChanged) reasonParts.push('Interval');
  if (forcePublish) reasonParts.push('Manual');
  if (profileChanged) reasonParts.push('Profile update');
  const reason = reasonParts.length ? reasonParts.join(' / ') : 'Trigger';

  return {
    primaryChanged, locatorChanged, shouldAttemptNcc05, profileChanged,
    reason, needsPublish: primaryChanged || shouldAttemptNcc05 || profileChanged, isFirstRun
  };
}

export async function runPublishCycle(service, options = {}) {
  const { forcePublish = false } = options;
  const { id, name, service_nsec, service_id, config, state, type } = service;
  const secretKey = fromNsec(service_nsec);
  const publicKey = getPublicKey(secretKey);

  if (type === 'sidecar') {
    try { await maybePublishListBackup({ service, secretKey }); } 
    catch (err) { console.warn(`[App] List backup publish failed: ${err.message}`); }
  }
  
  updateService(id, { state: { ...state, is_probing: true } });

  // 0. Optional: TLS
  let expectedKey = config.ncc02ExpectedKey || null;
  if (config.generate_self_signed !== false) {
    try {
      const altNames = config.probe_url ? [new URL(config.probe_url).hostname] : ['localhost'];
      const certInfo = await ensureSelfSignedCert({ targetDir: `./certs/${id}`, altNames });
      if (certInfo?.certPath) {
        const certPem = await fs.promises.readFile(certInfo.certPath, 'utf8');
        expectedKey = computeKFromCertPem(certPem) || expectedKey;
      }
    } catch (err) { addLog('error', `Cert failed for ${name}: ${err.message}`, { serviceId: id }); }
  }

  // 1. Tor
  let torAddress = null;
  let torResponse = null;
  if (config.protocols?.tor) {
    try {
      torResponse = await provisionOnion({
        serviceId: id, torControl: config.tor_control,
        privateKey: config.onion_private_key,
        localPort: config.local_port || config.port || 3000
      });
      if (torResponse) {
        torAddress = torResponse.address;
        if (torResponse.privateKey !== config.onion_private_key) {
          updateService(id, { config: { ...config, onion_private_key: torResponse.privateKey } });
        }
      }
    } catch (err) { console.warn(`[App] Tor failed for ${name}: ${err.message}`); }
  }

  // 2. Probe
  const [ipv4, ipv6, torStatus] = await Promise.all([getPublicIPv4(), detectGlobalIPv6(), checkTor()]);
  const inventory = await buildInventory({ ...config, type, torAddress, ncc02ExpectedKey: expectedKey }, { ipv4, ipv6 }, torStatus);
  const normalizedRecipients = normalizeRecipientPubkeys(config.ncc05_recipients);
  const { publicationRelays, canPublish } = resolvePublicationContext(config, normalizedRecipients);

  const enabledProtocols = config.protocols || {};
  const filteredInventory = inventory.filter(ep => {
    const key = ep.family === 'onion' ? 'tor' : ep.family;
    return enabledProtocols[key] !== false;
  });

  const locatorHash = computeInventoryHash(filteredInventory, config.profile);
  const profileHash = config.profile ? computeInventoryHash([], config.profile) : null;
  const primaryEndpointHash = computePrimaryHash(filteredInventory[0]);

  // 3. Prepare Records
  const { ncc02Event, baselineNcc05Event, locatorPayload } = await prepareServiceRecords({
    service, filteredInventory, normalizedRecipients, secretKey, publicKey
  });

  let ncc05EventTemplate = baselineNcc05Event;
  if (config.service_mode === 'private') {
    ncc05EventTemplate = await buildEncryptedLocatorEvent({
      publicationRelays, recipients: normalizedRecipients, payload: locatorPayload,
      secretKey, identifier: config.locatorId || `${service_id}-locator`, service
    });
  }

  updateService(id, { state: { ...state, last_inventory: filteredInventory } });

  // 4. Change Detection
  const changeState = describePublishState({
    state, config, forcePublish, primaryEndpointHash, locatorHash, profileHash, ncc05EventTemplate
  });
  
  if (!changeState.needsPublish && !changeState.isFirstRun) {
    const finalState = { ...state, is_probing: false, last_inventory: filteredInventory };
    updateService(id, { state: finalState });
    return finalState;
  }

  const willPublishNcc02 = changeState.primaryChanged && canPublish;
  const willPublishNcc05 = changeState.shouldAttemptNcc05 && canPublish;
  const eventsToPublish = [];
  if (willPublishNcc02) eventsToPublish.push(ncc02Event);
  if (willPublishNcc05) eventsToPublish.push(ncc05EventTemplate);

  let kind0Event = null;
  if (config.profile && canPublish && (willPublishNcc02 || willPublishNcc05 || changeState.profileChanged)) {
    kind0Event = {
      kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [],
      content: JSON.stringify({
        name: (config.profile.name || name).toLowerCase().replace(/\s+/g, '_'),
        display_name: config.profile.display_name || config.profile.name || name,
        about: config.profile.about, picture: config.profile.picture, nip05: config.profile.nip05
      })
    };
    eventsToPublish.push(kind0Event);
  }

  if (!eventsToPublish.length) {
    updateService(id, { state: { ...state, is_probing: false } });
    return state;
  }

  const publishResults = await publishToRelays(publicationRelays, eventsToPublish, secretKey);
  
  // Notification
  const onionChanged = torAddress && torAddress !== (state.last_onion_address || null);
  let notificationSent = false;
  if (onionChanged && torResponse && willPublishNcc05 && torAddress !== state.last_onion_notified) {
    await notifyAdminsOnionUpdate({
      service, torResponse, previousAddress: state.last_onion_address,
      secretKey, relays: publicationRelays,
      eventIds: { ncc02: ncc02Event?.id, ncc05: ncc05EventTemplate?.id }
    });
    notificationSent = true;
  }

  const newState = {
    ...state,
    is_probing: false,
    last_published_ncc02_id: willPublishNcc02 ? ncc02Event.id : state.last_published_ncc02_id,
    last_primary_endpoint_hash: willPublishNcc02 ? primaryEndpointHash : state.last_primary_endpoint_hash,
    last_endpoints_hash: willPublishNcc05 ? locatorHash : state.last_endpoints_hash,
    last_published_ncc05_id: willPublishNcc05 ? ncc05EventTemplate?.id : state.last_published_ncc05_id,
    last_profile_hash: profileHash || state.last_profile_hash,
    last_published_kind0_id: kind0Event?.id || state.last_published_kind0_id, // Store kind0 ID
    last_inventory: filteredInventory,
    last_success_per_relay: { ...state.last_success_per_relay, ...publishResults },
    last_full_publish_timestamp: Date.now(),
    tor_status: torStatus,
    last_onion_address: torAddress || state.last_onion_address,
    last_onion_notified: notificationSent ? torAddress : state.last_onion_notified
  };

  updateService(id, { state: newState });

  const logMetadata = { serviceId: id, results: publishResults };
  const publishedTypes = [];
  if (willPublishNcc02 && ncc02Event?.id) {
    logMetadata.ncc02 = ncc02Event.id;
    publishedTypes.push('NCC-02');
  }
  if (willPublishNcc05 && ncc05EventTemplate?.id) {
    logMetadata.ncc05 = ncc05EventTemplate.id;
    publishedTypes.push('NCC-05');
  }
  if (kind0Event?.id) {
    logMetadata.kind0 = kind0Event.id;
    publishedTypes.push('Kind 0');
  }

  const typeSummary = publishedTypes.length ? ` [${publishedTypes.join(' | ')}]` : '';
  addLog('info', `Published updates for ${name} (${changeState.reason})${typeSummary}`, logMetadata);
  
  return newState;
}

export function startManager(getServices) {
  const loop = async () => {
    const activeServices = getServices().filter(s => s.status === 'active');
    for (const service of activeServices) {
      try { await runPublishCycle(service); } 
      catch (err) { addLog('error', `Cycle failed for ${service.name}: ${err.message}`, { serviceId: service.id }); }
    }
    setTimeout(loop, 60000);
  };
  loop();
}