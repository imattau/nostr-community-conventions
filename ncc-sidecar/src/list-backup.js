import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import { Genericlists } from 'nostr-tools/kinds';

const BACKUP_KIND = Genericlists;
const BACKUP_IDENTIFIER = 'ncc-sidecar-backup';
const BACKUP_VERSION = 1;

function deepClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function sanitizeServiceConfig(config = {}) {
  const { onion_private_key: _onion, tor_control: _tor, ...rest } = config;
  return deepClone(rest);
}

function sanitizeServiceEntry(service = {}) {
  if (!service || !service.service_id) return null;
  return {
    name: service.name || '',
    type: service.type || 'relay',
    service_id: service.service_id,
    config: sanitizeServiceConfig(service.config || {})
  };
}

export function buildBackupPayload({ services = [], admins = [], appConfig = {} } = {}) {
  return {
    version: BACKUP_VERSION,
    timestamp: Math.floor(Date.now() / 1000),
    appConfig: deepClone(appConfig),
    admins: admins
      .filter(admin => admin?.pubkey)
      .map(({ pubkey, status }) => ({
        pubkey,
        status: status || 'active'
      })),
    services: services
      .map(sanitizeServiceEntry)
      .filter(Boolean)
  };
}

export function createBackupEvent({ secretKey, payload, createdAt }) {
  if (!secretKey) {
    throw new Error('secretKey is required to sign the backup event');
  }
  const event = {
    kind: BACKUP_KIND,
    created_at: createdAt || Math.floor(Date.now() / 1000),
    tags: [['d', BACKUP_IDENTIFIER]],
    content: JSON.stringify(payload)
  };
  return finalizeEvent(event, secretKey);
}

export function parseBackupEvent(event) {
  if (!event || event.kind !== BACKUP_KIND) {
    throw new Error('Unsupported event kind for NCC Sidecar backup');
  }
  if (!verifyEvent(event)) {
    throw new Error('Backup event signature is invalid');
  }
  const dTag = event.tags.find(tag => tag[0] === 'd' && tag[1]);
  if (!dTag || dTag[1] !== BACKUP_IDENTIFIER) {
    throw new Error('Event is not an NCC Sidecar backup');
  }
  let payload;
  try {
    payload = JSON.parse(event.content || '{}');
  } catch {
    throw new Error('Backup payload is not valid JSON');
  }
  if (payload.version !== BACKUP_VERSION) {
    throw new Error('Unsupported backup version');
  }
  return payload;
}
