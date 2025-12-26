/**
 * NCC-05: Identity-Bound Service Locator Resolution
 * 
 * This library implements the NCC-05 convention for publishing and resolving
 * dynamic service endpoints (IP, Port, Onion) bound to Nostr identities.
 * 
 * @module ncc-05
 */

import { 
    SimplePool, 
    nip44, 
    nip19,
    finalizeEvent, 
    verifyEvent, 
    Event, 
    getPublicKey,
    generateSecretKey
} from 'nostr-tools';

/**
 * Represents a single reachable service endpoint.
 */
export interface NCC05Endpoint {
    /** Protocol type, e.g., 'tcp', 'udp', 'http' */
    type: 'tcp' | 'udp' | string;
    /** The URI string, e.g., '1.2.3.4:8080' or '[2001:db8::1]:9000' */
    uri: string;
    /** Priority for selection (lower is higher priority) */
    priority: number;
    /** Network family for routing hints */
    family: 'ipv4' | 'ipv6' | 'onion' | string;
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
    /** Custom WebSocket implementation (e.g., for Tor/SOCKS5 in Node.js) */
    websocketImplementation?: any;
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
        groupSecretKey: Uint8Array,
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
    private bootstrapRelays: string[];
    private timeout: number;

    /**
     * @param options - Configuration for the resolver.
     */
    constructor(options: ResolverOptions = {}) {
        this.pool = new SimplePool();
        if (options.websocketImplementation) {
            // @ts-ignore - Patching pool for custom transport
            this.pool.websocketImplementation = options.websocketImplementation;
        }
        this.bootstrapRelays = options.bootstrapRelays || ['wss://relay.damus.io', 'wss://nos.lol'];
        this.timeout = options.timeout || 10000;
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
     * @returns The resolved and validated NCC05Payload, or null if not found/invalid.
     */
    async resolve(
        targetPubkey: string, 
        secretKey?: Uint8Array, 
        identifier: string = 'addr',
        options: { strict?: boolean, gossip?: boolean } = {}
    ): Promise<NCC05Payload | null> {
        let hexPubkey = targetPubkey;
        if (targetPubkey.startsWith('npub1')) {
            const decoded = nip19.decode(targetPubkey);
            hexPubkey = decoded.data as string;
        }

        let queryRelays = [...this.bootstrapRelays];

        // 1. NIP-65 Gossip Discovery
        if (options.gossip) {
            const relayListEvent = await this.pool.get(this.bootstrapRelays, {
                authors: [hexPubkey],
                kinds: [10002]
            });
            // Security: Verify NIP-65 event signature and author
            if (relayListEvent && verifyEvent(relayListEvent) && relayListEvent.pubkey === hexPubkey) {
                const discoveredRelays = relayListEvent.tags
                    .filter(t => t[0] === 'r')
                    .map(t => t[1]);
                if (discoveredRelays.length > 0) {
                    queryRelays = [...new Set([...queryRelays, ...discoveredRelays])];
                }
            }
        }

        const filter = {
            authors: [hexPubkey],
            kinds: [30058],
            '#d': [identifier],
            limit: 10
        };

        const queryPromise = this.pool.querySync(queryRelays, filter);
        const timeoutPromise = new Promise<null>((r) => setTimeout(() => r(null), this.timeout));
        const result = await Promise.race([queryPromise, timeoutPromise]);
        
        if (!result || (Array.isArray(result) && result.length === 0)) return null;
        
        // 2. Filter for valid signatures, correct author, and sort by created_at
        const validEvents = (result as Event[])
            .filter(e => e.pubkey === hexPubkey && verifyEvent(e))
            .sort((a, b) => b.created_at - a.created_at);

        if (validEvents.length === 0) return null;
        const latestEvent = validEvents[0];

        try {
            let content = latestEvent.content;
            
            // Security: Robust multi-recipient detection
            const isWrapped = content.includes('"wraps"') && 
                             content.includes('"ciphertext"') && 
                             content.startsWith('{');

            if (isWrapped && secretKey) {
                const wrapped = JSON.parse(content) as WrappedContent;
                const myPk = getPublicKey(secretKey);
                const myWrap = wrapped.wraps[myPk];
                
                if (myWrap) {
                    const conversationKey = nip44.getConversationKey(secretKey, hexPubkey);
                    const symmetricKeyHex = nip44.decrypt(myWrap, conversationKey);
                    
                    // Convert hex symmetric key back to Uint8Array for NIP-44 decryption
                    const symmetricKey = new Uint8Array(
                        symmetricKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
                    );
                    
                    const sessionConversationKey = nip44.getConversationKey(
                        symmetricKey, getPublicKey(symmetricKey)
                    );
                    content = nip44.decrypt(wrapped.ciphertext, sessionConversationKey);
                } else {
                    return null; // Not intended for us
                }
            } else if (secretKey && !content.startsWith('{')) {
                // Standard NIP-44 (likely encrypted if not starting with {)
                const conversationKey = nip44.getConversationKey(secretKey, hexPubkey);
                content = nip44.decrypt(latestEvent.content, conversationKey);
            }

            // Security: Safe JSON parsing
            const payload = JSON.parse(content) as NCC05Payload;
            if (!payload || !payload.endpoints || !Array.isArray(payload.endpoints)) {
                return null;
            }

            // Freshness validation
            const now = Math.floor(Date.now() / 1000);
            if (now > payload.updated_at + payload.ttl) {
                if (options.strict) return null;
                console.warn('NCC-05 record expired');
            }

            return payload;
        } catch (e) {
            return null; // Decryption or parsing failed
        }
    }

    /**
     * Closes connections to all relays in the pool.
     */
    close() {
        this.pool.close(this.bootstrapRelays);
    }
}

/**
 * Handles the construction, encryption, and publication of NCC-05 events.
 */
export class NCC05Publisher {
    private pool: SimplePool;

    /**
     * @param options - Configuration for the publisher.
     */
    constructor(options: { websocketImplementation?: any } = {}) {
        this.pool = new SimplePool();
        if (options.websocketImplementation) {
            // @ts-ignore
            this.pool.websocketImplementation = options.websocketImplementation;
        }
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
        secretKey: Uint8Array,
        recipients: string[],
        payload: NCC05Payload,
        identifier: string = 'addr'
    ): Promise<Event> {
        const sessionKey = generateSecretKey();
        const sessionKeyHex = Array.from(sessionKey).map(b => b.toString(16).padStart(2, '0')).join('');
        
        const selfConversation = nip44.getConversationKey(sessionKey, getPublicKey(sessionKey));
        const ciphertext = nip44.encrypt(JSON.stringify(payload), selfConversation);

        const wraps: Record<string, string> = {};
        for (const rPk of recipients) {
            const conversationKey = nip44.getConversationKey(secretKey, rPk);
            wraps[rPk] = nip44.encrypt(sessionKeyHex, conversationKey);
        }

        const wrappedContent: WrappedContent = { ciphertext, wraps };

        const eventTemplate = {
            kind: 30058,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['d', identifier]],
            content: JSON.stringify(wrappedContent),
        };

        const signedEvent = finalizeEvent(eventTemplate, secretKey);
        await Promise.all(this.pool.publish(relays, signedEvent));
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
        secretKey: Uint8Array,
        payload: NCC05Payload,
        options: { identifier?: string, recipientPubkey?: string, public?: boolean } = {}
    ): Promise<Event> {
        const myPubkey = getPublicKey(secretKey);
        const identifier = options.identifier || 'addr';
        let content = JSON.stringify(payload);

        if (!options.public) {
            const encryptionTarget = options.recipientPubkey || myPubkey;
            const conversationKey = nip44.getConversationKey(secretKey, encryptionTarget);
            content = nip44.encrypt(content, conversationKey);
        }

        const eventTemplate = {
            kind: 30058,
            created_at: Math.floor(Date.now() / 1000),
            pubkey: myPubkey,
            tags: [['d', identifier]],
            content: content,
        };

        const signedEvent = finalizeEvent(eventTemplate, secretKey);
        await Promise.all(this.pool.publish(relays, signedEvent));
        return signedEvent;
    }

    /**
     * Closes connections to the specified relays.
     */
    close(relays: string[]) {
        this.pool.close(relays);
    }
}