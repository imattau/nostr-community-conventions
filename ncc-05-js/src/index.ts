import { 
    SimplePool, 
    nip44, 
    nip19,
    finalizeEvent, 
    verifyEvent, 
    Event, 
    getPublicKey
} from 'nostr-tools';

export interface NCC05Endpoint {
    type: 'tcp' | 'udp' | string;
    uri: string;
    priority: number;
    family: 'ipv4' | 'ipv6' | 'onion' | string;
}

export interface NCC05Payload {
    v: number;
    ttl: number;
    updated_at: number;
    endpoints: NCC05Endpoint[];
    caps?: string[];
    notes?: string;
}

export interface ResolverOptions {
    bootstrapRelays?: string[];
    timeout?: number;
    websocketImplementation?: any; // To support Tor/SOCKS5 proxies in Node.js
}

export class NCC05Resolver {
    private pool: SimplePool;
    private bootstrapRelays: string[];
    private timeout: number;

    constructor(options: ResolverOptions = {}) {
        this.pool = new SimplePool();
        if (options.websocketImplementation) {
            // @ts-ignore - Patching pool for custom WebSocket (Tor/Proxy)
            this.pool.websocketImplementation = options.websocketImplementation;
        }
        this.bootstrapRelays = options.bootstrapRelays || ['wss://relay.damus.io', 'wss://nos.lol'];
        this.timeout = options.timeout || 10000;
    }

    /**
     * Resolve a locator record for a given pubkey.
     * Supports both hex and npub strings.
     */
    async resolve(
        targetPubkey: string, 
        secretKey: Uint8Array, 
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

            if (relayListEvent) {
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
        const timeoutPromise = new Promise<null>((resolve) => 
            setTimeout(() => resolve(null), this.timeout)
        );

        const result = await Promise.race([queryPromise, timeoutPromise]);
        
        if (!result || (Array.isArray(result) && result.length === 0)) return null;
        
        // 2. Filter for valid signatures and sort by created_at
        const validEvents = (result as Event[])
            .filter(e => verifyEvent(e))
            .sort((a, b) => b.created_at - a.created_at);

        if (validEvents.length === 0) return null;
        const latestEvent = validEvents[0];

        // 2. Decrypt
        try {
            const conversationKey = nip44.getConversationKey(secretKey, hexPubkey);
            const decrypted = nip44.decrypt(latestEvent.content, conversationKey);
            const payload = JSON.parse(decrypted) as NCC05Payload;

            // 3. Basic Validation
            if (!payload.endpoints || !Array.isArray(payload.endpoints)) {
                console.error('Invalid NCC-05 payload structure');
                return null;
            }

            // 4. Freshness check
            const now = Math.floor(Date.now() / 1000);
            if (now > payload.updated_at + payload.ttl) {
                if (options.strict) {
                    console.warn('Rejecting expired NCC-05 record (strict mode)');
                    return null;
                }
                console.warn('NCC-05 record has expired');
            }

            return payload;
        } catch (e) {
            console.error('Failed to decrypt or parse NCC-05 record:', e);
            return null;
        }
    }

    close() {
        this.pool.close(this.bootstrapRelays);
    }
}

export class NCC05Publisher {
    private pool: SimplePool;

    constructor(options: { websocketImplementation?: any } = {}) {
        this.pool = new SimplePool();
        if (options.websocketImplementation) {
            // @ts-ignore - Patching pool for custom WebSocket (Tor/Proxy)
            this.pool.websocketImplementation = options.websocketImplementation;
        }
    }

    /**
     * Create and publish a locator record.
     */
    async publish(
        relays: string[],
        secretKey: Uint8Array,
        payload: NCC05Payload,
        identifier: string = 'addr'
    ): Promise<Event> {
        const pubkey = getPublicKey(secretKey);
        
        // 1. Encrypt
        const conversationKey = nip44.getConversationKey(secretKey, pubkey);
        const encryptedContent = nip44.encrypt(JSON.stringify(payload), conversationKey);

        // 2. Create and Finalize Event
        const eventTemplate = {
            kind: 30058,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['d', identifier]],
            content: encryptedContent,
        };

        const signedEvent = finalizeEvent(eventTemplate, secretKey);

        // 3. Publish
        await Promise.all(this.pool.publish(relays, signedEvent));
        
        return signedEvent;
    }

    close(relays: string[]) {
        this.pool.close(relays);
    }
}
