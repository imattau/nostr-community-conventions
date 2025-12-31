import crypto from 'crypto';
import fs from 'fs';
import { ensureSelfSignedCert, fromNsec, fromNpub, getPublicIPv4, detectGlobalIPv6, computeKFromCertPem } from 'ncc-06-js';
import { getPublicKey } from 'nostr-tools/pure';
import { buildInventory } from './inventory.js';
import { buildRecords } from './builder.js';
import { publishToRelays } from './publisher.js';
import { updateService, addLog, getConfig, getServices, getAdmins } from './db.js';
import { checkTor } from './tor-check.js';
import { provisionOnion } from './onion-service.js';
import { NCC05Publisher } from 'ncc-05-js';
import { sendInviteDM } from './dm.js';

const locatorPublisher = new NCC05Publisher({ timeout: 5000 });
const onionNotificationCache = new Map();

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
    } catch (_err) {
      console.warn(`[App] Invalid recipient in config for ${candidate}:`, _err?.message || _err);
    }
  }
  return Array.from(cleaned);
}

function formatEventLink(relayUrl, eventId) {
  if (!relayUrl || !eventId) return null;
  try {
    const parsed = new URL(relayUrl);
    parsed.pathname = eventId;
    parsed.search = '';
    return parsed.toString();
  } catch (_err) {
    return `${relayUrl.replace(/\/+$/, '')}/${eventId}`;
  }
}

async function notifyAdminsOnionUpdate({
  service,
  torResponse,
  previousAddress,
  secretKey,
  relays,
  eventIds
}) {
  if (!torResponse?.address) return;
  const admins = getAdmins().filter(admin => admin.pubkey).map(admin => admin.pubkey);
  if (!admins.length) return;

  const appConfig = getConfig('app_config') || {};
  const fallbackRelays = Array.isArray(appConfig.publication_relays) ? appConfig.publication_relays : [];
  const relayTargets = Array.isArray(relays) && relays.length ? relays : fallbackRelays;
  if (!relayTargets.length) {
    addLog('warn', `Onion update for ${service.name} detected but no relays configured for DM delivery`, {
      serviceId: service.id,
      torAddress: torResponse.address
    });
    return;
  }

  const uniqueLinks = new Set();
  uniqueLinks.add(torResponse.address);
  if (torResponse.servicePort) {
    uniqueLinks.add(`http://${torResponse.address}:${torResponse.servicePort}`);
    uniqueLinks.add(`ws://${torResponse.address}:${torResponse.servicePort}`);
  }

  const linkLines = Array.from(uniqueLinks)
    .map(link => `• ${link}`)
    .join('\n');

  const primaryRelay = relayTargets[0] || null;
  const eventLines = [];
  if (eventIds?.ncc02) {
    const link = formatEventLink(primaryRelay, eventIds.ncc02);
    eventLines.push(`• NCC-02 event: ${eventIds.ncc02}${link ? ` (${link})` : ''}`);
  }
  if (eventIds?.ncc05) {
    const link = formatEventLink(primaryRelay, eventIds.ncc05);
    eventLines.push(`• NCC-05 event: ${eventIds.ncc05}${link ? ` (${link})` : ''}`);
  }

  const message = `NCC-06 service "${service.name}" (${service.service_id}) refreshed its Tor endpoint.

New onion address:
${linkLines}

${eventLines.length ? `Published events:\n${eventLines.join('\n')}\n\n` : ''}
The updated endpoint is visible in the admin dashboard after the next publish cycle.`;

  const sendResults = await Promise.all(admins.map(async (pubkey) => {
    try {
      const success = await sendInviteDM({
        secretKey,
        recipientPubkey: pubkey,
        message,
        relays: Array.from(new Set(relayTargets))
      });
      return { pubkey, success };
    } catch (err) {
      return { pubkey, success: false, error: err?.message || 'unknown' };
    }
  }));

  const successCount = sendResults.filter(r => r.success).length;
  const failed = sendResults.filter(r => !r.success);
  addLog('info', `Notified admins about onion update for ${service.name}`, {
    serviceId: service.id,
    previousAddress,
    newAddress: torResponse.address,
    relays: relayTargets,
    recipients: admins,
    notified: successCount,
    failures: failed.length
  });
  if (failed.length) {
    addLog('warn', `Failed to deliver some onion update DMs for ${service.name}`, {
      serviceId: service.id,
      failures: failed.map(f => ({ pubkey: f.pubkey, error: f.error }))
    });
  }
  onionNotificationCache.set(service.id, torResponse.address);
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

function resolvePublicationContext(config, normalizedRecipients) {
  const configuredAppConfig = getConfig('app_config') || {};
  const appRelays = Array.isArray(configuredAppConfig.publication_relays) ? configuredAppConfig.publication_relays : [];
  let fallbackRelays = appRelays;
  if (!fallbackRelays.length) {
    const allServices = getServices();
    const sidecarService = allServices.find(s => s.type === 'sidecar');
    if (sidecarService && Array.isArray(sidecarService.config?.publication_relays) && sidecarService.config.publication_relays.length) {
      fallbackRelays = sidecarService.config.publication_relays;
    }
  }

  const configuredPublicationRelays = Array.isArray(config.publication_relays) && config.publication_relays.length
    ? config.publication_relays
    : fallbackRelays;

  let publicationRelays = Array.isArray(configuredPublicationRelays) ? configuredPublicationRelays.slice() : [];
  if (config.service_mode === 'private' && normalizedRecipients.length === 0) {
    publicationRelays = [];
  }

  publicationRelays = publicationRelays.filter(Boolean);
  return {
    publicationRelays,
    canPublish: publicationRelays.length > 0
  };
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
  if (primaryChanged && !isFirstRun) reasonParts.push('Primary endpoint change');
  if (locatorChanged) reasonParts.push('Locator change');
  if (isIntervalReached && !locatorChanged) reasonParts.push('Interval');
  if (forcePublish) reasonParts.push('Manual republish');
  if (profileChanged) reasonParts.push('Profile update');
  const reason = reasonParts.length ? reasonParts.join(' / ') : 'Trigger';

  return {
    primaryChanged,
    locatorChanged,
    shouldAttemptNcc05,
    profileChanged,
    reason,
    needsPublish: primaryChanged || shouldAttemptNcc05 || profileChanged,
    isFirstRun
  };
}

export async function runPublishCycle(service, options = {}) {
  const { forcePublish = false } = options;
  const { id, name, service_nsec, service_id, config, state, type } = service;
  const cachedNotified = onionNotificationCache.get(id) || null;
  const storedNotified = state.last_onion_notified || null;
  if (storedNotified && storedNotified !== cachedNotified) {
    onionNotificationCache.set(id, storedNotified);
  }
  const lastNotified = storedNotified || cachedNotified || null;
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
  let torResponse = null;
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
          } catch (_err) {
            console.warn(`[App] Failed to parse migrated onion key for ${name}:`, _err);
          }
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
        torResponse = torRes;
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
  const { publicationRelays, canPublish } = resolvePublicationContext(config, normalizedRecipients);
  const onionChanged = torAddress && torAddress !== (state.last_onion_address || null);
  if (config.service_mode === 'private' && normalizedRecipients.length === 0) {
    console.log(`[App] Service ${name} is Private but has no NCC-05 recipients configured; NCC-05 locator publication disabled.`);
  }
  const effectivePublicationRelays = publicationRelays;
  const enabledProtocols = config.protocols || {};
  const familyMap = {
    ipv4: 'ipv4',
    ipv6: 'ipv6',
    onion: 'tor'
  };
  const filteredInventory = inventory.filter(ep => {
    const protocolKey = familyMap[ep.family] || ep.family;
    return enabledProtocols[protocolKey] !== false;
  });
  if (filteredInventory.length !== inventory.length) {
    console.debug(`[App] Service ${name} dropped ${inventory.length - filteredInventory.length} disabled endpoint(s) before publishing.`);
  }
  
  // Stable hashing to prevent redundant updates
  const stableInventory = filteredInventory.map(e => ({ url: e.url, priority: e.priority, family: e.family }));
  const stableProfile = {
    name: config.profile?.name,
    about: config.profile?.about,
    picture: config.profile?.picture
  };
  const locatorHash = crypto.createHash('sha256')
    .update(JSON.stringify(stableInventory))
    .update(JSON.stringify(stableProfile))
    .digest('hex');

  // Keep a deterministic fingerprint of the currently configured profile so we can fire
  // a publish cycle whenever the admin edits the displayed metadata even if endpoints unchanged.
  const profileSnapshot = config.profile ? {
    name: config.profile.name || '',
    display_name: config.profile.display_name || '',
    about: config.profile.about || '',
    picture: config.profile.picture || '',
    nip05: config.profile.nip05 || ''
  } : null;
  const profileHash = profileSnapshot ? crypto.createHash('sha256').update(JSON.stringify(profileSnapshot)).digest('hex') : null;

  const primaryEndpoint = filteredInventory[0] || null;
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
  }, filteredInventory);

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
  updateService(id, { state: { ...state, last_inventory: filteredInventory } });

  // 3. Change Detection
  const now = Date.now();
  console.debug(`[App] Service ${name} hash comparison (primary): current=${primaryEndpointHash}, last=${state.last_primary_endpoint_hash}`);
  console.debug(`[App] Service ${name} hash comparison (locator): current=${locatorHash}, last=${state.last_endpoints_hash}`);

  const changeState = describePublishState({
    state,
    config,
    forcePublish,
    primaryEndpointHash,
    locatorHash,
    profileHash,
    ncc05EventTemplate,
    now
  });
  const { primaryChanged, shouldAttemptNcc05, profileChanged, reason, needsPublish, isFirstRun } = changeState;

  if (!isFirstRun && !primaryChanged && !shouldAttemptNcc05 && !profileChanged) {
    const finalState = { ...state, is_probing: false, last_inventory: filteredInventory };
    updateService(id, { state: finalState });
    return finalState;
  }
  console.log(`[App] Publishing ${name} due to: ${reason}`);

  const willPublishNcc02 = primaryChanged && canPublish;
  const willPublishNcc05 = shouldAttemptNcc05 && canPublish;
  const shouldPublishKind0 = canPublish && (willPublishNcc02 || willPublishNcc05 || profileChanged);

  const eventsToPublish = [];
  if (willPublishNcc02) {
    eventsToPublish.push(ncc02Event);
  }
  if (willPublishNcc05) {
    eventsToPublish.push(ncc05EventTemplate);
  }

  let kind0Event = null;
  if (config.profile) {
    const metadata = {
      name: (config.profile.name || name).toLowerCase().replace(/\s+/g, '_'),
      display_name: config.profile.display_name || config.profile.name || name,
      about: config.profile.about,
      picture: config.profile.picture,
      nip05: config.profile.nip05
    };
    // Remove undefined keys
    Object.keys(metadata).forEach(k => metadata[k] === undefined && delete metadata[k]);

    kind0Event = {
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify(metadata)
    };
    if (shouldPublishKind0) {
      eventsToPublish.push(kind0Event);
    }
  }

  if (!eventsToPublish.length) {
    const finalState = { ...state, is_probing: false, last_inventory: filteredInventory };
    if (!canPublish && needsPublish) {
      if (state.last_publication_warning_reason !== reason) {
        addLog('warn', `Skipped publish for ${name}: ${reason} (no publication relays available)`, {
          serviceId: id,
          reason,
          publicationRelays: effectivePublicationRelays,
          privateRecipients: normalizedRecipients
        });
      }
      finalState.last_publication_warning_reason = reason;
    } else {
      finalState.last_publication_warning_reason = null;
    }
    updateService(id, { state: finalState });
    return finalState;
  }

  const publishResults = await publishToRelays(effectivePublicationRelays, eventsToPublish, secretKey);
  const shouldNotifyAdmins = onionChanged && torResponse && willPublishNcc05 && torAddress !== lastNotified;
  let notificationSent = false;
  if (shouldNotifyAdmins) {
    await notifyAdminsOnionUpdate({
      service,
      torResponse,
      previousAddress: state.last_onion_address || null,
      secretKey,
      relays: effectivePublicationRelays,
      eventIds: {
        ncc02: ncc02Event?.id,
        ncc05: ncc05EventTemplate?.id
      }
    });
    notificationSent = true;
  }


  // 5. Update State in DB
  const newState = {
    ...state,
    is_probing: false,
    last_published_ncc02_id: willPublishNcc02 ? ncc02Event.id : state.last_published_ncc02_id,
    last_primary_endpoint_hash: willPublishNcc02 ? primaryEndpointHash : state.last_primary_endpoint_hash,
    last_endpoints_hash: willPublishNcc05 ? locatorHash : state.last_endpoints_hash,
    last_published_ncc05_id: willPublishNcc05 ? ncc05EventTemplate?.id : state.last_published_ncc05_id,
    last_published_kind0_id: kind0Event && shouldPublishKind0 ? kind0Event.id : state.last_published_kind0_id,
    last_profile_hash: profileHash || state.last_profile_hash,
    last_inventory: filteredInventory,
    last_success_per_relay: { ...state.last_success_per_relay, ...publishResults },
    last_full_publish_timestamp: now,
    tor_status: torStatus,
    last_onion_address: torAddress || state.last_onion_address,
    last_onion_notified: notificationSent ? torAddress : state.last_onion_notified,
    last_publication_warning_reason: null
  };

  updateService(id, { state: newState });
  
  const publishedSummaries = [];
  if (willPublishNcc02) {
    const summaryId = ncc02Event?.id ? `${ncc02Event.id.slice(0, 8)}...` : 'pending';
    publishedSummaries.push(`NCC-02: ${summaryId}`);
  }
  if (willPublishNcc05) {
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

  // Record as much context as possible for UI/admin troubleshooting (event IDs, locator payload, TLS fingerprint, recipients, etc.).
  const logMetadata = {
    serviceId: id,
    reason,
    publishResults,
    publicationRelays: effectivePublicationRelays
  };
  if (willPublishNcc02 && ncc02Event?.id) logMetadata.ncc02 = ncc02Event.id;
  if (willPublishNcc05 && ncc05EventTemplate?.id) logMetadata.ncc05 = ncc05EventTemplate.id;
  if (kind0Event) logMetadata.kind0 = kind0Event.id;
  if (normalizedRecipients.length) {
    logMetadata.privateRecipients = normalizedRecipients;
  }
  if (primarySummary) {
    logMetadata.primaryEndpoint = primarySummary;
  }
  if (willPublishNcc02 && ncc02Event) {
    logMetadata.ncc02Content = ncc02Event.content;
    logMetadata.ncc02Tags = ncc02Event.tags;
  }
  if (willPublishNcc05 && locatorPayload) {
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
