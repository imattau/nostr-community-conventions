import { nip19 } from 'nostr-tools';

export function parseManualAdminPubkey(value) {
  if (!value) throw new Error('missing value');
  const sanitized = value.trim().replace(/\s+/g, '');
  if (/^npub1/i.test(sanitized)) {
    try {
      const decoded = nip19.decode(sanitized.toLowerCase());
      if (decoded.type !== 'npub') {
        throw new Error('invalid npub');
      }
      return decoded.data;
    } catch {
      throw new Error('Invalid npub');
    }
  }
  if (/^[0-9a-f]{64}$/i.test(sanitized)) {
    return sanitized.toLowerCase();
  }
  throw new Error('invalid admin pubkey');
}
