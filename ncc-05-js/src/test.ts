import { NCC05Publisher, NCC05Resolver, NCC05Payload } from './index.js';
import { generateSecretKey, getPublicKey } from 'nostr-tools';

async function test() {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const relays = ['wss://relay.damus.io'];

    const publisher = new NCC05Publisher();
    const resolver = new NCC05Resolver({ bootstrapRelays: relays });

    const payload: NCC05Payload = {
        v: 1,
        ttl: 60,
        updated_at: Math.floor(Date.now() / 1000),
        endpoints: [
            { type: 'tcp', uri: '127.0.0.1:9000', priority: 1, family: 'ipv4' }
        ]
    };

    console.log('Publishing...');
    await publisher.publish(relays, sk, payload);
    console.log('Published.');

    console.log('Resolving...');
    const resolved = await resolver.resolve(pk, sk);
    
    if (resolved) {
        console.log('Successfully resolved:', JSON.stringify(resolved, null, 2));
    } else {
        console.log('Failed to resolve.');
    }

    publisher.close(relays);
    resolver.close();
    process.exit(0);
}

test().catch(console.error);
