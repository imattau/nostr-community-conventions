import test from 'node:test';
import assert from 'node:assert';
import { buildTagsForDraft, payloadToDraft } from './nostr.js';

test('buildTagsForDraft() should generate correct tags for kind 30050', () => {
    const draft = {
        kind: 30050,
        d: 'ncc-01',
        title: 'Test NCC',
        status: 'published',
        tags: {
            summary: 'A test summary',
            topics: ['test', 'nostr'],
            lang: 'en',
            version: '1',
            license: 'MIT',
            authors: ['pubkey1']
        }
    };
    const tags = buildTagsForDraft(draft);
    
    assert.deepEqual(tags.find(t => t[0] === 'd'), ['d', 'ncc-01']);
    assert.deepEqual(tags.find(t => t[0] === 'title'), ['title', 'Test NCC']);
    assert.deepEqual(tags.find(t => t[0] === 'status'), ['status', 'published']);
    assert.deepEqual(tags.find(t => t[0] === 'summary'), ['summary', 'A test summary']);
    assert.ok(tags.some(t => t[0] === 't' && t[1] === 'test'));
    assert.deepEqual(tags.find(t => t[0] === 'lang'), ['lang', 'en']);
    assert.deepEqual(tags.find(t => t[0] === 'version'), ['version', '1']);
    assert.deepEqual(tags.find(t => t[0] === 'license'), ['license', 'MIT']);
    assert.ok(tags.some(t => t[0] === 'authors' && t[1] === 'pubkey1'));
});

test('payloadToDraft() should correctly parse tags', () => {
    const payload = {
        kind: 30050,
        id: 'event_id_123',
        pubkey: 'author_pubkey_abc',
        tags: [
            ['d', 'ncc-01'],
            ['title', 'Test NCC'],
            ['status', 'published'],
            ['t', 'test'],
            ['lang', 'en'],
            ['version', '1']
        ],
        content: 'Test content'
    };
    const draft = payloadToDraft(payload);
    
    assert.strictEqual(draft.d, 'ncc-01');
    assert.strictEqual(draft.title, 'Test NCC');
    assert.strictEqual(draft.status, 'published');
    assert.strictEqual(draft.author_pubkey, 'author_pubkey_abc');
    assert.deepEqual(draft.tags.topics, ['test']);
    assert.strictEqual(draft.tags.lang, 'en');
    assert.strictEqual(draft.tags.version, '1');
});

test('buildTagsForDraft() should handle NSR tags correctly', () => {
    const draft = {
        kind: 30051,
        d: 'ncc-01',
        tags: {
            authoritative: 'new_id',
            type: 'revision',
            from: 'old_id',
            to: 'new_id',
            previous: 'old_id'
        }
    };
    const tags = buildTagsForDraft(draft);
    
    assert.deepEqual(tags.find(t => t[0] === 'authoritative'), ['authoritative', 'event:new_id']);
    assert.deepEqual(tags.find(t => t[0] === 'type'), ['type', 'revision']);
    assert.deepEqual(tags.find(t => t[0] === 'from'), ['from', 'event:old_id']);
    assert.deepEqual(tags.find(t => t[0] === 'to'), ['to', 'event:new_id']);
    assert.deepEqual(tags.find(t => t[0] === 'previous'), ['previous', 'event:old_id']);
});
