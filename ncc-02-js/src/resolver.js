import { verifyEvent } from 'nostr-tools/pure';
import { KINDS } from './models.js';

export class NCC02Resolver {
  constructor(relay, trustedCAPubkeys = []) {
    this.relay = relay; // Expected to be a mock or real relay client with a query method
    this.trustedCAPubkeys = new Set(trustedCAPubkeys);
  }

  async resolve(pubkey, serviceId, options = {}) {
    const { requireAttestation = false } = options;

    // 1. Query for Service Record
    const serviceEvents = await this.relay.query({
      kinds: [KINDS.SERVICE_RECORD],
      authors: [pubkey],
      '#d': [serviceId]
    });

    if (!serviceEvents.length) return null;

    // Sort by created_at descending (latest first)
    const serviceEvent = serviceEvents.sort((a, b) => b.created_at - a.created_at)[0];

    // 2. Verify signature and expiry
    if (!verifyEvent(serviceEvent)) return null;

    const tags = Object.fromEntries(serviceEvent.tags);
    const now = Math.floor(Date.now() / 1000);

    if (tags.exp && parseInt(tags.exp) < now) {
      return null;
    }

    // 3. Fetch Certificate Attestations
    const attestations = await this.relay.query({
      kinds: [KINDS.ATTESTATION],
      '#e': [serviceEvent.id]
    });

    // 4. Filter and Verify Attestations
    const validAttestations = [];
    const revocations = await this.relay.query({
      kinds: [KINDS.REVOCATION]
    });

    for (const att of attestations) {
      if (this.trustedCAPubkeys.has(att.pubkey)) {
        const attTags = Object.fromEntries(att.tags);
        if (this._isAttestationValid(att, attTags, revocations)) {
          validAttestations.push({
            pubkey: att.pubkey,
            level: attTags.lvl,
            eventId: att.id
          });
        }
      }
    }

    // 5. Apply local policy
    if (requireAttestation && validAttestations.length === 0) {
      return null;
    }

    return {
      endpoint: tags.u,
      fingerprint: tags.k,
      expiry: parseInt(tags.exp),
      attestations: validAttestations,
      eventId: serviceEvent.id,
      pubkey: serviceEvent.pubkey
    };
  }

  _isAttestationValid(att, tags, revocations) {
    if (!verifyEvent(att)) return false;

    const now = Math.floor(Date.now() / 1000);
    if (tags.nbf && parseInt(tags.nbf) > now) return false;
    if (tags.exp && parseInt(tags.exp) < now) return false;

    // Check for revocations by the same CA
    const isRevoked = revocations.some(rev => {
      const revTags = Object.fromEntries(rev.tags);
      return revTags.e === att.id && rev.pubkey === att.pubkey;
    });

    return !isRevoked;
  }

  verifyEndpoint(resolved, actualFingerprint) {
    return resolved.fingerprint === actualFingerprint;
  }
}
