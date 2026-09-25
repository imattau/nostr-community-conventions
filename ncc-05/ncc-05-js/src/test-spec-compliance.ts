import { NCC05Endpoint, selectEndpoints, NCC05Resolver, NCC05Payload, NCC05Publisher } from './index.js';
import { generateSecretKey, getPublicKey, SimplePool, finalizeEvent, nip44 } from 'nostr-tools';
import { MockRelay } from './mock-relay.js';

async function testSpecCompliance() {
    console.log('--- Starting NCC-05 Spec Compliance Tests ---');

    // 1. Test Endpoint Selection (Unit Test)
    console.log('Test 1: Endpoint Selection Sorting');
    const endpoints: NCC05Endpoint[] = [
        { type: 'tcp', url: 'ipv4', priority: 10, family: 'ipv4' },
        { type: 'tcp', url: 'onion', priority: 10, family: 'onion' },
        { type: 'tcp', url: 'ipv6', priority: 10, family: 'ipv6' },
        { type: 'tcp', url: 'high-prio', priority: 5, family: 'ipv4' }
    ];

    const sorted = selectEndpoints(endpoints);
    
    // Expected: priority 5 first. Then priority 10.
    // Within priority 10: onion (1), ipv6 (2), ipv4 (3).
    
    if (sorted[0].url !== 'high-prio') throw new Error('Priority sort failed');
    if (sorted[1].url !== 'onion') throw new Error('Family sort failed (onion should be first)');
    if (sorted[2].url !== 'ipv6') throw new Error('Family sort failed (ipv6 should be second)');
    if (sorted[3].url !== 'ipv4') throw new Error('Family sort failed (ipv4 should be third)');
    console.log('Endpoint Selection Sorting: OK');


    // Setup Relay for Integration Tests
    const relayPort = 8085;
    const relayUrl = `ws://localhost:${relayPort}`;
    const relay = new MockRelay(relayPort);
    const pool = new SimplePool();
    const resolver = new NCC05Resolver({ bootstrapRelays: [relayUrl], pool });
    const publisher = new NCC05Publisher({ pool });
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);

    try {
        // 2. Test Expiration Tag
        console.log('Test 2: Expiration Tag vs TTL');
        
        // Case A: TTL is valid, but Expiration Tag is past
        // We need to manually craft this event because publisher helper doesn't support adding raw tags easily for this test case maybe?
        // Actually publisher supports nothing for expiration tag yet.
        // We will construct event manually.
        
        const now = Math.floor(Date.now() / 1000);
        const expiredTagTime = now - 100; // Expired 100s ago
        const validTTL = 3600; // Valid for 1 hour

        const payload: NCC05Payload = {
            v: 1, ttl: validTTL, updated_at: now,
            endpoints: [{ type: 'tcp', url: 'test', priority: 1, family: 'ipv4' }]
        };
        
        const content = nip44.encrypt(JSON.stringify(payload), nip44.getConversationKey(sk, pk));
        
        const eventTemplate = {
            kind: 30058,
            created_at: now,
            pubkey: pk,
            tags: [['d', 'expired-test'], ['expiration', expiredTagTime.toString()]],
            content: content
        };
        
        const event = finalizeEvent(eventTemplate, sk);
        await pool.publish([relayUrl], event);
        
        // Wait for relay
        await new Promise(r => setTimeout(r, 100));

        // Attempt resolve with strict mode (should return null)
        const res1 = await resolver.resolve(pk, sk, 'expired-test', { strict: true });
        if (res1 !== null) throw new Error('Should have returned null due to expiration tag');
        
        // Attempt resolve without strict (should warn but return)
        // Wait, current impl warns but returns payload if strictly not null? 
        // Logic: if (now > expiry) { if (strict) return null; console.warn... } return payload;
        const res2 = await resolver.resolve(pk, sk, 'expired-test', { strict: false });
        if (!res2) throw new Error('Should have returned payload in non-strict mode');
        
        console.log('Expiration Tag Logic: OK');

        // 3. Tie Breaking (Same created_at)
        console.log('Test 3: Tie Breaking (Lexicographically smallest ID)');
        
        const time = now + 100; // Future to avoid expiry issues
        const payload1 = { ...payload, notes: "A" };
        const payload2 = { ...payload, notes: "B" };
        
        // We need to find two events with same created_at where ID_A < ID_B.
        // And we want the logic to pick ID_A.
        // Logic: sort((a, b) => a.id.localeCompare(b.id)). 
        // Wait, logic in code:
        // sort((a, b) => { if (time_diff) ...; return a.id.localeCompare(b.id); })
        // validEvents[0] is taken.
        // So a.id.localeCompare(b.id) returns negative if a < b.
        // sort asc: [small, large]. 
        // validEvents[0] is small.
        // So yes, smallest ID wins.

        const convKey = nip44.getConversationKey(sk, pk);
        
        const ev1 = finalizeEvent({
            kind: 30058, created_at: time, tags: [['d', 'tie-break']],
            content: nip44.encrypt(JSON.stringify(payload1), convKey)
        }, sk);
        
        const ev2 = finalizeEvent({
            kind: 30058, created_at: time, tags: [['d', 'tie-break']],
            content: nip44.encrypt(JSON.stringify(payload2), convKey)
        }, sk);

        // We don't know which ID is smaller yet.
        const [small, large] = ev1.id < ev2.id ? [ev1, ev2] : [ev2, ev1];
        
        // Publish both
        await pool.publish([relayUrl], small);
        await pool.publish([relayUrl], large);
        
        await new Promise(r => setTimeout(r, 100));
        
        const resolved = await resolver.resolve(pk, sk, 'tie-break');
        if (!resolved) throw new Error('Failed to resolve');
        
        // Decrypt expected notes
        // Small ID payload should match
        const smallPayload = small === ev1 ? payload1 : payload2;
        
        if (resolved.notes !== smallPayload.notes) {
            console.error('Resolved notes:', resolved.notes);
            console.error('Expected notes:', smallPayload.notes);
            throw new Error('Tie breaking failed: Did not select smallest ID');
        }
        
        console.log('Tie Breaking Logic: OK');

    } catch (e) {
        console.error('Test Failed:', e);
        process.exit(1);
    } finally {
        relay.stop();
        pool.close([relayUrl]);
    }
    
    console.log('Spec Compliance Tests Passed.');
}

testSpecCompliance().catch(console.error);
