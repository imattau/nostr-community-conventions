import { test } from 'node:test';
import assert from 'node:assert';
import { validateNccChain } from './chain_validator.js';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { KINDS } from '../state.js';

// Helper to create keys
const sk1 = generateSecretKey();
const pk1 = getPublicKey(sk1);
const sk2 = generateSecretKey();
const pk2 = getPublicKey(sk2);

// Helper to create a signed event
function createEvent(sk, kind, tags = [], content = "content", created_at = Math.floor(Date.now() / 1000)) {
    const event = {
        kind,
        created_at,
        tags,
        content,
        pubkey: getPublicKey(sk),
    };
    return finalizeEvent(event, sk);
}

const D_TAG = "ncc-test";

test('validateNccChain', async (t) => {
    
    await t.test('First publish: Single doc should be authoritative', () => {
        const root = createEvent(sk1, KINDS.ncc, [['d', D_TAG], ['status', 'published']]);
        const result = validateNccChain(D_TAG, [root], []);
        
        assert.strictEqual(result.authoritativeDocId, root.id);
        assert.strictEqual(result.tips.length, 1);
        assert.strictEqual(result.warnings.length, 0);
    });

    await t.test('Normal revision chain: Root -> Rev1 -> Rev2', () => {
        const time = Math.floor(Date.now() / 1000);
        const root = createEvent(sk1, KINDS.ncc, [['d', D_TAG], ['status', 'published']], "root", time);
        const rev1 = createEvent(sk1, KINDS.ncc, [['d', D_TAG], ['status', 'published'], ['supersedes', root.id]], "rev1", time + 10);
        const rev2 = createEvent(sk1, KINDS.ncc, [['d', D_TAG], ['status', 'published'], ['supersedes', rev1.id]], "rev2", time + 20);

        const result = validateNccChain(D_TAG, [root, rev1, rev2], []);
        
        assert.strictEqual(result.authoritativeDocId, rev2.id);
        assert.strictEqual(result.tips.length, 1);
        assert.strictEqual(result.tips[0], rev2.id);
    });

    await t.test('Fork with single NSR: Root -> Rev1, Root -> Rev2. NSR favors Rev1', () => {
        const time = Math.floor(Date.now() / 1000);
        const root = createEvent(sk1, KINDS.ncc, [['d', D_TAG], ['status', 'published']], "root", time);
        const rev1 = createEvent(sk1, KINDS.ncc, [['d', D_TAG], ['status', 'published'], ['supersedes', root.id]], "rev1", time + 10);
        const rev2 = createEvent(sk1, KINDS.ncc, [['d', D_TAG], ['status', 'published'], ['supersedes', root.id]], "rev2", time + 20); // Newer but ignored due to NSR

        const nsr = createEvent(sk1, KINDS.nsr, [
            ['d', D_TAG], 
            ['type', 'revision'], 
            ['authoritative', rev1.id]
        ], "nsr", time + 30);

        const result = validateNccChain(D_TAG, [root, rev1, rev2], [nsr]);
        
        assert.strictEqual(result.authoritativeDocId, rev1.id);
        assert.strictEqual(result.authoritativeNsrId, nsr.id);
        assert.strictEqual(result.forkPoints.length, 1);
        assert.strictEqual(result.forkedBranches.includes(rev2.id), true);
    });

    await t.test('Fork with competing NSRs: Newer NSR wins', () => {
        const time = Math.floor(Date.now() / 1000);
        const root = createEvent(sk1, KINDS.ncc, [['d', D_TAG], ['status', 'published']], "root", time);
        const rev1 = createEvent(sk1, KINDS.ncc, [['d', D_TAG], ['status', 'published'], ['supersedes', root.id]], "rev1", time + 10);
        const rev2 = createEvent(sk1, KINDS.ncc, [['d', D_TAG], ['status', 'published'], ['supersedes', root.id]], "rev2", time + 20);

        const nsr1 = createEvent(sk1, KINDS.nsr, [
            ['d', D_TAG], 
            ['type', 'revision'], 
            ['authoritative', rev1.id]
        ], "nsr1", time + 30);

        const nsr2 = createEvent(sk1, KINDS.nsr, [
            ['d', D_TAG], 
            ['type', 'revision'], 
            ['authoritative', rev2.id],
            ['effective_at', String(time + 40)]
        ], "nsr2", time + 35); // Created later, and has effective_at

        const result = validateNccChain(D_TAG, [root, rev1, rev2], [nsr1, nsr2]);
        
        assert.strictEqual(result.authoritativeDocId, rev2.id);
        assert.strictEqual(result.authoritativeNsrId, nsr2.id);
    });

    await t.test('Invalid NSR ignored: Points to unknown doc', () => {
        const root = createEvent(sk1, KINDS.ncc, [['d', D_TAG], ['status', 'published']]);
        
        const nsr = createEvent(sk1, KINDS.nsr, [
            ['d', D_TAG], 
            ['type', 'revision'], 
            ['authoritative', '00'.repeat(32)] // Unknown ID
        ]);

        const result = validateNccChain(D_TAG, [root], [nsr]);
        
        assert.strictEqual(result.authoritativeDocId, root.id); // Fallback to tip
        assert.ok(result.warnings.some(w => w.includes('unknown authoritative doc')));
    });

    await t.test('Unauthorised doc present: Doc signed by wrong key ignored', () => {
        const root = createEvent(sk1, KINDS.ncc, [['d', D_TAG], ['status', 'published']]);
        const badDoc = createEvent(sk2, KINDS.ncc, [['d', D_TAG], ['status', 'published'], ['supersedes', root.id]]); // sk2 is not steward

        const result = validateNccChain(D_TAG, [root, badDoc], []);
        
        assert.strictEqual(result.authoritativeDocId, root.id);
        assert.ok(result.warnings.some(w => w.includes('Unauthorised published doc')));
    });
});
