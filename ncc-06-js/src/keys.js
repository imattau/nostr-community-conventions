import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';

/**
 * Generate a deterministic keypair, returning all common formats.
 */
export function generateKeypair() {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  return {
    secretKey,
    publicKey: pubkey,
    npub: nip19.npubEncode(pubkey),
    nsec: nip19.nsecEncode(secretKey)
  };
}

/**
 * Convert raw pubkey to npub.
 */
export function toNpub(pubkey) {
  return nip19.npubEncode(pubkey);
}

/**
 * Decode npub back to raw pubkey.
 */
export function fromNpub(npub) {
  const decoded = nip19.decode(npub);
  if (decoded.type !== 'npub') {
    throw new Error('Invalid npub value');
  }
  return decoded.data;
}

/**
 * Convert raw secret key to nsec.
 */
export function toNsec(secretKey) {
  return nip19.nsecEncode(secretKey);
}

/**
 * Decode nsec back to secret key.
 */
export function fromNsec(nsec) {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== 'nsec') {
    throw new Error('Invalid nsec value');
  }
  return decoded.data;
}
