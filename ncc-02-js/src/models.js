import { finalizeEvent, verifyEvent, getPublicKey } from 'nostr-tools/pure';

export const KINDS = {
  SERVICE_RECORD: 30059,
  ATTESTATION: 30060,
  REVOCATION: 30061
};

export class NCC02Builder {
  constructor(privateKey) {
    this.sk = privateKey;
    this.pk = getPublicKey(privateKey);
  }

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

export function verifyNCC02Event(event) {
  return verifyEvent(event);
}
