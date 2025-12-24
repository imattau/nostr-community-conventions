import { generateSecretKey, getPublicKey, nip04 } from 'nostr-tools';
import { pool } from './nostr.js';

let secretKey = null; // Our ephemeral secret key
let publicKey = null; // Our ephemeral public key
let remotePubkey = null; // The signer's public key
let connectionRelay = null;
let onConnectCallback = null;
let sub = null;
const requests = new Map();

async function sendRequest(method, params) {
  return new Promise(async (resolve, reject) => {
    if (!remotePubkey || !connectionRelay) {
      return reject(new Error("NIP-46 not connected."));
    }

    const id = Math.random().toString().slice(2);
    requests.set(id, { resolve, reject });

    const payload = {
      id,
      method,
      params,
    };

    const encryptedPayload = await nip04.encrypt(secretKey, remotePubkey, JSON.stringify(payload));
    
    const event = {
      kind: 24133,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', remotePubkey]],
      content: encryptedPayload,
      pubkey: publicKey,
    };

    pool.publish([connectionRelay], event);

    // Timeout after 30 seconds
    setTimeout(() => {
      if (requests.has(id)) {
        reject(new Error("Request timed out."));
        requests.delete(id);
      }
    }, 30000);
  });
}

async function handleResponse(event) {
  try {
    const decrypted = await nip04.decrypt(secretKey, remotePubkey, event.content);
    const { id, result, error } = JSON.parse(decrypted);

    if (requests.has(id)) {
      const { resolve, reject } = requests.get(id);
      if (error) {
        reject(new Error(error));
      } else {
        resolve(result);
      }
      requests.delete(id);
    }
  } catch (e) {
    console.error("NIP-46: Failed to handle response", e);
  }
}

async function connectBunker(bunkerUrl) {
    try {
        const url = new URL(bunkerUrl);
        remotePubkey = url.pathname.substring(2); // remove //
        connectionRelay = url.searchParams.get('relay');

        if (!remotePubkey || !connectionRelay) {
            throw new Error("Invalid bunker URL");
        }

        sub = pool.subscribe([{
            kinds: [24133],
            authors: [remotePubkey],
            '#p': [publicKey],
        }], [connectionRelay]);

        sub.on("event", handleResponse);

        const connectPubkey = await sendRequest('connect', [publicKey]);
        if (connectPubkey && onConnectCallback) {
            onConnectCallback(remotePubkey);
        }
    } catch (e) {
        console.error("NIP-46: Connection failed", e);
    }
}

const self = {
  isConnected: () => remotePubkey !== null,

  connect: (bunkerUrl, onConnect) => {
    self.disconnect();
    onConnectCallback = onConnect;
    secretKey = generateSecretKey();
    publicKey = getPublicKey(secretKey);

    if (bunkerUrl) {
        connectBunker(bunkerUrl);
        return null;
    } else {
        const defaultRelay = "wss://relay.damus.io";
        return `bunker://${publicKey}?relay=${defaultRelay}`;
    }
  },
  
  disconnect: () => {
    if (sub) sub.close();
    sub = null;
    secretKey = null;
    publicKey = null;
    remotePubkey = null;
    connectionRelay = null;
    onConnectCallback = null;
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
