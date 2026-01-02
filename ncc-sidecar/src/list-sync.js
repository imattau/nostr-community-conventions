import crypto from 'crypto';
import { SimplePool } from 'nostr-tools';
import { Genericlists } from 'nostr-tools/kinds';
import { getPublicKey } from 'nostr-tools/pure';
import { buildBackupPayload, createBackupEvent, parseBackupEvent } from './list-backup.js';
import { publishToRelays } from './publisher.js';
import { getConfig, setConfig, getServices, getAdmins, updateService, addAdmin, addLog } from './db.js';
import { fromNsec } from 'ncc-06-js';

const BACKUP_HASH_KEY = 'list_backup_hash';
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

function buildPayloadSnapshot() {
  return buildBackupPayload({
    services: getServices(),
    admins: getAdmins(),
    appConfig: getConfig('app_config') || {}
  });
}

export async function maybePublishListBackup({ service, secretKey }) {
  const relays = getBackupRelays(service);
  if (!relays.length) return null;
  const payload = buildPayloadSnapshot();
  const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  if (getConfig(BACKUP_HASH_KEY) === hash) {
    return null;
  }
  const event = createBackupEvent({ secretKey, payload });
  await publishToRelays(relays, [event], secretKey);
  setConfig(BACKUP_HASH_KEY, hash);
  setConfig(BACKUP_EVENT_ID_KEY, event.id);
  setConfig(BACKUP_LAST_SYNC_KEY, Date.now());
  addLog('info', 'Published list backup to relays', {
    eventId: event.id,
    publicationRelays: relays
  });
  return { event, payload, relays };
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

function queryLatestBackupEvent(relays, author) {
  if (!relays.length || !author) return null;
  const pool = new SimplePool();
  return new Promise((resolve) => {
    const events = [];
    const filters = [{
      kinds: [Genericlists],
      authors: [author],
      '#d': ['ncc-sidecar-backup'],
      limit: 1
    }];
    const sub = pool.sub(relays, filters);
    const timeout = setTimeout(() => {
      sub.unsub();
      pool.close(relays);
      resolve(events[0] || null);
    }, 5000);
    sub.on('event', (event) => {
      events.push(event);
    });
    sub.on('eose', () => {
      clearTimeout(timeout);
      sub.unsub();
      pool.close(relays);
      resolve(events[0] || null);
    });
  });
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
    return { error: 'Sidecar service missing' };
  }
  const secretKey = fromNsec(sidecar.service_nsec);
  const author = getPublicKey(secretKey);
  const event = await queryLatestBackupEvent(relays, author);
  setConfig(BACKUP_LAST_SYNC_KEY, now);
  if (!event) {
    return { message: 'No backup event found' };
  }
  if (!force && event.id === getConfig(BACKUP_EVENT_ID_KEY)) {
    return { skipped: true, reason: 'already synced', eventId: event.id };
  }
  const payload = parseBackupEvent(event);
  const restored = restoreBackupPayload(payload);
  setConfig(BACKUP_EVENT_ID_KEY, event.id);
  return { success: true, eventId: event.id, restored };
}

export { getBackupRelays };
