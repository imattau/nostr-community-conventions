import { finalizeEvent, verifyEvent, getPublicKey } from 'nostr-tools/pure';
import { hexToBytes } from 'nostr-tools/utils';

/**
 * NCC-02 Nostr Event Kinds
 */
export const KINDS = {
  SERVICE_RECORD: 30059,
  ATTESTATION: 30060,
  REVOCATION: 30061
};

/**
 * Utility for building and signing NCC-02 events.
 */
export class NCC02Builder {
  /**
   * @param {string | Uint8Array} privateKey - The private key to sign events with.
   */
  constructor(privateKey) {
    if (!privateKey) throw new Error('Private key is required');
    this.sk = typeof privateKey === 'string' ? hexToBytes(privateKey) : privateKey;
    this.pk = getPublicKey(this.sk);
  }

  /**
   * Creates a signed Service Record (Kind 30059).
   * @param {string} serviceId
   * @param {string} endpoint
   * @param {string} fingerprint
   * @param {number} [expiryDays=14]
   */
  createServiceRecord(serviceId, endpoint, fingerprint, expiryDays = 14) {
    if (!serviceId) throw new Error('serviceId (d tag) is required');
    if (!endpoint) throw new Error('endpoint (u tag) is required');
    if (!fingerprint) throw new Error('fingerprint (k tag) is required');

    const expiry = Math.floor(Date.now() / 1000) + (expiryDays * 24 * 60 * 60);
    const event = {
      kind: KINDS.SERVICE_RECORD,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', serviceId],
        ['u', endpoint],
        ['k', fingerprint],
        ['exp', expiry.toString()]
      ],
      content: `NCC-02 Service Record for ${serviceId}`,
      pubkey: this.pk
    };
    return finalizeEvent(event, this.sk);
  }

  /**
   * Creates a signed Certificate Attestation (Kind 30060).
   * @param {string} subjectPubkey
   * @param {string} serviceId
   * @param {string} serviceEventId
   * @param {string} [level='verified']
   * @param {number} [validDays=30]
   */
  createAttestation(subjectPubkey, serviceId, serviceEventId, level = 'verified', validDays = 30) {
    if (!subjectPubkey) throw new Error('subjectPubkey is required');
    if (!serviceId) throw new Error('serviceId is required');
    if (!serviceEventId) throw new Error('serviceEventId (e tag) is required');

    const now = Math.floor(Date.now() / 1000);
    const expiry = now + (validDays * 24 * 60 * 60);
    const event = {
      kind: KINDS.ATTESTATION,
      created_at: now,
      tags: [
        ['subj', subjectPubkey],
        ['srv', serviceId],
        ['e', serviceEventId],
        ['std', 'nostr-service-trust-v0.1'],
        ['lvl', level],
        ['nbf', now.toString()],
        ['exp', expiry.toString()]
      ],
      content: 'NCC-02 Attestation',
      pubkey: this.pk
    };
    return finalizeEvent(event, this.sk);
  }

  /**
   * Creates a signed Revocation (Kind 30061).
   * @param {string} attestationId
   * @param {string} [reason='']
   */
  createRevocation(attestationId, reason = '') {
    if (!attestationId) throw new Error('attestationId (e tag) is required');

    const tags = [['e', attestationId]];
    if (reason) tags.push(['reason', reason]);
    
    const event = {
      kind: KINDS.REVOCATION,
      created_at: Math.floor(Date.now() / 1000),
      tags: tags,
      content: 'NCC-02 Revocation',
      pubkey: this.pk
    };
    return finalizeEvent(event, this.sk);
  }
}

/**
 * Verifies a Nostr event signature.
 * @param {any} event
 */
export function verifyNCC02Event(event) {
  return verifyEvent(event);
}