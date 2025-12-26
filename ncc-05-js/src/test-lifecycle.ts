import { NCC05Resolver } from './index.js';
import { SimplePool } from 'nostr-tools';

async function testLifecycle() {
    console.log('--- Starting Lifecycle Test ---');
    
    // 1. Internal Pool Management
    console.log('Test 1: Internal Pool (should close)');
    const resolverInternal = new NCC05Resolver();
    // @ts-ignore - Access private property for testing or infer from behavior
    const internalPool = resolverInternal['pool'];
    internalPool.close = (_relays?: string[]) => {
        console.log('Internal pool close called.');
    };
    
    resolverInternal.close(); // Should log

    // 2. Shared Pool Management
    console.log('Test 2: Shared Pool (should NOT close)');
    const sharedPool = new SimplePool();
    let sharedClosed = false;
    sharedPool.close = (_relays?: string[]) => {
        sharedClosed = true;
        console.error('ERROR: Shared pool was closed!');
    };

    const resolverShared = new NCC05Resolver({ pool: sharedPool });
    resolverShared.close(); // Should NOT close sharedPool

    if (!sharedClosed) {
        console.log('Shared pool correctly remained open.');
    } else {
        process.exit(1);
    }
    
    console.log('Lifecycle Test Suite Passed.');
    process.exit(0);
}

testLifecycle().catch(console.error);
