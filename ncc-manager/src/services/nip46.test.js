import test from 'node:test';
import assert from 'node:assert';
import nip46 from './nip46.js';
import { pool } from './nostr.js';

test('nip46.connect() should generate valid nostrconnect URI when no bunkerUrl provided', async () => {
    // Mock pool.subscribe to avoid network calls
    const originalSubscribe = pool.subscribe;
    pool.subscribe = () => {
        return { close: () => {} };
    };

    try {
        // Disconnect first to reset state
        nip46.disconnect();

        const uri = await nip46.connect(null, () => {});
        
        console.log('Generated URI:', uri);

        // Check scheme
        assert.ok(uri.startsWith('nostrconnect://'), 'Should start with nostrconnect://');
        
        // Check relay param encoding
        const url = new URL(uri);
        const relay = url.searchParams.get('relay');
        assert.ok(relay, 'Should have relay param');
        assert.doesNotMatch(uri, /relay=wss:\/\//, 'Relay URL should be encoded');
    } finally {
        // Restore original method
        pool.subscribe = originalSubscribe;
    }
});