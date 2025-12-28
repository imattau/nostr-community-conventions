import { SimplePool, verifyEvent } from 'nostr-tools';
import { KINDS } from './models.js';

/**
 * Custom error class for NCC-02 specific failures.
 */
export class NCC02Error extends Error {
  /**
   * @param {string} code 
   * @param {string} message 
   * @param {any} [cause]
   */
  constructor(code, message, cause) {
    super(message);
    this.code = code;
    if (cause) this.cause = cause;
  }
}

/**
 * @typedef {Object} ResolvedService
 * @property {string|undefined} endpoint
 * @property {string|undefined} fingerprint
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
   * @param {string[]} relays - List of relay URLs.
   * @param {Object} [options={}]
   * @param {SimplePool} [options.pool] - Shared SimplePool instance.
   * @param {string[]} [options.trustedCAPubkeys=[]] - List of trusted CA pubkeys (hex or npub).
   * These are the ONLY pubkeys whose attestation signatures (Kind 30060) will be accepted
   * by the resolver. This allows you to define your own web of trust or rely on specific
   * community auditors. If empty, all attestations are ignored (effectively disabling attestation checks).
   */
  constructor(relays, options = {}) {
    if (!Array.isArray(relays)) {
      throw new Error('NCC02Resolver expects an array of relay URLs.');
    }
    this.relays = relays;
    this.pool = options.pool || new SimplePool();
    this.ownsPool = !options.pool;
    this.trustedCAPubkeys = new Set(options.trustedCAPubkeys || []);
  }

  /**
   * Closes the connection to the relays if the pool is owned by this resolver.
   */
  close() {
    if (this.ownsPool && this.pool) {
      this.pool.close(this.relays);
    }
  }

  /**
   * Internal query helper using SimplePool.subscribeMany (since list() is deprecated).
   * @param {import('nostr-tools').Filter} filter 
   * @returns {Promise<import('nostr-tools').Event[]>}
   */
  async _query(filter) {
    return new Promise((resolve) => {
      /** @type {import('nostr-tools').Event[]} */
      const events = [];
      // subscribeMany(relays, filters, callbacks)
      // @ts-ignore - subscribeMany filters parameter type mismatch with simple Object
      const sub = this.pool.subscribeMany(this.relays, [filter], {
        onevent(e) { events.push(e); },
        oneose() { sub.close(); resolve(events); }
      });
    });
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

    let serviceEvents;
    try {
      serviceEvents = await this._query({
        kinds: [KINDS.SERVICE_RECORD],
        authors: [pubkey],
        '#d': [serviceId]
      });
    } catch (err) {
      throw new NCC02Error('RELAY_ERROR', `Failed to query relay for ${serviceId}`, err);
    }

    if (!serviceEvents || !serviceEvents.length) {
      throw new NCC02Error('NOT_FOUND', `No service record found for ${serviceId}`);
    }

    // Stable tie-breaking: Sort by created_at DESC, then ID ASC
    const serviceEvent = serviceEvents.sort((/** @type {any} */ a, /** @type {any} */ b) => {
      if (b.created_at !== a.created_at) return b.created_at - a.created_at;
      return a.id.localeCompare(b.id);
    })[0];

    if (!verifyEvent(serviceEvent)) {
      throw new NCC02Error('INVALID_SIGNATURE', 'Service record signature verification failed');
    }

    const serviceTags = Object.fromEntries(serviceEvent.tags);
    const now = Math.floor(Date.now() / 1000);

    // Security Fix: exp is REQUIRED by NCC-02 spec
    if (!serviceTags.exp) {
      throw new NCC02Error('MALFORMED_RECORD', 'Service record is missing required tag (exp)');
    }
    
    // 'k' is required for TLS-based endpoints
    if (serviceTags.u && (serviceTags.u.startsWith('wss://') || serviceTags.u.startsWith('https://')) && !serviceTags.k) {
      throw new NCC02Error('MALFORMED_RECORD', 'Service record with \'https\' or \'wss\' endpoint must have a \'k\' tag');
    }

    const exp = parseInt(serviceTags.exp);
    if (isNaN(exp)) {
      throw new NCC02Error('MALFORMED_RECORD', 'Service record expiry tag is not a valid number');
    }
    if (exp < now) {
      throw new NCC02Error('EXPIRED', 'Service record has expired');
    }

    const validAttestations = [];

    // Optimization: Only fetch attestations if policy requires it
    if (requireAttestation || minLevel === 'verified' || minLevel === 'hardened') {
      let attestations;
      let revocations;
      try {
        [attestations, revocations] = await Promise.all([
          this._query({ kinds: [KINDS.ATTESTATION], '#e': [serviceEvent.id] }),
          this._query({ kinds: [KINDS.REVOCATION] })
        ]);
      } catch (err) {
        throw new NCC02Error('RELAY_ERROR', 'Failed to query relay for attestations/revocations', err);
      }

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
    }

    return {
      endpoint: serviceTags.u,
      fingerprint: serviceTags.k,
      expiry: exp,
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
    // 1. Verify Attestation signature
    if (!verifyEvent(att)) return false;

    const now = Math.floor(Date.now() / 1000);
    
    // 2. NBF validation
    if (tags.nbf) {
      const nbf = parseInt(tags.nbf);
      if (isNaN(nbf) || nbf > now) return false;
    }

    // 3. EXP validation
    if (tags.exp) {
      const exp = parseInt(tags.exp);
      if (isNaN(exp) || exp < now) return false;
    }

    // 4. Revocation validation
    // A revocation is valid only if it matches the attestation ID, is from the same CA, AND has a valid signature.
    for (const rev of revocations) {
      const revTags = Object.fromEntries(rev.tags);
      if (revTags.e === att.id && rev.pubkey === att.pubkey) {
        if (verifyEvent(rev)) {
          return false; // Valid revocation found
        }
      }
    }

    return true; // No valid revocation found
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
