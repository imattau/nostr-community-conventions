import { finalizeEvent, verifyEvent, getPublicKey } from 'nostr-tools/pure';

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
   * @param {Uint8Array} privateKey - The private key to sign events with.
   */
  constructor(privateKey) {
    this.sk = privateKey;
    this.pk = getPublicKey(privateKey);
  }

  /**
   * Creates a signed Service Record (Kind 30059).
   */
  createServiceRecord(serviceId, endpoint, fingerprint, expiryDays = 14) {
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
   */
  createAttestation(subjectPubkey, serviceId, serviceEventId, level = 'verified', validDays = 30) {
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
   */
  createRevocation(attestationId, reason = '') {
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
 */
export function verifyNCC02Event(event) {
  return verifyEvent(event);
}