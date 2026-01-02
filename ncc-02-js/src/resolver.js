import { SimplePool, verifyEvent } from 'nostr-tools';
import { KINDS } from './models.js';
import { collectPrivateRecipients, parsePrivateFlag } from './privacy.js';

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
 * @typedef {Object} ServiceStatus
 * @property {string|undefined} endpoint
 * @property {string|undefined} fingerprint
 * @property {number} expiry
 * @property {boolean} isRevoked
 * @property {number} attestationCount
 * @property {Array<{eventId:string, level:string, pubkey:string}>} attestations
 * @property {string} eventId
 * @property {string} pubkey
 * @property {any} serviceEvent
 * @property {boolean} isPrivate
 * @property {string[]} privateRecipients
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
   * Returns the first event sorted by freshness (newest created_at, tie broken by id).
   * @param {import('nostr-tools').Event[]} events
   * @returns {import('nostr-tools').Event|null}
   */
  _freshestEvent(events) {
    if (!events || !events.length) return null;
    return events.sort((a, b) => {
      if (b.created_at !== a.created_at) return b.created_at - a.created_at;
      return a.id.localeCompare(b.id);
    })[0];
  }

  /**
   * Query helper that returns only the freshest event matching the filter.
   * @param {import('nostr-tools').Filter} filter
   * @returns {Promise<import('nostr-tools').Event | null>}
   */
  async _queryFreshest(filter) {
    const events = await this._query(filter);
    return this._freshestEvent(events);
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
  * @returns {Promise<ServiceStatus>} The service status including trust metadata.
   */
  async resolve(pubkey, serviceId, options = {}) {
    const { 
      requireAttestation = false, 
      minLevel = null,
      standard = 'nostr-service-trust-v0.1'
    } = options;

    let serviceEvent;
    try {
      serviceEvent = await this._queryFreshest({
        kinds: [KINDS.SERVICE_RECORD],
        authors: [pubkey],
        '#d': [serviceId]
      });
    } catch (err) {
      throw new NCC02Error('RELAY_ERROR', `Failed to query relay for ${serviceId}`, err);
    }

    if (!serviceEvent) {
      throw new NCC02Error('NOT_FOUND', `No service record found for ${serviceId}`);
    }

    if (!verifyEvent(serviceEvent)) {
      throw new NCC02Error('INVALID_SIGNATURE', 'Service record signature verification failed');
    }

    const serviceTags = Object.fromEntries(serviceEvent.tags);
    const now = Math.floor(Date.now() / 1000);
    const privateFlag = parsePrivateFlag(serviceEvent.tags);
    if (privateFlag === null) {
      throw new NCC02Error('MALFORMED_RECORD', 'Service record is missing required tag (private)');
    }

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

    let trustData;
    try {
      trustData = await this._buildTrustData(serviceEvent, { pubkey, serviceId, standard, minLevel });
    } catch (err) {
      throw new NCC02Error('RELAY_ERROR', 'Failed to query relay for attestations/revocations', err);
    }

    if (requireAttestation && trustData.validAttestations.length === 0) {
      throw new NCC02Error('POLICY_FAILURE', `No trusted attestations meet the required policy for ${serviceId}`);
    }

    return {
      endpoint: serviceTags.u,
      fingerprint: serviceTags.k,
      expiry: exp,
      attestations: trustData.validAttestations,
      attestationCount: trustData.validAttestations.length,
      isRevoked: trustData.isRevoked,
      isPrivate: privateFlag,
      privateRecipients: collectPrivateRecipients(serviceEvent.tags),
      eventId: serviceEvent.id,
      pubkey: serviceEvent.pubkey,
      serviceEvent
    };
  }

  /**
   * @param {any} serviceEvent
   * @param {Object} options
   * @param {string} options.pubkey
   * @param {string} options.serviceId
   * @param {string|null} options.standard
   * @param {string|null} options.minLevel
   */
  async _buildTrustData(serviceEvent, options) {
    const attestations = await this._query({
      kinds: [KINDS.ATTESTATION],
      '#e': [serviceEvent.id]
    });

    const attestationIds = attestations.map(att => att.id);
    /** @type {any[]} */
    let revocations = [];
    if (attestationIds.length) {
      revocations = await this._query({
        kinds: [KINDS.REVOCATION],
        '#e': attestationIds
      });
    }

    /** @type {Record<string, any[]>} */
    const revocationIndex = this._groupValidRevocations(revocations);
    const validAttestations = [];
    let isRevoked = false;

    for (const att of attestations) {
      if (!this.trustedCAPubkeys.has(att.pubkey)) continue;
      const attTags = Object.fromEntries(att.tags);
      if (attTags.subj !== options.pubkey) continue;
      if (attTags.srv !== options.serviceId) continue;
      if (options.standard && attTags.std !== options.standard) continue;

      const { valid, revoked } = this._evaluateAttestation(att, attTags, revocationIndex[att.id]);
      if (revoked) {
        isRevoked = true;
        continue;
      }
      if (!valid) continue;

      if (options.minLevel && !this._isLevelSufficient(attTags.lvl, options.minLevel)) continue;

      validAttestations.push({
        pubkey: att.pubkey,
        level: attTags.lvl,
        eventId: att.id
      });
    }

    return { validAttestations, isRevoked };
  }

  /**
   * @param {any[]} revocations
   * @returns {Record<string, any[]>}
   */
  /**
   * @param {any[]} revocations
   * @returns {Record<string, any[]>}
   */
  _groupValidRevocations(revocations) {
    /** @type {Record<string, any[]>} */
    const indexed = {};
    for (const rev of revocations) {
      if (!verifyEvent(rev)) continue;
      const tags = Object.fromEntries(rev.tags);
      const targetId = tags.e;
      if (!targetId) continue;
      if (!indexed[targetId]) indexed[targetId] = [];
      indexed[targetId].push(rev);
    }
    return indexed;
  }

  /**
   * @param {any} att
   * @param {Record<string, string>} tags
   * @param {any[]} revocations
   */
  /**
   * @param {any} att
   * @param {Record<string, string>} tags
   * @param {any[]} [revocations]
   */
  _evaluateAttestation(att, tags, revocations = []) {
    for (const rev of revocations) {
      if (rev.pubkey === att.pubkey) {
        return { valid: false, revoked: true };
      }
    }

    if (!verifyEvent(att)) return { valid: false, revoked: false };

    const now = Math.floor(Date.now() / 1000);

    if (tags.nbf) {
      const nbf = parseInt(tags.nbf, 10);
      if (isNaN(nbf) || nbf > now) return { valid: false, revoked: false };
    }

    if (tags.exp) {
      const exp = parseInt(tags.exp, 10);
      if (isNaN(exp) || exp < now) return { valid: false, revoked: false };
    }

    return { valid: true, revoked: false };
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
   * Verifies that the actual fingerprint found during transport-level connection
   * matches the one declared in the signed service record.
   * 
   * @param {ServiceStatus} resolved - The object returned by resolve().
   * @param {string} actualFingerprint - The fingerprint obtained from the service.
   * @returns {boolean}
   */
  verifyEndpoint(resolved, actualFingerprint) {
    return resolved.fingerprint === actualFingerprint;
  }
}
