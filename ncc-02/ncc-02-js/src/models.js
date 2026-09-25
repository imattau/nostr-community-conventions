import { finalizeEvent, verifyEvent, getPublicKey } from 'nostr-tools/pure';
import { hexToBytes } from 'nostr-tools/utils';

/**
 * @typedef {Object} NostrSigner
 * @property {() => Promise<string>} getPublicKey
 * @property {(event: any) => Promise<any>} signEvent
 * @property {(event: any) => Promise<any>} [decryptEvent]
 */

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
   * @param {string | Uint8Array | NostrSigner} signer - Raw private key or asynchronous signer.
   */
  constructor(signer) {
    if (!signer) throw new Error('Signer or private key is required');
    this.signer = this._normalizeSigner(signer);
    this._pubkeyPromise = this.signer.getPublicKey();
    this._pubkey = undefined;
  }

  async _getPublicKey() {
    if (!this._pubkey) {
      this._pubkey = await this._pubkeyPromise;
    }
    return this._pubkey;
  }

  /**
   * @param {any} event
   */
  async _finalizeEvent(event) {
    const pubkey = await this._getPublicKey();
    const eventWithPubkey = { ...event, pubkey };
    const signed = await this.signer.signEvent(eventWithPubkey);
    if (!signed || typeof signed.id !== 'string' || typeof signed.sig !== 'string') {
      throw new Error('Signer must return a signed event with id and sig');
    }
    return signed;
  }

  /**
   * @param {any} signer
   * @returns {NostrSigner}
   */
  _normalizeSigner(signer) {
    if (typeof signer === 'string' || signer instanceof Uint8Array) {
      const privateKey = typeof signer === 'string' ? hexToBytes(signer) : signer;
      const pubkey = getPublicKey(privateKey);
      return {
        getPublicKey: async () => pubkey,
        /** @param {any} event */
        signEvent: async (event) => {
          const clonedEvent = {
            ...event,
            tags: Array.isArray(event.tags) ? event.tags.map((/** @type {any[]} */ tag) => [...tag]) : []
          };
          return finalizeEvent(clonedEvent, privateKey);
        }
      };
    }

    if (typeof signer === 'object' && signer !== null) {
      if (typeof signer.getPublicKey === 'function' && typeof signer.signEvent === 'function') {
        return {
          getPublicKey: async () => {
            const pubkey = await signer.getPublicKey();
            if (typeof pubkey !== 'string') throw new Error('Signer.getPublicKey must return a hex string');
            return pubkey;
          },
          /** @param {any} event */
          signEvent: async (event) => {
            const signed = await signer.signEvent(event);
            if (!signed || typeof signed.id !== 'string' || typeof signed.sig !== 'string') {
              throw new Error('Signer.signEvent must return a signed event');
            }
            return signed;
          },
          decryptEvent: typeof signer.decryptEvent === 'function' ? signer.decryptEvent.bind(signer) : undefined
        };
      }
    }

    throw new Error('Unsupported signer provided to NCC02Builder');
  }

  /**
   * Creates a signed Service Record (Kind 30059).
   * @param {Object} options
   * @param {string} options.serviceId - The 'd' tag identifier.
   * @param {string} [options.endpoint] - The 'u' tag URI.
   * @param {string} [options.fingerprint] - The 'k' tag fingerprint.
   * @param {number} [options.expiryDays=14] - Expiry in days.
   * @param {boolean} [options.isPrivate=false] - Whether the service is private (adds required `private` tag).
   * @param {string[]} [options.privateRecipients] - Optional encrypted ciphertexts for authorized recipients.
   */
  async createServiceRecord(options) {
    const { serviceId, endpoint, fingerprint, expiryDays = 14, isPrivate = false, privateRecipients } = options;
    if (!serviceId) throw new Error('serviceId (d tag) is required');
    if (typeof isPrivate !== 'boolean') throw new Error('isPrivate must be a boolean value');

    const expiry = Math.floor(Date.now() / 1000) + (expiryDays * 24 * 60 * 60);
    const tags = [
      ['d', serviceId],
      ['exp', expiry.toString()]
    ];
    tags.push(['private', isPrivate ? 'true' : 'false']);
    if (endpoint) tags.push(['u', endpoint]);
    if (fingerprint) tags.push(['k', fingerprint]);
    if (privateRecipients) {
      if (!Array.isArray(privateRecipients)) throw new Error('privateRecipients must be an array');
      privateRecipients.forEach((cipher) => {
        if (typeof cipher !== 'string') throw new Error('privateRecipients entries must be strings');
        tags.push(['privateRecipients', cipher]);
      });
    }

    const event = {
      kind: KINDS.SERVICE_RECORD,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: `NCC-02 Service Record for ${serviceId}`
    };
    return this._finalizeEvent(event);
  }

  /**
   * Creates a signed Certificate Attestation (Kind 30060).
   * @param {Object} options
   * @param {string} options.subjectPubkey - The 'subj' tag pubkey.
   * @param {string} options.serviceId - The 'srv' tag identifier.
   * @param {string} options.serviceEventId - The 'e' tag referencing the Service Record.
   * @param {string} [options.level='verified'] - The 'lvl' tag level.
   * @param {number} [options.validDays=30] - Validity in days.
   */
  async createAttestation(options) {
    const { subjectPubkey, serviceId, serviceEventId, level = 'verified', validDays = 30 } = options;
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
      content: 'NCC-02 Attestation'
    };
    return this._finalizeEvent(event);
  }

  /**
   * Creates a signed Revocation (Kind 30061).
   * @param {Object} options
   * @param {string} options.attestationId - The 'e' tag referencing the attestation.
   * @param {string} [options.reason=''] - Optional reason.
   */
  async createRevocation(options) {
    const { attestationId, reason = '' } = options;
    if (!attestationId) throw new Error('attestationId (e tag) is required');

    const tags = [['e', attestationId]];
    if (reason) tags.push(['reason', reason]);
    
    const event = {
      kind: KINDS.REVOCATION,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: 'NCC-02 Revocation'
    };
    return this._finalizeEvent(event);
  }
}

/**
 * Verifies a Nostr event signature.
 * @param {any} event
 */
export function verifyNCC02Event(event) {
  return verifyEvent(event);
}

/**
 * Checks whether an NCC event has expired based on its 'exp' tag.
 * @param {any} event
 * @returns {boolean}
 */
export function isExpired(event) {
  if (!event || !Array.isArray(event.tags)) return false;
  const expTag = event.tags.find((/** @type {any[]} */ tag) => tag[0] === 'exp');
  if (!expTag) return false;
  const expiry = parseInt(expTag[1], 10);
  if (Number.isNaN(expiry)) return false;
  return expiry <= Math.floor(Date.now() / 1000);
}
