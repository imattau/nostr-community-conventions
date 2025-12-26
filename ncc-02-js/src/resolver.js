import { verifyEvent } from 'nostr-tools/pure';
import { KINDS } from './models.js';

/**
 * Custom error class for NCC-02 specific failures.
 */
export class NCC02Error extends Error {
  /**
   * @param {string} code 
   * @param {string} message 
   */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * @typedef {Object} ResolvedService
 * @property {string} endpoint
 * @property {string} fingerprint
 * @property {number} expiry
 * @property {any[]} attestations
 * @property {string} eventId
 * @property {string} pubkey
 */

/**
 * Resolver for NCC-02 Service Records.
 * Implements the client-side resolution and trust verification algorithm.
 */
export class NCC02Resolver {
  /**
   * @param {any} relay - A relay client providing a `query` method.
   * @param {string[]} [trustedCAPubkeys=[]] - List of CA pubkeys trusted by this client.
   */
  constructor(relay, trustedCAPubkeys = []) {
    this.relay = relay;
    this.trustedCAPubkeys = new Set(trustedCAPubkeys);
  }

  /**
   * Resolves a service for a given pubkey and service identifier.
   * 
   * @param {string} pubkey - The pubkey of the service owner.
   * @param {string} serviceId - The 'd' tag identifier of the service (e.g., 'api').
   * @param {Object} [options={}] - Policy options.
   * @param {boolean} [options.requireAttestation=false] - If true, fails if no trusted attestation is found.
   * @param {string} [options.minLevel=null] - Minimum trust level ('self', 'verified', 'hardened').
   * @param {string} [options.standard='nostr-service-trust-v0.1'] - Expected trust standard.
   * @throws {NCC02Error} If verification or policy checks fail.
   * @returns {Promise<ResolvedService>} The verified service details.
   */
  async resolve(pubkey, serviceId, options = {}) {
    const { 
      requireAttestation = false, 
      minLevel = null,
      standard = 'nostr-service-trust-v0.1'
    } = options;

    const serviceEvents = await this.relay.query({
      kinds: [KINDS.SERVICE_RECORD],
      authors: [pubkey],
      '#d': [serviceId]
    });

    if (!serviceEvents.length) {
      throw new NCC02Error('NOT_FOUND', `No service record found for ${serviceId}`);
    }

    const serviceEvent = serviceEvents.sort((/** @type {any} */ a, /** @type {any} */ b) => b.created_at - a.created_at)[0];

    if (!verifyEvent(serviceEvent)) {
      throw new NCC02Error('INVALID_SIGNATURE', 'Service record signature verification failed');
    }

    const serviceTags = Object.fromEntries(serviceEvent.tags);
    const now = Math.floor(Date.now() / 1000);

    if (serviceTags.exp && parseInt(serviceTags.exp) < now) {
      throw new NCC02Error('EXPIRED', 'Service record has expired');
    }

    const attestations = await this.relay.query({
      kinds: [KINDS.ATTESTATION],
      '#e': [serviceEvent.id]
    });

    const revocations = await this.relay.query({
      kinds: [KINDS.REVOCATION]
    });

    const validAttestations = [];
    for (const att of attestations) {
      if (this.trustedCAPubkeys.has(att.pubkey)) {
        const attTags = Object.fromEntries(att.tags);
        
        // Cross-validate subject, service ID, and standard
        if (attTags.subj !== pubkey) continue;
        if (attTags.srv !== serviceId) continue;
        if (standard && attTags.std !== standard) continue;
        
        // Trust Level Filtering
        if (minLevel && !this._isLevelSufficient(attTags.lvl, minLevel)) continue;

        if (this._isAttestationValid(att, attTags, revocations)) {
          validAttestations.push({
            pubkey: att.pubkey,
            level: attTags.lvl,
            eventId: att.id
          });
        }
      }
    }

    if (requireAttestation && validAttestations.length === 0) {
      throw new NCC02Error('POLICY_FAILURE', `No trusted attestations meet the required policy for ${serviceId}`);
    }

    return {
      endpoint: serviceTags.u,
      fingerprint: serviceTags.k,
      expiry: parseInt(serviceTags.exp),
      attestations: validAttestations,
      eventId: serviceEvent.id,
      pubkey: serviceEvent.pubkey
    };
  }

  /**
   * @param {string | undefined} actual 
   * @param {string} required 
   */
  _isLevelSufficient(actual, required) {
    /** @type {Record<string, number>} */
    const levels = { 'self': 0, 'verified': 1, 'hardened': 2 };
    const actualVal = actual ? (levels[actual] ?? -1) : -1;
    const requiredVal = levels[required] ?? 0;
    return actualVal >= requiredVal;
  }

  /**
   * @param {any} att 
   * @param {any} tags 
   * @param {any[]} revocations 
   */
  _isAttestationValid(att, tags, revocations) {
    if (!verifyEvent(att)) return false;

    const now = Math.floor(Date.now() / 1000);
    if (tags.nbf && parseInt(tags.nbf) > now) return false;
    if (tags.exp && parseInt(tags.exp) < now) return false;

    return !revocations.some(rev => {
      const revTags = Object.fromEntries(rev.tags);
      return revTags.e === att.id && rev.pubkey === att.pubkey;
    });
  }

  /**
   * Verifies that the actual fingerprint found during transport-level connection
   * matches the one declared in the signed service record.
   * 
   * @param {ResolvedService} resolved - The object returned by resolve().
   * @param {string} actualFingerprint - The fingerprint obtained from the service.
   * @returns {boolean}
   */
  verifyEndpoint(resolved, actualFingerprint) {
    return resolved.fingerprint === actualFingerprint;
  }
}