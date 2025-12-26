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
    websocketImplementation?: any;
}

export class NCC05Group {
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
}

export class NCC05Resolver {
    private pool: SimplePool;
    private bootstrapRelays: string[];
    private timeout: number;

    constructor(options: ResolverOptions = {}) {
        this.pool = new SimplePool();
        if (options.websocketImplementation) {
            // @ts-ignore
            this.pool.websocketImplementation = options.websocketImplementation;
        }
        this.bootstrapRelays = options.bootstrapRelays || ['wss://relay.damus.io', 'wss://nos.lol'];
        this.timeout = options.timeout || 10000;
    }

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

        if (options.gossip) {
            const relayListEvent = await this.pool.get(this.bootstrapRelays, {
                authors: [hexPubkey],
                kinds: [10002]
            });
            if (relayListEvent) {
                const discoveredRelays = relayListEvent.tags
                    .filter(t => t[0] === 'r')
                    .map(t => t[1]);
                queryRelays = [...new Set([...queryRelays, ...discoveredRelays])];
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
        
        const validEvents = (result as Event[])
            .filter(e => verifyEvent(e))
            .sort((a, b) => b.created_at - a.created_at);

        if (validEvents.length === 0) return null;
        const latestEvent = validEvents[0];

        // 2. Decrypt or Parse Plaintext
        try {
            let content = latestEvent.content;
            
            // Attempt decryption if SK is provided
            if (secretKey) {
                const conversationKey = nip44.getConversationKey(secretKey, hexPubkey);
                content = nip44.decrypt(latestEvent.content, conversationKey);
            }

            const payload = JSON.parse(content) as NCC05Payload;

            if (!payload.endpoints) return null;

            const now = Math.floor(Date.now() / 1000);
            if (now > payload.updated_at + payload.ttl) {
                if (options.strict) return null;
                console.warn('NCC-05 record expired');
            }

            return payload;
        } catch (e) {
            // If it's encrypted but we don't have the key, this fails naturally
            return null;
        }
    }

    close() { this.pool.close(this.bootstrapRelays); }
}

export class NCC05Publisher {
    private pool: SimplePool;

    constructor(options: { websocketImplementation?: any } = {}) {
        this.pool = new SimplePool();
        if (options.websocketImplementation) {
            // @ts-ignore
            this.pool.websocketImplementation = options.websocketImplementation;
        }
    }

    async publish(
        relays: string[],
        secretKey: Uint8Array,
        payload: NCC05Payload,
        options: { identifier?: string, recipientPubkey?: string, public?: boolean } = {}
    ): Promise<Event> {
        const myPubkey = getPublicKey(secretKey);
        const identifier = options.identifier || 'addr';
        let content = JSON.stringify(payload);

        // 1. Handle Encryption
        if (!options.public) {
            const encryptionTarget = options.recipientPubkey || myPubkey;
            const conversationKey = nip44.getConversationKey(secretKey, encryptionTarget);
            content = nip44.encrypt(content, conversationKey);
        }

        // 2. Create Event
        const eventTemplate = {
            kind: 30058,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['d', identifier]],
            content: content,
        };

        const signedEvent = finalizeEvent(eventTemplate, secretKey);
        await Promise.all(this.pool.publish(relays, signedEvent));
        return signedEvent;
    }

    close(relays: string[]) { this.pool.close(relays); }
}
