// sidecar/index.js
import WebSocket from 'ws';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { createOkMessage, createNoticeMessage, parseNostrMessage } from '../relay/protocol.js';
import { finalizeEvent } from 'nostr-tools/pure';
import { nip44 } from 'nostr-tools';
import { NCC02Builder } from 'ncc-02-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootConfigPath = path.resolve(__dirname, '../config.json');
const rootConfig = JSON.parse(readFileSync(rootConfigPath, 'utf-8'));

const sidecarConfigPath = path.resolve(__dirname, './config.json');
const sidecarConfig = JSON.parse(readFileSync(sidecarConfigPath, 'utf-8'));
const clientConfigPath = path.resolve(__dirname, '../client/config.json');
const clientConfig = JSON.parse(readFileSync(clientConfigPath, 'utf-8'));

const RELAY_URL = sidecarConfig.relayUrl || rootConfig.relayUrl;
const PRIVATE_KEY = sidecarConfig.sidecarPrivateKey;
const PUBLIC_KEY = sidecarConfig.sidecarPublicKey;

if (!PRIVATE_KEY || !PUBLIC_KEY) {
  console.error("Sidecar keys not found in config. Please ensure 'sidecarPrivateKey' and 'sidecarPublicKey' are set in sidecar/config.json.");
  process.exit(1);
}

const log = (message, ...args) => console.log(`[Sidecar] ${message}`, ...args);
const warn = (message, ...args) => console.warn(`[Sidecar] WARNING: ${message}`, ...args);
const error = (message, ...args) => console.error(`[Sidecar] ERROR: ${message}`, ...args);

const ncc02Builder = new NCC02Builder(PRIVATE_KEY);
let storedServiceRecord = null;
let storedAttestation = null;


async function connectAndPublish() {
  log(`Connecting to relay at ${RELAY_URL}...`);
  const ws = new WebSocket(RELAY_URL);

  ws.onopen = async () => {
    log('Connected to relay. Publishing events...');
    
    // --- Step 1: Publish NCC documents (Stub for now) ---
    // The kind for NCC documents is not specified in NCC-00.
    // For now, this step is a placeholder.
    log('Skipping NCC document publication (kind undefined).');

    // --- Step 2: Publish NCC-02 Service Record (30059) ---
    await publishNCC02(ws);

    // --- Step 3: Publish NCC-05 Locator (30058) ---
    await publishNCC05(ws);

    // --- Step 4 & 5: Optional: Publish Attestation (30060) and Revocation (30061) ---
    // These require the ID of the NCC-02 event, so we'll pass it if we get it back from the relay.
    // For simplicity in this minimal example, we won't wait for the relay's OK before publishing these,
    // but in a real-world scenario, you might want to ensure NCC-02 is stored first.
    // We'll just demonstrate the publishing.
    await publishAttestation(ws);
    await publishRevocation(ws);

    log('All events published. Disconnecting from relay in 5 seconds.');
    setTimeout(() => {
        ws.close();
        process.exit(0);
    }, 5000);
  };

  ws.onmessage = event => {
    const message = parseNostrMessage(event.data.toString());
    if (!message) return;

    const [type, ...payload] = message;

    if (type === 'OK') {
      const [eventId, accepted, msg] = payload;
      log(`Relay response for event ${eventId}: Accepted=${accepted}, Message="${msg}"`);
    } else if (type === 'NOTICE') {
      const [msg] = payload;
      warn(`Relay NOTICE: ${msg}`);
    } else {
      log(`Received unhandled message type: ${type}`);
    }
  };

  ws.onerror = err => {
    error('WebSocket error:', err);
    process.exit(1);
  };

  ws.onclose = () => {
    log('Disconnected from relay.');
    process.exit(0);
  };
}

async function publishEvent(ws, event) {
    const alreadySigned = event && typeof event.id === 'string' && typeof event.sig === 'string';
    const signedEvent = alreadySigned ? event : finalizeEvent(event, PRIVATE_KEY);
    log(`Publishing event kind ${signedEvent.kind} (ID: ${signedEvent.id})`);
    ws.send(JSON.stringify(["EVENT", signedEvent]));
}

async function publishNCC02(ws) {
  const configuredSeconds = Number(sidecarConfig.ncc02ExpSeconds) || 3600;
  const expirySeconds = Math.max(60, configuredSeconds);
  const expiryDays = expirySeconds / 86400;

  try {
    storedServiceRecord = ncc02Builder.createServiceRecord({
      serviceId: sidecarConfig.serviceId,
      endpoint: sidecarConfig.relayUrl,
      fingerprint: sidecarConfig.ncc02ExpectedKey,
      expiryDays
    });
    await publishEvent(ws, storedServiceRecord);
  } catch (err) {
    error('Failed to build NCC-02 service record:', err);
  }
}

function buildLocatorPayload() {
    const createdAt = Math.floor(Date.now() / 1000);
    return {
        ttl: sidecarConfig.ncc05TtlSeconds,
        updated_at: createdAt,
        endpoints: [
            {
                url: rootConfig.relayUrl,
                protocol: "ws",
                family: "ipv4",
                priority: 10,
                k: sidecarConfig.ncc02ExpectedKey
            },
            {
                url: rootConfig.relayWssUrl,
                protocol: "wss",
                family: "ipv4",
                priority: 5,
                k: sidecarConfig.ncc02ExpectedKey
            },
            {
                url: "ws://[::1]:7000",
                protocol: "ws",
                family: "ipv6",
                priority: 20,
                k: sidecarConfig.ncc02ExpectedKey
            },
            {
                url: "wss://exampleonion.onion:443",
                protocol: "wss",
                family: "onion",
                priority: 1,
                k: sidecarConfig.ncc02ExpectedKey
            }
        ]
    };
}

async function publishEncryptedLocator(ws, payload) {
    const recipientPubkey = clientConfig.locatorFriendPubkey;
    if (!recipientPubkey) {
        warn('No locator friend pubkey configured; skipping encrypted locator.');
        return;
    }

    const hexToUint8 = hex => new Uint8Array(Buffer.from(hex, 'hex'));
    const signerKey = hexToUint8(PRIVATE_KEY);
    const conversationKey = nip44.getConversationKey(signerKey, recipientPubkey);
    const encryptedContent = nip44.encrypt(JSON.stringify(payload), conversationKey);

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

    await publishEvent(ws, event);
}

async function publishNCC05(ws) {
    const kind = 30058; // NCC-05 Locator
    const createdAt = Math.floor(Date.now() / 1000);
    const expiration = createdAt + sidecarConfig.ncc05TtlSeconds;
    const locatorContent = buildLocatorPayload();

    const event = {
        kind,
        pubkey: PUBLIC_KEY,
        created_at: createdAt,
        tags: [
            ["d", sidecarConfig.locatorId],
            ["expiration", expiration.toString()]
        ],
        content: JSON.stringify(locatorContent)
    };

    await publishEvent(ws, event);
    await publishEncryptedLocator(ws, locatorContent);
}

async function publishAttestation(ws) {
    if (!storedServiceRecord) {
        warn('Skipping attestation publish; service record not available yet.');
        return;
    }
    try {
        storedAttestation = ncc02Builder.createAttestation(
            PUBLIC_KEY,
            sidecarConfig.serviceId,
            storedServiceRecord.id,
        );
        await publishEvent(ws, storedAttestation);
    } catch (err) {
        error('Failed to build NCC-02 attestation:', err);
    }
}

async function publishRevocation(ws) {
    if (!storedAttestation) {
        warn('Skipping revocation publish; attestation event missing.');
        return;
    }
    try {
        const revocationEvent = ncc02Builder.createRevocation(
            storedAttestation.id,
            'Automated revocation for test harness'
        );
        await publishEvent(ws, revocationEvent);
    } catch (err) {
        error('Failed to build NCC-02 revocation:', err);
    }
}

connectAndPublish();
