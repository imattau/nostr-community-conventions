import { generateSecretKey, getPublicKey, nip04, nip44, finalizeEvent } from 'nostr-tools';
import { pool } from './nostr.js';

let secretKey = null; // Our ephemeral secret key
let publicKey = null; // Our ephemeral public key
let remotePubkey = null; // The signer's public key
let connectionRelays = []; // Changed to array
let onConnectCallback = null;
let sub = null;
let encryptionMode = 'nip04'; // Default to NIP-04, can switch to NIP-44
const requests = new Map();

function toHex(bytes) {
  if (typeof bytes === 'string') return bytes;
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function publishToRelays(event) {
  if (!connectionRelays.length) return;
  try {
    const promises = pool.publish(connectionRelays, event);
    // Catch errors on individual relay promises to avoid unhandled rejections
    promises.forEach(p => p.catch(err => console.warn("[NIP-46] Publish failed on a relay:", err)));
    // We don't await here as we want sendRequest to manage its own timeout/response logic
  } catch (err) {
    console.error("[NIP-46] Error calling pool.publish:", err);
  }
}

async function encrypt(privKeyHex, pubKeyHex, content) {
  if (encryptionMode === 'nip44') {
    const conversationKey = nip44.getConversationKey(privKeyHex, pubKeyHex);
    return nip44.encrypt(content, conversationKey);
  }
  return nip04.encrypt(privKeyHex, pubKeyHex, content);
}

async function decrypt(privKeyHex, pubKeyHex, content) {
  if (content.includes('?iv=')) {
    return nip04.decrypt(privKeyHex, pubKeyHex, content);
  }
  // Fallback to NIP-44 if no IV present
  const conversationKey = nip44.getConversationKey(privKeyHex, pubKeyHex);
  return nip44.decrypt(content, conversationKey);
}

async function sendRequest(method, params) {
  return new Promise((resolve, reject) => {
    (async () => { // Async IIFE to allow await inside
      if (!remotePubkey || !connectionRelays.length) {
        return reject(new Error("NIP-46 not connected."));
      }

      const id = Math.random().toString().slice(2);
      requests.set(id, { resolve, reject });

      const payload = {
        id,
        method,
        params,
      };

      const privKeyHex = toHex(secretKey);
      const encryptedPayload = await encrypt(privKeyHex, remotePubkey, JSON.stringify(payload));
      
      const eventTemplate = {
        kind: 24133,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', remotePubkey]],
        content: encryptedPayload,
        pubkey: publicKey,
      };

      const event = finalizeEvent(eventTemplate, secretKey);
      
      console.log("[NIP-46] Signed event to publish:", event);
      if (!event.id) console.error("[NIP-46] Critical: Event ID missing after finalizeEvent");

      publishToRelays(event);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (requests.has(id)) {
          reject(new Error("Request timed out."));
          requests.delete(id);
        }
      }, 30000);
    })(); // Immediately invoke the async function
  });
}

async function handleEvent(event) {
  console.log("[NIP-46] Received event", event.id, "from", event.pubkey);
  try {
    // If we have a remotePubkey, ignore events from others
    if (remotePubkey && event.pubkey !== remotePubkey) {
        console.log("[NIP-46] Ignoring event from unknown pubkey", event.pubkey, "expected", remotePubkey);
        return;
    }

    // Use sender's pubkey for decryption
    const senderPubkey = event.pubkey;
    let decrypted;
    try {
        const privKeyHex = toHex(secretKey);
        
        // Detect and potentially switch encryption mode
        if (!event.content.includes('?iv=')) {
            if (encryptionMode !== 'nip44') {
                console.log("[NIP-46] Switching to NIP-44 mode based on incoming event content.");
                encryptionMode = 'nip44';
            }
        } else {
            if (encryptionMode !== 'nip04') {
                console.log("[NIP-46] Switching to NIP-04 mode based on incoming event content.");
                encryptionMode = 'nip04';
            }
        }

        decrypted = await decrypt(privKeyHex, senderPubkey, event.content);
        console.log("[NIP-46] Decrypted payload:", decrypted);
    } catch (err) {
        console.error("[NIP-46] Decryption failed:", err);
        return;
    }
    
    const payload = JSON.parse(decrypted);

    // Case 1: Response to our request
    if (payload.id && requests.has(payload.id)) {
      console.log("[NIP-46] Handling response for req", payload.id);
      const { resolve, reject } = requests.get(payload.id);
      if (payload.error) {
        reject(new Error(payload.error));
      } else {
        resolve(payload.result);
      }
      requests.delete(payload.id);
      return;
    }

    // Case 2: Handshake (connect request from signer) or Implicit Connect
    // If we haven't established remotePubkey yet, or re-confirming same
    if (!remotePubkey || remotePubkey === senderPubkey) {
        if (payload.method === 'connect') {
            console.log("[NIP-46] Received CONNECT request from", senderPubkey);
            remotePubkey = senderPubkey;
            console.log("[NIP-46] Establishing connection with", remotePubkey);
            
            // Send ACK
            const response = {
                id: payload.id,
                result: "ack",
                error: null
            };
            
            const privKeyHex = toHex(secretKey);
            const respEnc = await encrypt(privKeyHex, remotePubkey, JSON.stringify(response));
            const replyTemplate = {
                kind: 24133,
                created_at: Math.floor(Date.now() / 1000),
                tags: [['p', remotePubkey]],
                content: respEnc,
                pubkey: publicKey,
            };
            const replyEvent = finalizeEvent(replyTemplate, secretKey);
            publishToRelays(replyEvent);
            console.log("[NIP-46] Sent ACK using mode:", encryptionMode);

            if (onConnectCallback) {
                onConnectCallback(remotePubkey);
                onConnectCallback = null;
            }
        } else {
            // Implicit connect: We received a valid decrypted message that wasn't a response to our request
            // This implies the signer has our key and is communicating.
            console.log("[NIP-46] Received implicit connect payload from", senderPubkey, payload);
            remotePubkey = senderPubkey;
            
            if (onConnectCallback) {
                onConnectCallback(remotePubkey);
                onConnectCallback = null;
            }
        }
    }
  } catch (e) {
    console.warn("NIP-46: Failed to handle event", e);
  }
}

async function connectBunker(bunkerUrl) {
    try {
        const url = new URL(bunkerUrl);
        remotePubkey = url.pathname.substring(2); // remove //
        
        // Handle multiple relay params
        const relays = url.searchParams.getAll('relay');
        connectionRelays = relays.length > 0 ? relays : [url.searchParams.get('relay')].filter(Boolean);

        if (!remotePubkey || !connectionRelays.length) {
            throw new Error("Invalid bunker URL");
        }

        sub = pool.subscribe(connectionRelays, {
            kinds: [24133],
            authors: [remotePubkey],
            '#p': [publicKey],
        }, { onevent: handleEvent });

        const connectPubkey = await sendRequest('connect', [publicKey]);
        if (connectPubkey && onConnectCallback) {
            onConnectCallback(remotePubkey);
        }
    } catch (e) {
        console.error("NIP-46: Connection failed", e);
        throw e;
    }
}

const self = {
  isConnected: () => remotePubkey !== null,

  connect: async (bunkerUrl, onConnect) => {
    self.disconnect();
    onConnectCallback = onConnect;
    secretKey = generateSecretKey();
    publicKey = getPublicKey(secretKey);
    encryptionMode = 'nip04'; // Reset to default for new connection

    if (bunkerUrl) {
        await connectBunker(bunkerUrl);
        return null;
    } else {
        const defaultRelays = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
        connectionRelays = defaultRelays;
        
        console.log("[NIP-46] Listening for incoming connections on", connectionRelays, "for my pubkey", publicKey);

        // Subscribe for incoming connections
        // Note: No 'authors' filter because we don't know the signer yet
        sub = pool.subscribe(connectionRelays, {
            kinds: [24133],
            '#p': [publicKey],
        }, { onevent: handleEvent });

        const params = defaultRelays.map(r => `relay=${encodeURIComponent(r)}`).join("&");
        return `nostrconnect://${publicKey}?${params}`;
    }
  },
  
  disconnect: () => {
    if (sub) sub.close();
    sub = null;
    secretKey = null;
    publicKey = null;
    remotePubkey = null;
    connectionRelays = [];
    onConnectCallback = null;
    encryptionMode = 'nip04';
    requests.clear();
  },

  getPublicKey: async () => {
    return sendRequest('get_public_key', []);
  },

  signEvent: async (event) => {
    return sendRequest('sign_event', [event]);
  }
};

export default self;
