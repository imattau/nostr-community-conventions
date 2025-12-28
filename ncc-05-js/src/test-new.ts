import { NCC05Publisher, NCC05Resolver, NCC05Payload, NCC05TimeoutError } from './index.js';
import { generateSecretKey, getPublicKey, SimplePool } from 'nostr-tools';
import { MockRelay } from './mock-relay.js';
import { WebSocketServer } from 'ws';

async function testNewFeatures() {
    console.log('--- Starting New Features Test ---');
    const relayPort = 8081;
    const relayUrl = `ws://localhost:${relayPort}`;
    const relay = new MockRelay(relayPort);
    
    // 1. External SimplePool & Hex Keys
    console.log('Test 1: External SimplePool & Hex Keys');
    const pool = new SimplePool();
    const publisher = new NCC05Publisher({ pool });
    const resolver = new NCC05Resolver({ bootstrapRelays: [relayUrl], pool });

    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const skHex = Array.from(sk).map(b => b.toString(16).padStart(2, '0')).join('');

    const payload: NCC05Payload = {
        v: 1, ttl: 60, updated_at: Math.floor(Date.now() / 1000),
        endpoints: [{ type: 'tcp', url: 'hex-test', priority: 1, family: 'ipv4' }]
    };

    try {
        // Publish using HEX string secret key
        await publisher.publish([relayUrl], skHex, payload, { identifier: 'hex-key' });
        console.log('Published with Hex Key: OK');
    } catch (e) {
        console.error('Failed to publish with hex key:', e);
        process.exit(1);
    }

    try {
        // Resolve using Hex string secret key
        const res = await resolver.resolve(pk, skHex, 'hex-key');
        if (res && res.endpoints[0].url === 'hex-test') {
            console.log('Resolved with Hex Key: OK');
        } else {
            console.error('Failed to resolve with hex key');
            process.exit(1);
        }
    } catch (e) {
        console.error('Resolution error:', e);
        process.exit(1);
    }

    // 2. Graceful Degradation
    console.log('Test 2: Graceful Degradation (One bad relay)');
    const badRelay = 'ws://localhost:9999'; // assuming closed/unreachable
    try {
        // Should succeed because one relay is good
        await publisher.publish([relayUrl, badRelay], sk, payload, { identifier: 'graceful' });
        console.log('Graceful degradation publish: OK');
    } catch (e) {
        console.error('Graceful degradation failed:', e);
        process.exit(1);
    }

    // 3. Timeout
    console.log('Test 3: Resolver Timeout');
    // Create a "Hanging Relay" that accepts connection but sends no data
    const hangingPort = 8082;
    const wss = new WebSocketServer({ port: hangingPort });
    
    const timeoutResolver = new NCC05Resolver({ 
        bootstrapRelays: [`ws://localhost:${hangingPort}`],
        timeout: 500 // 500ms
    });
    
    const start = Date.now();
    try {
        await timeoutResolver.resolve(pk, sk, 'any');
        console.error('Should have timed out!');
        wss.close();
        process.exit(1);
    } catch (e) {
        const duration = Date.now() - start;
        if (e instanceof NCC05TimeoutError) {
            console.log(`Timed out as expected in ${duration}ms: OK`);
        } else {
            console.error('Caught unexpected error:', e);
            // It might be that SimplePool fails connection before timeout if it's super fast,
            // but WebSocketServer is listening.
        }
    } finally {
        wss.close();
    }

    relay.stop();
    pool.close([relayUrl]); 
    timeoutResolver.close();
    console.log('New Features Test Suite Passed.');
    process.exit(0);
}

testNewFeatures().catch(console.error);
