/**
 * NCC-05: Identity-Bound Service Locator Resolution
 * 
 * This library implements the NCC-05 convention for publishing and resolving
 * dynamic service endpoints (IP, Port, Onion) bound to Nostr identities.
 * 
 * @module ncc-05-js
 */

import { 
    SimplePool, 
    nip44, 
    nip19,
    finalizeEvent, 
    verifyEvent, 
    Event, 
    UnsignedEvent,
    getPublicKey,
    generateSecretKey
} from 'nostr-tools';

export const TAG_PRIVATE = 'private';

export function isPrivateLocator(event: Event): boolean {
    return event.tags.some(t => t[0] === TAG_PRIVATE && t[1] === 'true');
}

export interface NostrSigner {
    getPublicKey(): Promise<string>;
    signEvent(event: UnsignedEvent): Promise<Event>;
    getConversationKey(peerPubkey: string): Promise<Uint8Array>;
}

export type SignerInput = string | Uint8Array | NostrSigner;

// --- Error Classes ---

export class NCC05Error extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'NCC05Error';
    }
}

export class NCC05RelayError extends NCC05Error {
    constructor(message: string) {
        super(message);
        this.name = 'NCC05RelayError';
    }
}

export class NCC05TimeoutError extends NCC05Error {
    constructor(message: string) {
        super(message);
        this.name = 'NCC05TimeoutError';
    }
}

export class NCC05DecryptionError extends NCC05Error {
    constructor(message: string) {
        super(message);
        this.name = 'NCC05DecryptionError';
    }
}

export class NCC05ArgumentError extends NCC05Error {
    constructor(message: string) {
        super(message);
        this.name = 'NCC05ArgumentError';
    }
}

// --- Helpers ---

function ensureUint8Array(key: string | Uint8Array): Uint8Array {
    if (key instanceof Uint8Array) return key;
    if (typeof key === 'string') {
        // Assume hex string
        if (key.match(/^[0-9a-fA-F]+$/)) {
             return new Uint8Array(key.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
        }
        throw new NCC05ArgumentError("Invalid hex key provided");
    }
    throw new NCC05ArgumentError("Key must be a hex string or Uint8Array");
}

class LocalSigner implements NostrSigner {
    private readonly pubkey: string;

    constructor(private readonly secretKey: Uint8Array) {
        this.pubkey = getPublicKey(secretKey);
    }

    async getPublicKey(): Promise<string> {
        return this.pubkey;
    }

    async signEvent(event: UnsignedEvent): Promise<Event> {
        const template: UnsignedEvent = { ...event, pubkey: this.pubkey };
        return finalizeEvent(template, this.secretKey);
    }

    async getConversationKey(peerPubkey: string): Promise<Uint8Array> {
        return nip44.getConversationKey(this.secretKey, peerPubkey);
    }
}

function toSigner(input?: SignerInput): NostrSigner | undefined {
    if (!input) return undefined;
    if (typeof input === 'string' || input instanceof Uint8Array) {
        const sk = ensureUint8Array(input);
        return new LocalSigner(sk);
    }
    return input;
}

/**
 * Represents a single reachable service endpoint.
 */
export interface NCC05Endpoint {
    /** Protocol type, e.g., 'tcp', 'udp', 'http' */
    type: 'tcp' | 'udp' | string;
    /** The full endpoint URL, e.g., 'tcp://1.2.3.4:8080' or 'http://[2001:db8::1]:9000' */
    url: string;
    /** Priority for selection (lower is higher priority, default: 1000) */
    priority?: number;
    /** Network family for routing hints: 'onion', 'ipv6', 'ipv4' */
    family?: 'ipv4' | 'ipv6' | 'onion' | string;
    /** Transport key fingerprint for TLS/Noise protected endpoints */
    k?: string;
}

/**
 * Deterministically sorts endpoints according to NCC-05 normative rules.
 * 1. Priority (ascending)
 * 2. Family (onion < ipv6 < ipv4)
 * 3. Original order
 */
export function selectEndpoints(endpoints: NCC05Endpoint[]): NCC05Endpoint[] {
    const familyScore = (f?: string) => {
        if (!f) return 4;
        if (f === 'onion') return 1;
        if (f === 'ipv6') return 2;
        if (f === 'ipv4') return 3;
        return 5;
    };

    return [...endpoints].sort((a, b) => {
        const pA = a.priority ?? 1000;
        const pB = b.priority ?? 1000;
        if (pA !== pB) return pA - pB;
        
        return familyScore(a.family) - familyScore(b.family);
    });
}

/**
 * The logical structure of an NCC-05 locator record payload.
 */
export interface NCC05Payload {
    /** Payload version (currently 1) */
    v: number;
    /** Time-to-live in seconds */
    ttl: number;
    /** Unix timestamp of the last update */
    updated_at: number;
    /** List of available endpoints */
    endpoints: NCC05Endpoint[];
    /** Optional capability identifiers supported by the service */
    caps?: string[];
    /** Optional human-readable notes */
    notes?: string;
}

/**
 * Options for configuring the NCC05Resolver.
 */
export interface ResolverOptions {
    /** List of relays used to bootstrap discovery */
    bootstrapRelays?: string[];
    /** Timeout for relay queries in milliseconds (default: 10000) */
    timeout?: number;
    /** Existing SimplePool instance to share connections */
    pool?: SimplePool;
    /** Optional global endpoint transformer for transport-aware resolution */
    urlTransformer?: (endpoint: NCC05Endpoint) => NCC05Endpoint;
}

interface PayloadRecord {
    event: Event;
    payload: NCC05Payload;
    expiry: number;
    freshness: number;
}

/**
 * Options for configuring the NCC05Publisher.
 */
export interface PublisherOptions {
    /** Existing SimplePool instance */
    pool?: SimplePool;
    /** Timeout for publishing in milliseconds (default: 5000) */
    timeout?: number;
}

/**
 * Structure for multi-recipient encrypted events.
 * Implements a "wrapping" pattern to share one event with multiple keys.
 */
export interface WrappedContent {
    /** The NCC05Payload encrypted with a random symmetric session key */
    ciphertext: string;
    /** Map of recipient pubkey (hex) to the encrypted session key */
    wraps: Record<string, string>;
}

/**
 * Utility for managing shared group access to service records.
 */
export class NCC05Group {
    /**
     * Generates a fresh identity (keypair) for a shared group.
     * The resulting nsec should be shared with all authorized group members.
     * 
     * @returns An object containing nsec, hex pubkey, and the raw secret key.
     */
    static createGroupIdentity() {
        const sk = generateSecretKey();
        const pk = getPublicKey(sk);
        return {
            nsec: nip19.nsecEncode(sk),
            sk: sk,
            pk: pk,
            npub: nip19.npubEncode(pk)
        };
    }

    /**
     * Helper to resolve a record using a group's shared identity.
     * 
     * @param resolver - An initialized NCC05Resolver instance.
     * @param groupPubkey - The public key of the group.
     * @param groupSecretKey - The shared secret key of the group.
     * @param identifier - The 'd' tag of the record (default: 'addr').
     * @returns The resolved NCC05Payload or null.
     */
    static async resolveAsGroup(
        resolver: NCC05Resolver,
        groupPubkey: string,
        groupSecretKey: SignerInput,
        identifier: string = 'addr'
    ): Promise<NCC05Payload | null> {
        return resolver.resolve(groupPubkey, groupSecretKey, identifier);
    }
}

/**
 * Handles the discovery, selection, and decryption of NCC-05 locator records.
 */
export class NCC05Resolver {
    private pool: SimplePool;
    private _ownPool: boolean;
    private bootstrapRelays: string[];
    private timeout: number;
    private urlTransformer?: (endpoint: NCC05Endpoint) => NCC05Endpoint;
    private cache: Map<string, { payload: NCC05Payload, expires: number }> = new Map();

    /**
     * @param options - Configuration for the resolver.
     */
    constructor(options: ResolverOptions = {}) {
        this._ownPool = !options.pool;
        this.pool = options.pool || new SimplePool();
        this.bootstrapRelays = options.bootstrapRelays || ['wss://relay.damus.io', 'wss://npub1...'];
        this.timeout = options.timeout || 10000;
        this.urlTransformer = options.urlTransformer;
    }

    private applyUrlTransformer(payload: NCC05Payload): NCC05Payload {
        if (!this.urlTransformer) return payload;
        return {
            ...payload,
            endpoints: payload.endpoints.map(endpoint => this.urlTransformer!(endpoint))
        };
    }

    private async decryptEventContent(event: Event, hexPubkey: string, signer?: NostrSigner): Promise<string | null> {
        let content = event.content;
        const isWrapped = content.includes('"wraps"') && 
                          content.includes('"ciphertext"') && 
                          content.startsWith('{');

        if (isWrapped) {
            if (!signer) return null;

            try {
                const wrapped = JSON.parse(content) as WrappedContent;
                const myPk = await signer.getPublicKey();
                const myWrap = wrapped.wraps[myPk];

                if (!myWrap) return null;

                const conversationKey = await signer.getConversationKey(hexPubkey);
                const symmetricKeyHex = nip44.decrypt(myWrap, conversationKey);

                const symmetricKey = new Uint8Array(
                    symmetricKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
                );

                const sessionConversationKey = nip44.getConversationKey(
                    symmetricKey, getPublicKey(symmetricKey)
                );

                content = nip44.decrypt(wrapped.ciphertext, sessionConversationKey);
            } catch (_e) {
                throw new NCC05DecryptionError("Failed to decrypt wrapped content");
            }
        } else if (signer && !content.startsWith('{')) {
            try {
                const conversationKey = await signer.getConversationKey(hexPubkey);
                content = nip44.decrypt(content, conversationKey);
            } catch (_e) {
                throw new NCC05DecryptionError("Failed to decrypt content");
            }
        }

        return content;
    }

    private async buildPayloadRecord(event: Event, hexPubkey: string, signer?: NostrSigner): Promise<PayloadRecord | null> {
        const content = await this.decryptEventContent(event, hexPubkey, signer);
        if (!content) return null;

        let payload: NCC05Payload;
        try {
            payload = JSON.parse(content) as NCC05Payload;
        } catch (_e) {
            return null;
        }

        if (!payload || !Array.isArray(payload.endpoints)) {
            return null;
        }

        if (typeof payload.updated_at !== 'number' || typeof payload.ttl !== 'number') {
            return null;
        }

        const expirationTag = event.tags.find(t => t[0] === 'expiration');
        const explicitExpiry = expirationTag ? parseInt(expirationTag[1], 10) : Infinity;
        const normalizedExpiry = Number.isFinite(explicitExpiry) ? explicitExpiry : Infinity;
        const calculatedExpiry = payload.updated_at + payload.ttl;
        const expiry = Math.min(normalizedExpiry, calculatedExpiry);

        const freshness = payload.updated_at || event.created_at;

        return {
            event,
            payload,
            expiry,
            freshness
        };
    }

    private async discoverRelays(hexPubkey: string, gossip?: boolean): Promise<string[]> {
        let queryRelays = [...this.bootstrapRelays];
        if (!gossip) return queryRelays;

        try {
            const relayListEvent = await this.pool.get(this.bootstrapRelays, {
                authors: [hexPubkey],
                kinds: [10002]
            });

            if (relayListEvent && verifyEvent(relayListEvent) && relayListEvent.pubkey === hexPubkey) {
                const discoveredRelays = relayListEvent.tags
                    .filter(t => t[0] === 'r')
                    .map(t => t[1]);

                if (discoveredRelays.length > 0) {
                    queryRelays = [...new Set([...queryRelays, ...discoveredRelays])];
                }
            }
        } catch (e: any) {
            console.warn(`[NCC-05] Gossip discovery failed: ${e.message}`);
        }

        return queryRelays;
    }

    private async fetchFreshestRecord(
        hexPubkey: string,
        signer?: NostrSigner,
        gossip?: boolean
    ): Promise<PayloadRecord | null> {
        const queryRelays = await this.discoverRelays(hexPubkey, gossip);
        const filter = {
            authors: [hexPubkey],
            kinds: [30058],
            limit: 50
        };

        try {
            const queryPromise = this.pool.querySync(queryRelays, filter);
            const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new NCC05TimeoutError("Resolution timed out")), this.timeout)
            );

            const result = await Promise.race([queryPromise, timeoutPromise]);
            if (!result || (Array.isArray(result) && result.length === 0)) return null;

            const validEvents = (result as Event[])
                .filter(e => e.pubkey === hexPubkey && verifyEvent(e))
                .sort((a, b) => {
                    if (b.created_at !== a.created_at) return b.created_at - a.created_at;
                    return a.id.localeCompare(b.id);
                });

            if (validEvents.length === 0) return null;

            return this.buildPayloadRecord(validEvents[0], hexPubkey, signer);
        } catch (e) {
            if (e instanceof NCC05Error) throw e;
            throw new NCC05RelayError(`Relay query failed: ${(e as Error).message}`);
        }
    }

    /**
     * Resolves a locator record for a given identity.
     * 
     * Supports standard NIP-44 encryption, multi-recipient "wrapping", 
     * and plaintext public records.
     * 
     * @param targetPubkey - The pubkey (hex or npub) of the service owner.
     * @param secretKey - Your secret key (required if the record is encrypted).
     * @param identifier - The 'd' tag of the record (default: 'addr').
     * @param options - Resolution options (strict mode, gossip discovery).
     * @returns The resolved and validated NCC05Payload, or null if not found.
     * @throws {NCC05TimeoutError} if resolution times out.
     * @throws {NCC05RelayError} if underlying relay communication fails.
     */
    async resolve(
        targetPubkey: string, 
        signerInput?: SignerInput, 
        identifier: string = 'addr',
        options: { strict?: boolean, gossip?: boolean } = {}
    ): Promise<NCC05Payload | null> {
        let hexPubkey = targetPubkey;
        if (targetPubkey.startsWith('npub1')) {
            const decoded = nip19.decode(targetPubkey);
            hexPubkey = decoded.data as string;
        }

        const now = Math.floor(Date.now() / 1000);
        const cacheKey = `${hexPubkey}:${identifier}`;
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expires > now) {
            return cached.payload;
        }
        if (cached) this.cache.delete(cacheKey);

        const signer = signerInput ? toSigner(signerInput) : undefined;
        const record = await this.fetchFreshestRecord(hexPubkey, signer, options.gossip);
        if (!record) return null;

        const tagIdentifier = record.event.tags.find(t => t[0] === 'd')?.[1];
        if (tagIdentifier !== identifier) return null;

        const transformedPayload = this.applyUrlTransformer(record.payload);
        if (now > record.expiry) {
            if (options.strict) return null;
            console.warn('NCC-05 record expired');
            return transformedPayload;
        }

        this.cache.set(cacheKey, { payload: transformedPayload, expires: record.expiry });
        return transformedPayload;
    }

    /**
     * Resolves the most recent locator record for an identity regardless of d-tag.
     *
     * @param targetPubkey - The pubkey (hex or npub) of the service owner.
     * @param secretKey - Your secret key (required if the record is encrypted).
     * @param options - Resolution options (strict mode, gossip discovery).
     */
    async resolveLatest(
        targetPubkey: string,
        signerInput?: SignerInput,
        options: { strict?: boolean, gossip?: boolean } = {}
    ): Promise<NCC05Payload | null> {
        let hexPubkey = targetPubkey;
        if (targetPubkey.startsWith('npub1')) {
            const decoded = nip19.decode(targetPubkey);
            hexPubkey = decoded.data as string;
        }

        const now = Math.floor(Date.now() / 1000);
        const cacheKey = `${hexPubkey}:latest`;
        const cached = this.cache.get(cacheKey);
        if (cached && cached.expires > now) {
            return cached.payload;
        }
        if (cached) {
            this.cache.delete(cacheKey);
        }

        const signer = signerInput ? toSigner(signerInput) : undefined;
        const record = await this.fetchFreshestRecord(hexPubkey, signer, options.gossip);
        if (!record) return null;

        const transformedPayload = this.applyUrlTransformer(record.payload);
        if (now > record.expiry) {
            if (options.strict) return null;
            console.warn('NCC-05 record expired');
            return transformedPayload;
        }

        this.cache.set(cacheKey, { payload: transformedPayload, expires: record.expiry });
        return transformedPayload;
    }

    /**
     * Closes connections to all relays in the pool if managed internally.
     */
    close() {
        if (this._ownPool) {
            this.pool.close(this.bootstrapRelays);
        }
    }
}

/**
 * Handles the construction, encryption, and publication of NCC-05 events.
 */
export class NCC05Publisher {
    private pool: SimplePool;
    private _ownPool: boolean;
    private timeout: number;

    /**
     * @param options - Configuration for the publisher.
     */
    constructor(options: PublisherOptions = {}) {
        this._ownPool = !options.pool;
        this.pool = options.pool || new SimplePool();
        this.timeout = options.timeout || 5000;
    }

    private async _publishToRelays(relays: string[], signedEvent: Event): Promise<void> {
        const publishPromises = this.pool.publish(relays, signedEvent);
        
        // Convert to promise that resolves/rejects based on timeout
        const wrappedPromises = publishPromises.map(p => {
             // In nostr-tools v2, publish returns Promise<void>. 
             // We wrap it to handle timeout.
             return new Promise<void>((resolve, reject) => {
                 const timer = setTimeout(() => reject(new NCC05TimeoutError("Publish timed out")), this.timeout);
                 p.then(() => {
                     clearTimeout(timer);
                     resolve();
                 }).catch((err) => {
                     clearTimeout(timer);
                     reject(err);
                 });
             });
        });

        const results = await Promise.allSettled(wrappedPromises);
        const successful = results.filter(r => r.status === 'fulfilled');
        
        if (successful.length === 0) {
            const errors = results
                .filter(r => r.status === 'rejected')
                .map(r => (r as PromiseRejectedResult).reason.message)
                .join(', ');
            throw new NCC05RelayError(`Failed to publish to any relay. Errors: ${errors}`);
        }
        
        // If partial success, we consider it a success.
    }

    /**
     * Publishes a single record encrypted for multiple recipients using the wrapping pattern.
     * This avoids sharing a single group private key.
     * 
     * @param relays - List of relays to publish to.
     * @param secretKey - The publisher's secret key.
     * @param recipients - List of recipient public keys (hex).
     * @param payload - The service locator payload.
     * @param identifier - The 'd' tag identifier (default: 'addr').
     * @returns The signed Nostr event.
     */
    async publishWrapped(
        relays: string[],
        signerInput: SignerInput,
        recipients: string[],
        payload: NCC05Payload,
        optionsOrIdentifier: { identifier?: string, privateLocator?: boolean } | string = 'addr'
    ): Promise<Event> {
        let identifier = 'addr';
        let privateLocator = false;

        if (typeof optionsOrIdentifier === 'string') {
            identifier = optionsOrIdentifier;
        } else {
            identifier = optionsOrIdentifier.identifier || 'addr';
            privateLocator = !!optionsOrIdentifier.privateLocator;
        }

        const signer = toSigner(signerInput);
        if (!signer) throw new NCC05ArgumentError("Signer must be provided.");

        const myPubkey = await signer.getPublicKey();
        const sessionKey = generateSecretKey();
        const sessionKeyHex = Array.from(sessionKey).map(b => b.toString(16).padStart(2, '0')).join('');
        
        const selfConversation = nip44.getConversationKey(sessionKey, getPublicKey(sessionKey));
        const ciphertext = nip44.encrypt(JSON.stringify(payload), selfConversation);

        const wraps: Record<string, string> = {};
        for (const rPk of recipients) {
            const conversationKey = await signer.getConversationKey(rPk);
            wraps[rPk] = nip44.encrypt(sessionKeyHex, conversationKey);
        }

        const wrappedContent: WrappedContent = { ciphertext, wraps };

        const tags = [['d', identifier]];
        if (privateLocator) {
            tags.push([TAG_PRIVATE, 'true']);
        }

        const eventTemplate: UnsignedEvent = {
            kind: 30058,
            created_at: Math.floor(Date.now() / 1000),
            pubkey: myPubkey,
            tags: tags,
            content: JSON.stringify(wrappedContent),
        };

        const signedEvent = await signer.signEvent(eventTemplate);
        await this._publishToRelays(relays, signedEvent);
        return signedEvent;
    }

    /**
     * Publishes a locator record. Supports self-encryption, targeted encryption, or plaintext.
     * 
     * @param relays - List of relays to publish to.
     * @param secretKey - The publisher's secret key.
     * @param payload - The service locator payload.
     * @param options - Publishing options (identifier, recipient, or public flag).
     * @returns The signed Nostr event.
     */
    async publish(
        relays: string[],
        signerInput: SignerInput,
        payload: NCC05Payload,
        options: { identifier?: string, recipientPubkey?: string, public?: boolean, privateLocator?: boolean } = {}
    ): Promise<Event> {
        const signer = toSigner(signerInput);
        if (!signer) throw new NCC05ArgumentError("Signer must be provided.");

        const myPubkey = await signer.getPublicKey();
        const identifier = options.identifier || 'addr';
        let content = JSON.stringify(payload);

        if (!options.public) {
            const encryptionTarget = options.recipientPubkey || myPubkey;
            const conversationKey = await signer.getConversationKey(encryptionTarget);
            content = nip44.encrypt(content, conversationKey);
        }

        const tags = [['d', identifier]];
        if (options.privateLocator) {
            tags.push([TAG_PRIVATE, 'true']);
        }

        const eventTemplate: UnsignedEvent = {
            kind: 30058,
            created_at: Math.floor(Date.now() / 1000),
            pubkey: myPubkey,
            tags: tags,
            content: content,
        };

        const signedEvent = await signer.signEvent(eventTemplate);
        await this._publishToRelays(relays, signedEvent);
        return signedEvent;
    }

    /**
     * Closes connections to the specified relays if managed internally.
     */
    close(relays: string[]) {
        if (this._ownPool) {
            this.pool.close(relays);
        }
    }
}
