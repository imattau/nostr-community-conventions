import { 
    SimplePool, 
    nip44, 
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
}

export class NCC05Resolver {
    private pool: SimplePool;
    private bootstrapRelays: string[];
    private timeout: number;

    constructor(options: ResolverOptions = {}) {
        this.pool = new SimplePool();
        this.bootstrapRelays = options.bootstrapRelays || ['wss://relay.damus.io', 'wss://nos.lol'];
        this.timeout = options.timeout || 10000;
    }

    /**
     * Resolve a locator record for a given pubkey.
     */
    async resolve(targetPubkey: string, secretKey: Uint8Array, identifier: string = 'addr'): Promise<NCC05Payload | null> {
        const filter = {
            authors: [targetPubkey],
            kinds: [30058],
            '#d': [identifier],
            limit: 1
        };

        const events = await this.pool.querySync(this.bootstrapRelays, filter);
        if (events.length === 0) return null;

        // 2. Select latest valid event
        const latestEvent = events.sort((a, b) => b.created_at - a.created_at)[0];
        
        if (!verifyEvent(latestEvent)) {
            throw new Error('Invalid event signature');
        }

        // 3. Decrypt
        try {
            const conversationKey = nip44.getConversationKey(secretKey, targetPubkey);
            const decrypted = nip44.decrypt(latestEvent.content, conversationKey);
            const payload = JSON.parse(decrypted) as NCC05Payload;

            // 4. Freshness check
            const now = Math.floor(Date.now() / 1000);
            if (now > payload.updated_at + payload.ttl) {
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

    constructor() {
        this.pool = new SimplePool();
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