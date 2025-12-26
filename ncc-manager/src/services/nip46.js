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
  const conversationKey = nip44.getConversationKey(privKeyHex, pubKeyHex);
  return nip44.decrypt(content, conversationKey);
}

async function sendRequest(method, params) {
  return new Promise((resolve, reject) => {
    (async () => {
      if (!remotePubkey || !connectionRelays.length) {
        return reject(new Error("NIP-46 not connected."));
      }

      const id = Math.random().toString().slice(2);
      requests.set(id, { resolve, reject });

      const payload = { id, method, params };
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
      publishToRelays(event);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (requests.has(id)) {
          reject(new Error("Request timed out."));
          requests.delete(id);
        }
      }, 30000);
    })();
  });
}

async function handleEvent(event) {
  try {
    if (remotePubkey && event.pubkey !== remotePubkey) return;

    const senderPubkey = event.pubkey;
    let decrypted;
    try {
        const privKeyHex = toHex(secretKey);
        
        // Detect and switch encryption mode if needed
        if (!event.content.includes('?iv=')) {
            encryptionMode = 'nip44';
        } else {
            encryptionMode = 'nip04';
        }

        decrypted = await decrypt(privKeyHex, senderPubkey, event.content);
    } catch (err) {
        console.error("[NIP-46] Decryption failed:", err);
        return;
    }
    
    const payload = JSON.parse(decrypted);

    // Case 1: Response to our request
    if (payload.id && requests.has(payload.id)) {
      const { resolve, reject } = requests.get(payload.id);
      if (payload.error) {
        reject(new Error(payload.error));
      } else {
        resolve(payload.result);
      }
      requests.delete(payload.id);
      return;
    }

    // Case 2: Handshake or Implicit Connect
    if (!remotePubkey || remotePubkey === senderPubkey) {
        if (payload.method === 'connect') {
            remotePubkey = senderPubkey;
            
            // Send ACK
            const response = { id: payload.id, result: "ack", error: null };
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

            if (onConnectCallback) {
                onConnectCallback(remotePubkey);
                onConnectCallback = null;
            }
        } else if (payload.result) {
            // Implicit connect from valid decrypted payload
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
        remotePubkey = url.pathname.substring(2);
        
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
    encryptionMode = 'nip04';

    if (bunkerUrl) {
        await connectBunker(bunkerUrl);
        return null;
    } else {
        const defaultRelays = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
        connectionRelays = defaultRelays;
        
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