// sidecar/index.js
import WebSocket from 'ws';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { parseNostrMessage } from '../lib/protocol.js';
import { finalizeEvent } from 'nostr-tools/pure';
import { nip44 } from 'nostr-tools';
import { NCC02Builder } from 'ncc-02-js';
import { buildExternalEndpoints, getExpectedK, scheduleWithJitter } from 'ncc-06-js';
import { loadConfig as loadSidecarConfig } from './config-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootConfigPath = path.resolve(__dirname, '../config.json');
const rootConfig = JSON.parse(readFileSync(rootConfigPath, 'utf-8'));

const log = (message, ...args) => console.log(`[Sidecar] ${message}`, ...args);
const warn = (message, ...args) => console.warn(`[Sidecar] WARNING: ${message}`, ...args);
const error = (message, ...args) => console.error(`[Sidecar] ERROR: ${message}`, ...args);

const sidecarConfig = loadSidecarConfig();
const computedExpectedK = getExpectedK(sidecarConfig, { baseDir: __dirname });
let expectedK = computedExpectedK;
if (sidecarConfig.ncc02ExpectedKey && sidecarConfig.ncc02ExpectedKey !== computedExpectedK) {
  warn('sidecar config expected key differs from computed value; honoring configured value for this run.');
  expectedK = sidecarConfig.ncc02ExpectedKey;
} else {
  sidecarConfig.ncc02ExpectedKey = computedExpectedK;
}
const clientConfigPath = path.resolve(__dirname, '../ncc06-client/config.json');
const clientConfig = JSON.parse(readFileSync(clientConfigPath, 'utf-8'));

const RELAY_URL = sidecarConfig.relayUrl || rootConfig.relayUrl;
const PRIVATE_KEY = sidecarConfig.serviceSk;
const PUBLIC_KEY = sidecarConfig.servicePk;
const SERVICE_NPUB = sidecarConfig.serviceNpub;

if (!PRIVATE_KEY || !PUBLIC_KEY || !SERVICE_NPUB) {
  console.error("Sidecar service identity is missing. Please ensure 'serviceSk', 'servicePk', and 'serviceNpub' are set in ncc06-sidecar/config.json.");
  process.exit(1);
}

const ncc02Builder = new NCC02Builder(PRIVATE_KEY);
let storedServiceRecord = null;
let storedAttestation = null;
let locatorTimer = null;
let serviceTimer = null;

function getPublicationRelays() {
  const configured = sidecarConfig.publishRelays ?? sidecarConfig.publicationRelays ?? [];
  return [...new Set([RELAY_URL, ...configured.filter(Boolean)])];
}

const PUBLICATION_RELAYS = getPublicationRelays();

async function connectAndPublish() {
  log(`Preparing to publish service material for SERVICE_NPUB=${SERVICE_NPUB} to relays: ${PUBLICATION_RELAYS.join(', ')}`);
  log('Skipping NCC document publication (kind undefined).');

  const events = [];
  stageServiceRecord(events);
  const locatorPayload = await stageLocator(events);
  stageEncryptedLocator(events, locatorPayload);
  stageAttestation(events);
  stageRevocation(events);

  await publishEventsToPublicationSet(events);
  log('All events published. Disconnecting in 5 seconds.');
  if (!shouldRunDaemon()) {
    setTimeout(() => process.exit(0), 5000);
  } else {
    scheduleServiceRefresh();
    scheduleLocatorRepublish(locatorPayload.ttl || sidecarConfig.ncc05TtlSeconds);
  }
}

function stageServiceRecord(events) {
  const configuredSeconds = Number(sidecarConfig.ncc02ExpSeconds) || 3600;
  const expirySeconds = Math.max(60, configuredSeconds);
  const expiryDays = expirySeconds / 86400;
  try {
    storedServiceRecord = ncc02Builder.createServiceRecord({
      serviceId: sidecarConfig.serviceId,
      endpoint: rootConfig.relayWssUrl || sidecarConfig.relayUrl,
      fingerprint: expectedK,
      expiryDays
    });
    events.push(storedServiceRecord);
    log(`Prepared NCC-02 service record (ID: ${storedServiceRecord.id})`);
  } catch (err) {
    error('Failed to build NCC-02 service record:', err);
  }
}

function createLocatorPayload(endpoints) {
  const createdAt = Math.floor(Date.now() / 1000);
  return {
    ttl: sidecarConfig.ncc05TtlSeconds,
    updated_at: createdAt,
    endpoints
  };
}

async function stageLocator(events) {
  const createdAt = Math.floor(Date.now() / 1000);
  const endpoints = await buildExternalEndpoints({
    tor: sidecarConfig.torControl,
    ipv6: sidecarConfig.externalEndpoints?.ipv6,
    ipv4: sidecarConfig.externalEndpoints?.ipv4,
    wsPort: rootConfig.relayPort,
    wssPort: rootConfig.relayWssPort,
    ncc02ExpectedKey: expectedK,
    publicIpv4Sources: sidecarConfig.externalEndpoints?.ipv4?.publicSources,
    ensureOnionService: async () => ensureOnionEndpoint({
      torControl: sidecarConfig.torControl,
      cacheFile: sidecarConfig.torControl?.serviceFile,
      relayPort: rootConfig.relayPort
    })
  });
  const expiration = createdAt + sidecarConfig.ncc05TtlSeconds;
  const locatorContent = createLocatorPayload(endpoints);

  const event = {
    kind: 30058,
    pubkey: PUBLIC_KEY,
    created_at: createdAt,
    tags: [
      ["d", sidecarConfig.locatorId],
      ["expiration", expiration.toString()]
    ],
    content: JSON.stringify(locatorContent)
  };

  events.push(finalizeEvent(event, PRIVATE_KEY));
  log(`Prepared NCC-05 locator (ID: ${event.id}) with ${locatorContent.endpoints.length} endpoints`);
  return locatorContent;
}

function stageEncryptedLocator(events, locatorPayload) {
  const recipientPubkey = clientConfig.locatorFriendPubkey;
  if (!recipientPubkey) {
    warn('No locator friend pubkey configured; skipping encrypted locator.');
    return;
  }

  const hexToUint8 = hex => new Uint8Array(Buffer.from(hex, 'hex'));
  const signerKey = hexToUint8(PRIVATE_KEY);
  const conversationKey = nip44.getConversationKey(signerKey, recipientPubkey);
  const encryptedContent = nip44.encrypt(JSON.stringify(locatorPayload), conversationKey);
  const createdAt = Math.floor(Date.now() / 1000);

  const event = {
    kind: 30058,
    pubkey: PUBLIC_KEY,
    created_at: createdAt,
    tags: [
      ["d", sidecarConfig.locatorId],
      ["recipient", recipientPubkey],
      ["encryption", "nip-44"]
    ],
    content: encryptedContent
  };

  events.push(finalizeEvent(event, PRIVATE_KEY));
  log(`Prepared encrypted NCC-05 locator for ${recipientPubkey} (ID: ${event.id})`);
}

function stageAttestation(events) {
  if (!storedServiceRecord) {
    warn('Skipping attestation publish; service record not available yet.');
    return;
  }
  try {
    storedAttestation = ncc02Builder.createAttestation({
      subjectPubkey: PUBLIC_KEY,
      serviceId: sidecarConfig.serviceId,
      serviceEventId: storedServiceRecord.id,
      level: 'verified'
    });
    events.push(storedAttestation);
    log(`Prepared NCC-02 attestation (ID: ${storedAttestation.id})`);
  } catch (err) {
    error('Failed to build NCC-02 attestation:', err);
  }
}

function stageRevocation(events) {
  if (!storedAttestation) {
    warn('Skipping revocation publish; attestation event missing.');
    return;
  }
  try {
    const revocationEvent = ncc02Builder.createRevocation({
      attestationId: storedAttestation.id,
      reason: 'Automated revocation for test harness'
    });
    events.push(revocationEvent);
    log(`Prepared NCC-02 revocation (ID: ${revocationEvent.id})`);
  } catch (err) {
    error('Failed to build NCC-02 revocation:', err);
  }
}

async function publishEventsToPublicationSet(events) {
  for (const relayUrl of PUBLICATION_RELAYS) {
    try {
      await publishEventsToRelay(relayUrl, events);
      log(`Published ${events.length} events to ${relayUrl}`);
    } catch (err) {
      warn(`Failed to publish events to ${relayUrl}: ${err.message}`);
    }
  }
}

async function publishEventsToRelay(relayUrl, events) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrl);
    const timeout = setTimeout(() => {
      ws.close();
    }, 4000);

    ws.onopen = () => {
      log(`Publishing ${events.length} events to ${relayUrl}`);
      for (const event of events) {
        ws.send(JSON.stringify(['EVENT', event]));
      }
    };

    ws.onmessage = msg => {
      const message = parseNostrMessage(msg.data.toString());
      if (!message) return;
      if (message[0] === 'OK') {
        const [ , eventId, accepted, info ] = message;
        log(`Relay ${relayUrl} response for ${eventId}: Accepted=${accepted}, Message="${info}"`);
      } else if (message[0] === 'NOTICE') {
        warn(`relay ${relayUrl} NOTICE: ${message[1]}`);
      }
    };

    ws.once('error', err => {
      clearTimeout(timeout);
      reject(err);
    });

    ws.onclose = () => {
      clearTimeout(timeout);
      resolve();
    };
  });
}

connectAndPublish();

if (shouldRunDaemon()) {
  const jitterRatio = Math.max(0, Number(sidecarConfig.jitterRatio ?? 0.15));
  const ncc02ExpirySeconds = Math.max(60, Number(sidecarConfig.ncc02ExpSeconds) || 3600);
  const ncc05TtlSeconds = Math.max(60, Number(sidecarConfig.ncc05TtlSeconds) || 3600);

  scheduleServiceRefresh(ncc02ExpirySeconds, jitterRatio);
  scheduleLocatorRepublish(ncc05TtlSeconds, jitterRatio);
}

function shouldRunDaemon() {
  return process.env.NCC06_SIDE_CAR_MODE === 'daemon';
}

function scheduleLocatorRepublish(baseSeconds, jitterRatio) {
  if (!shouldRunDaemon() || baseSeconds <= 0) return;
  const baseMs = Math.max(1000, baseSeconds * 1000);
  const delay = scheduleWithJitter(baseMs, jitterRatio);
  locatorTimer = setTimeout(async () => {
    await republishLocator();
    scheduleLocatorRepublish(baseSeconds, jitterRatio);
  }, delay);
}

function scheduleServiceRefresh(baseSeconds, jitterRatio) {
  if (!shouldRunDaemon()) return;
  const baseMs = Math.max(1000, baseSeconds * 1000);
  const delay = scheduleWithJitter(baseMs, jitterRatio);
  serviceTimer = setTimeout(async () => {
    await refreshServiceRecord();
    scheduleServiceRefresh(baseSeconds, jitterRatio);
  }, delay);
}

async function republishLocator() {
  log('Republishing NCC-05 locator');
  const events = [];
  const locatorPayload = await stageLocator(events);
  stageEncryptedLocator(events, locatorPayload);
  await publishEventsToPublicationSet(events);
}

async function refreshServiceRecord() {
  log('Refreshing NCC-02 service record');
  const events = [];
  stageServiceRecord(events);
  stageAttestation(events);
  stageRevocation(events);
  await publishEventsToPublicationSet(events);
}
