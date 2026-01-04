import crypto from 'crypto';
import { SimplePool } from 'nostr-tools';
import { Genericlists } from 'nostr-tools/kinds';
import { getPublicKey } from 'nostr-tools/pure';
import { 
  buildBackupPayload, createBackupEvent, parseBackupEvent,
  buildAdminRecoveryPayload, createAdminRecoveryEvent
} from './list-backup.js';
import { publishToRelays } from './publisher.js';
import { getConfig, setConfig, getServices, getAdmins, updateService, addAdmin, addLog } from './db.js';
import { fromNsec } from 'ncc-06-js';

const BACKUP_HASH_KEY = 'list_backup_hash';
const RECOVERY_HASH_KEY = 'admin_recovery_hash';
const BACKUP_EVENT_ID_KEY = 'list_backup_event_id';
const BACKUP_LAST_SYNC_KEY = 'list_backup_last_sync';
const BACKUP_SYNC_TTL_MS = 5 * 60 * 1000;

function getBackupRelays(service) {
  const appConfig = getConfig('app_config') || {};
  const explicitlyConfigured = Array.isArray(service?.config?.publication_relays)
    ? service.config.publication_relays
    : [];
  if (explicitlyConfigured.length) return explicitlyConfigured.filter(Boolean);
  const fallback = Array.isArray(appConfig.publication_relays)
    ? appConfig.publication_relays
    : [];
  return fallback.filter(Boolean);
}

function buildPayloadSnapshot(timestamp) {
  return buildBackupPayload({
    services: getServices(),
    admins: getAdmins(),
    appConfig: getConfig('app_config') || {},
    timestamp
  });
}

export async function maybePublishListBackup({ service, secretKey }) {
  const relays = getBackupRelays(service);
  if (!relays.length) return null;
  
  // Use timestamp 0 for stable hashing to detect actual content changes
  const stablePayload = buildPayloadSnapshot(0);
  const hash = crypto.createHash('sha256').update(JSON.stringify(stablePayload)).digest('hex');
  
  if (getConfig(BACKUP_HASH_KEY) === hash) {
    return null;
  }
  
  // Content changed, generate fresh payload with current timestamp
  const livePayload = buildPayloadSnapshot();
  const event = createBackupEvent({ secretKey, payload: livePayload });
  
  await publishToRelays(relays, [event], secretKey);
  
  setConfig(BACKUP_HASH_KEY, hash);
  setConfig(BACKUP_EVENT_ID_KEY, event.id);
  setConfig(BACKUP_LAST_SYNC_KEY, Date.now());
  addLog('info', 'Published list backup to relays', {
    eventId: event.id,
    publicationRelays: relays
  });
  return { event, payload: livePayload, relays };
}

export async function maybePublishAdminRecovery({ service, secretKey }) {
  const admins = getAdmins();
  if (!admins.length) return null;
  const relays = getBackupRelays(service);
  if (!relays.length) return null;

  const payload = buildAdminRecoveryPayload(service);
  // Create a stable hash of the payload (excluding timestamp) and the current admin list
  const stablePayload = { ...payload, timestamp: 0, admins: admins.map(a => a.pubkey).sort() };
  const hash = crypto.createHash('sha256').update(JSON.stringify(stablePayload)).digest('hex');

  if (getConfig(RECOVERY_HASH_KEY) === hash) {
    return null;
  }

  const events = [];
  for (const admin of admins) {
    try {
      const event = createAdminRecoveryEvent({ 
        secretKey, 
        adminPubkey: admin.pubkey, 
        payload 
      });
      events.push(event);
    } catch (err) {
      console.warn(`[Backup] Failed to create recovery event for admin ${admin.pubkey}:`, err.message);
    }
  }

  if (events.length > 0) {
    await publishToRelays(relays, events, secretKey);
    setConfig(RECOVERY_HASH_KEY, hash);
    addLog('info', `Published admin recovery events to ${relays.length} relays`, {
      adminCount: events.length
    });
  }

  return events;
}

export function restoreBackupPayload(payload, { message = null, log = true } = {}) {
  const appConfig = payload.appConfig || {};
  setConfig('app_config', appConfig);
  const existingServices = getServices();
  const restoredServices = [];
  for (const serviceData of payload.services || []) {
    const target = existingServices.find(s => s.service_id === serviceData.service_id);
    if (!target) continue;
    const updatedConfig = {
      ...target.config,
      ...(serviceData.config || {})
    };
    updateService(target.id, {
      name: serviceData.name || target.name,
      config: updatedConfig
    });
    restoredServices.push(serviceData.service_id);
  }
  let restoredAdmins = 0;
  for (const admin of payload.admins || []) {
    if (!admin?.pubkey || !/^[0-9a-f]{64}$/i.test(admin.pubkey)) continue;
    addAdmin(admin.pubkey, admin.status || 'active');
    restoredAdmins++;
  }
  if (log) {
    addLog('info', message || 'Restored configuration from list backup', {
      restoredServices,
      restoredAdmins
    });
  }
  return { restoredServices, restoredAdmins };
}

async function queryLatestBackupEvent(relays, author) {
  if (!relays.length || !author) return null;
  const pool = new SimplePool();
  try {
    const filter = {
      kinds: [Genericlists],
      authors: [author],
      '#d': ['ncc-sidecar-backup'],
      limit: 1
    };
    // pool.get resolves with the event or null/undefined
    const event = await pool.get(relays, filter);
    return event || null;
  } catch (err) {
    console.warn('[Backup] Failed to query latest backup:', err.message);
    return null;
  } finally {
    pool.close(relays);
  }
}

export async function fetchRemoteBackup({ force = false } = {}) {
  const relays = Array.from(new Set(getConfig('app_config')?.publication_relays || []));
  const now = Date.now();
  const lastSync = getConfig(BACKUP_LAST_SYNC_KEY) || 0;
  if (!relays.length) {
    return { skipped: true, reason: 'no publication relays configured' };
  }
  if (!force && now - lastSync < BACKUP_SYNC_TTL_MS) {
    return { skipped: true, reason: 'throttled' };
  }
  const services = getServices();
  const sidecar = services.find(s => s.type === 'sidecar');
  if (!sidecar) {
    addLog('error', 'Backup sync failed: Sidecar service missing');
    return { error: 'Sidecar service missing' };
  }
  const secretKey = fromNsec(sidecar.service_nsec);
  const author = getPublicKey(secretKey);
  const event = await queryLatestBackupEvent(relays, author);
  setConfig(BACKUP_LAST_SYNC_KEY, now);
  if (!event) {
    addLog('warn', 'Backup sync: No remote backup event found', { author });
    return { message: 'No backup event found' };
  }
  if (!force && event.id === getConfig(BACKUP_EVENT_ID_KEY)) {
    return { skipped: true, reason: 'already synced', eventId: event.id };
  }
  const payload = parseBackupEvent(event, secretKey);
  const restored = restoreBackupPayload(payload);
  setConfig(BACKUP_EVENT_ID_KEY, event.id);
  return { success: true, eventId: event.id, restored };
}

export { getBackupRelays };
