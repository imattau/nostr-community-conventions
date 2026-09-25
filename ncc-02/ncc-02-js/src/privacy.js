import { nip19, nip44 } from 'nostr-tools';
import { hexToBytes } from 'nostr-tools/utils';
import { getPublicKey } from 'nostr-tools/pure';

const PRIVATE_TAG = 'private';
const PRIVATE_RECIPIENTS_TAG = 'privateRecipients';
const HEX_REGEX = /^[0-9a-f]{64}$/i;

/**
 * @typedef {Object} NipSigner
 * @property {(thirdPartyPubkey: string, plaintext: string) => Promise<string> | string} [nip44Encrypt]
 * @property {(ownerPubkey: string, ciphertext: string) => Promise<string> | string} [nip44Decrypt]
 * @property {{encrypt: (thirdPartyPubkey: string, plaintext: string) => Promise<string> | string, decrypt: (ownerPubkey: string, ciphertext: string) => Promise<string> | string}} [nip04]
 * @property {() => Promise<string> | string} [getPublicKey]
 */

/**
 * Normalize a pubkey string (hex or npub) into a lowercase hex string.
 * @param {string} value
 * @returns {string}
 */
function normalizeHexPubkey(value) {
  if (typeof value !== 'string') {
    throw new Error('Pubkey must be a string');
  }
  const lower = value.toLowerCase();
  if (HEX_REGEX.test(lower)) {
    return lower;
  }
  try {
    const decoded = nip19.decode(value);
    if (decoded.type === 'npub' && typeof decoded.data === 'string') {
      return decoded.data.toLowerCase();
    }
  } catch {
    /** fall through */
  }
  throw new Error('Unsupported pubkey format');
}

/**
 * Convert a lowercase hex pubkey into a canonical npub value.
 * @param {string} hexPubkey
 * @returns {string}
 */
function toNpub(hexPubkey) {
  return nip19.npubEncode(hexPubkey);
}

/**
 * Ensure we work with Uint8Array private keys for NIP-44 helpers.
 * @param {string|Uint8Array} key
 * @returns {Uint8Array}
 */
function toUint8ArrayKey(key) {
  if (typeof key === 'string') {
    return hexToBytes(key);
  }
  if (key instanceof Uint8Array) {
    return key;
  }
  throw new Error('Private key must be a hex string or Uint8Array');
}

/**
 * @param {string | Uint8Array | NipSigner} owner
 * @returns {(recipientHex: string, plaintext: string) => Promise<string>}
 */
function createNip44Encryptor(owner) {
  if (typeof owner === 'string' || owner instanceof Uint8Array) {
    const ownerKeyBytes = toUint8ArrayKey(owner);
    return async (recipientHex, plaintext) => {
      const conversationKey = nip44.getConversationKey(ownerKeyBytes, recipientHex);
      return nip44.encrypt(plaintext, conversationKey);
    };
  }

  if (owner && typeof owner === 'object') {
    if (typeof owner.nip44Encrypt === 'function') {
      const encryptFn = owner.nip44Encrypt.bind(owner);
      return (recipientHex, plaintext) => Promise.resolve(encryptFn(recipientHex, plaintext));
    }
    if (owner.nip04 && typeof owner.nip04.encrypt === 'function') {
      const encryptFn = owner.nip04.encrypt.bind(owner.nip04);
      return (recipientHex, plaintext) => Promise.resolve(encryptFn(recipientHex, plaintext));
    }
  }

  throw new Error('Unsupported owner signer; must be private key or NIP-44/NIP-04 capable signer');
}

/**
 * @param {string | Uint8Array | NipSigner} recipient
 * @returns {(ownerHex: string, ciphertext: string) => Promise<string>}
 */
function createNip44Decryptor(recipient) {
  if (typeof recipient === 'string' || recipient instanceof Uint8Array) {
    const recipientKeyBytes = toUint8ArrayKey(recipient);
    return async (ownerHex, ciphertext) => {
      const conversationKey = nip44.getConversationKey(recipientKeyBytes, ownerHex);
      return nip44.decrypt(ciphertext, conversationKey);
    };
  }

  if (recipient && typeof recipient === 'object') {
    if (typeof recipient.nip44Decrypt === 'function') {
      const decryptFn = recipient.nip44Decrypt.bind(recipient);
      return (ownerHex, ciphertext) => Promise.resolve(decryptFn(ownerHex, ciphertext));
    }
    if (recipient.nip04 && typeof recipient.nip04.decrypt === 'function') {
      const decryptFn = recipient.nip04.decrypt.bind(recipient.nip04);
      return (ownerHex, ciphertext) => Promise.resolve(decryptFn(ownerHex, ciphertext));
    }
  }

  throw new Error('Unsupported recipient signer; must be private key or NIP-44/NIP-04 capable signer');
}

/**
 * Resolve a pubkey for either a raw key or a signer object.
 * @param {string | Uint8Array | NipSigner} recipient
 * @returns {Promise<string>}
 */
async function resolveRecipientPubkey(recipient) {
  if (typeof recipient === 'string' || recipient instanceof Uint8Array) {
    return normalizeHexPubkey(getPublicKey(toUint8ArrayKey(recipient)));
  }
  if (recipient && typeof recipient.getPublicKey === 'function') {
    const pubkey = await recipient.getPublicKey();
    return normalizeHexPubkey(pubkey);
  }
  throw new Error('Recipient must provide a private key or a NIP signer with getPublicKey()');
}

/**
 * Parse the required `private` tag from an event.
 * @param {any[]} tags
 * @returns {boolean | null}
 */
export function parsePrivateFlag(tags) {
  if (!Array.isArray(tags)) return null;
  const tag = tags.find((t) => Array.isArray(t) && t[0] === PRIVATE_TAG);
  if (!tag || typeof tag[1] !== 'string') return null;
  const normalized = tag[1].toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return null;
}

/**
 * Extract all `privateRecipients` ciphertext values from an event.
 * @param {any[]} tags
 * @returns {string[]}
 */
export function collectPrivateRecipients(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((t) => Array.isArray(t) && t[0] === PRIVATE_RECIPIENTS_TAG && typeof t[1] === 'string')
    .map((t) => t[1]);
}

/**
 * Encrypt a list of recipient pubkeys so they can be published in a service record.
 * @param {string | Uint8Array | NipSigner} ownerPrivateKey
 * @param {string[]} recipients
 * @returns {Promise<string[]>}
 */
export async function encryptPrivateRecipients(ownerPrivateKey, recipients) {
  if (!Array.isArray(recipients)) {
    throw new Error('recipients must be an array of pubkeys');
  }
  const encryptor = createNip44Encryptor(ownerPrivateKey);
  const encrypted = [];
  for (const recipient of recipients) {
    const recipientHex = normalizeHexPubkey(recipient);
    const recipientNpub = toNpub(recipientHex);
    encrypted.push(await encryptor(recipientHex, recipientNpub));
  }
  return encrypted;
}

/**
 * Decrypt a single private recipient ciphertext.
 * @param {string} ciphertext
 * @param {string} ownerPubkey
 * @param {string | Uint8Array | NipSigner} recipientPrivateKey
 * @returns {Promise<string>}
 */
export async function decryptPrivateRecipient(ciphertext, ownerPubkey, recipientPrivateKey) {
  const ownerHex = normalizeHexPubkey(ownerPubkey);
  const decryptor = createNip44Decryptor(recipientPrivateKey);
  return decryptor(ownerHex, ciphertext);
}

/**
 * Check whether the provided private key matches one of the encrypted recipients.
 * @param {string[]} privateRecipients
 * @param {string} ownerPubkey
 * @param {string | Uint8Array | NipSigner} recipientPrivateKey
 * @returns {Promise<boolean>}
 */
export async function isPrivateRecipientAuthorized(privateRecipients, ownerPubkey, recipientPrivateKey) {
  if (!Array.isArray(privateRecipients) || privateRecipients.length === 0) return false;
  const ownerHex = normalizeHexPubkey(ownerPubkey);
  const recipientPubkey = await resolveRecipientPubkey(recipientPrivateKey);
  const expectedNpub = toNpub(normalizeHexPubkey(recipientPubkey));
  const decryptor = createNip44Decryptor(recipientPrivateKey);
  for (const ciphertext of privateRecipients) {
    try {
      const decrypted = await decryptor(ownerHex, ciphertext);
      if (decrypted === expectedNpub) return true;
    } catch {
      // ignore decrypt errors, ciphertext might not target this recipient
    }
  }
  return false;
}
