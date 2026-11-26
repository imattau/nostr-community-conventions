import test from 'node:test';
import assert from 'node:assert';
import nip46 from './nip46.js';
import { relayTransport } from './relay_transport.js';

test('nip46.connect() should generate valid nostrconnect URI when no bunkerUrl provided', async () => {
    // Mock the relay adapter to avoid opening real connections.
    const originalSubscribe = relayTransport.subscribe;
    relayTransport.subscribe = () => {
        return { close: () => {} };
    };

    try {
        // Disconnect first to reset state
        nip46.disconnect();

        const uri = await nip46.connect(null, () => {});
        
        // Check scheme
        assert.ok(uri.startsWith('nostrconnect://'), 'Should start with nostrconnect://');
        
        // Check relay param encoding
        const url = new URL(uri);
        const relay = url.searchParams.get('relay');
        assert.ok(relay, 'Should have relay param');
        assert.doesNotMatch(uri, /relay=wss:\/\//, 'Relay URL should be encoded');
    } finally {
        // Restore original method
        relayTransport.subscribe = originalSubscribe;
    }
});
