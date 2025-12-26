import { NCC05Publisher, NCC05Resolver, NCC05Payload, NCC05Group } from './index.js';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

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

    // Test Strict Mode with Expired Record
    console.log('Testing expired record in strict mode...');
    const expiredPayload: NCC05Payload = {
        v: 1,
        ttl: 1,
        updated_at: Math.floor(Date.now() / 1000) - 10, // 10s ago
        endpoints: [{ type: 'tcp', uri: '1.1.1.1:1', priority: 1, family: 'ipv4' }]
    };
    await publisher.publish(relays, sk, expiredPayload, { identifier: 'expired-test' });
    const strictResult = await resolver.resolve(pk, sk, 'expired-test', { strict: true });
    
    if (strictResult === null) {
        console.log('Correctly rejected expired record in strict mode.');
    } else {
        console.error('FAILED: Strict mode allowed an expired record.');
        process.exit(1);
    }

    // Test Gossip Mode
    console.log('Testing Gossip discovery...');
    const relayListTemplate = {
        kind: 10002,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['r', relays[0]]],
        content: '',
    };
    const signedRL = (await import('nostr-tools')).finalizeEvent(relayListTemplate, sk);
    // @ts-ignore
    await Promise.all(publisher['pool'].publish(relays, signedRL));
    
    const gossipResult = await resolver.resolve(pk, sk, 'addr', { gossip: true });
    if (gossipResult) {
        console.log('Gossip discovery successful.');
    } else {
        console.error('FAILED: Gossip discovery did not find record.');
        process.exit(1);
    }

    // Test npub resolution
    console.log('Testing npub resolution...');
    const npub = nip19.npubEncode(pk);
    const npubResult = await resolver.resolve(npub, sk);
    if (npubResult) {
        console.log('npub resolution successful.');
    } else {
        console.error('FAILED: npub resolution did not find record.');
        process.exit(1);
    }

    // Test Friend-to-Friend resolution
    console.log('Testing Friend-to-Friend resolution...');
    const skA = generateSecretKey();
    const pkA = getPublicKey(skA);
    const skB = generateSecretKey();
    const pkB = getPublicKey(skB);

    const payloadFriend: NCC05Payload = {
        v: 1, ttl: 60, updated_at: Math.floor(Date.now() / 1000),
        endpoints: [{ type: 'tcp', uri: 'friend:7777', priority: 1, family: 'ipv4' }]
    };

    // User A publishes for User B
    console.log('User A publishing for User B...');
    await publisher.publish(relays, skA, payloadFriend, { identifier: 'friend-test', recipientPubkey: pkB });

    // User B resolves User A's record
    console.log('User B resolving User A...');
    const friendResult = await resolver.resolve(pkA, skB, 'friend-test');
    if (friendResult && friendResult.endpoints[0].uri === 'friend:7777') {
        console.log('Friend-to-Friend resolution successful.');
    } else {
        console.error('FAILED: Friend-to-Friend resolution.');
        process.exit(1);
    }

    // Test Group Resolution Utility
    console.log('Testing NCC05Group utility...');
    const groupIdentity = NCC05Group.createGroupIdentity();
    const payloadGroup: NCC05Payload = {
        v: 1, ttl: 60, updated_at: Math.floor(Date.now() / 1000),
        endpoints: [{ type: 'tcp', uri: 'group-service:8888', priority: 1, family: 'ipv4' }]
    };

    console.log('Publishing as Group...');
    await publisher.publish(relays, groupIdentity.sk, payloadGroup, { identifier: 'group-test' });

    console.log('Resolving as Group Member...');
    const groupResult = await NCC05Group.resolveAsGroup(resolver, groupIdentity.pk, groupIdentity.sk, 'group-test');
    if (groupResult && groupResult.endpoints[0].uri === 'group-service:8888') {
        console.log('NCC05Group resolution successful.');
    } else {
        console.error('FAILED: NCC05Group resolution.');
        process.exit(1);
    }

    // Test Group Wrapping (NIP-59 style Multi-Recipient)
    console.log('Testing Group Wrapping (Multi-Recipient)...');
    const skAlice = generateSecretKey();
    const pkAlice = getPublicKey(skAlice);
    const skBob = generateSecretKey();
    const pkBob = getPublicKey(skBob);
    const skCharlie = generateSecretKey();
    const pkCharlie = getPublicKey(skCharlie);

    const payloadWrap: NCC05Payload = {
        v: 1, ttl: 60, updated_at: Math.floor(Date.now() / 1000),
        endpoints: [{ type: 'tcp', uri: 'multi-recipient:9999', priority: 1, family: 'ipv4' }]
    };

    console.log('Alice publishing wrapped record for Bob and Charlie...');
    await publisher.publishWrapped(relays, skAlice, [pkBob, pkCharlie], payloadWrap, 'wrap-test');

    console.log('Bob resolving Alice...');
    const bobResult = await resolver.resolve(pkAlice, skBob, 'wrap-test');
    
    console.log('Charlie resolving Alice...');
    const charlieResult = await resolver.resolve(pkAlice, skCharlie, 'wrap-test');

    if (bobResult && charlieResult && bobResult.endpoints[0].uri === 'multi-recipient:9999') {
        console.log('Group Wrapping successful! Both recipients resolved Alice.');
    } else {
        console.error('FAILED: Group Wrapping resolution.');
        process.exit(1);
    }

    publisher.close(relays);
    resolver.close();
    process.exit(0);
}

test().catch(console.error);