import test from 'node:test';
import assert from 'node:assert';
import { buildTagsForDraft, payloadToDraft, createEventTemplate } from './nostr.js';

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

test('payloadToDraft() should correctly parse tags for kind 30050', () => {
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

test('buildTagsForDraft() should handle NSR (kind 30051) tags correctly', () => {
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

test('buildTagsForDraft() should handle Endorsement (kind 30052) tags correctly', () => {
    const draft = {
        kind: 30052,
        tags: {
            endorses: 'event_id_xyz',
            roles: ['editor', 'reviewer'],
            implementation: 'https://github.com/example',
            note: 'Looks good',
            topics: ['security']
        }
    };
    const tags = buildTagsForDraft(draft);

    assert.deepEqual(tags.find(t => t[0] === 'endorses'), ['endorses', 'event:event_id_xyz']);
    assert.ok(tags.some(t => t[0] === 'role' && t[1] === 'editor'));
    assert.ok(tags.some(t => t[0] === 'role' && t[1] === 'reviewer'));
    assert.deepEqual(tags.find(t => t[0] === 'implementation'), ['implementation', 'https://github.com/example']);
    assert.deepEqual(tags.find(t => t[0] === 'note'), ['note', 'Looks good']);
    assert.deepEqual(tags.find(t => t[0] === 't'), ['t', 'security']);
});

test('payloadToDraft() should correctly parse tags for kind 30052', () => {
    const payload = {
        kind: 30052,
        tags: [
            ['endorses', 'event:abc'],
            ['role', 'maintainer'],
            ['implementation', 'impl_url'],
            ['note', 'notes'],
            ['t', 'topic1']
        ]
    };
    const draft = payloadToDraft(payload);

    assert.strictEqual(draft.tags.endorses, 'abc'); // normalizeSupersedes removes event:
    assert.deepEqual(draft.tags.roles, ['maintainer']);
    assert.strictEqual(draft.tags.implementation, 'impl_url');
    assert.strictEqual(draft.tags.note, 'notes');
    assert.deepEqual(draft.tags.topics, ['topic1']);
});

test('buildTagsForDraft() should handle Community Definition (kind 30053) tags correctly', () => {
    const draft = {
        kind: 30053,
        tags: {
            title: 'My Community',
            for: 'nostr:pubkey',
            for_event: 'event:xyz',
            type: 'open',
            topics: ['social'],
            lang: 'fr',
            license: 'CC0',
            authors: ['pubkeyA']
        }
    };
    const tags = buildTagsForDraft(draft);

    assert.deepEqual(tags.find(t => t[0] === 'title'), ['title', 'My Community']);
    assert.deepEqual(tags.find(t => t[0] === 'for'), ['for', 'nostr:pubkey']);
    assert.deepEqual(tags.find(t => t[0] === 'for_event'), ['for_event', 'event:xyz']);
    assert.deepEqual(tags.find(t => t[0] === 'type'), ['type', 'open']);
    assert.deepEqual(tags.find(t => t[0] === 't'), ['t', 'social']);
    assert.deepEqual(tags.find(t => t[0] === 'lang'), ['lang', 'fr']);
    assert.deepEqual(tags.find(t => t[0] === 'license'), ['license', 'CC0']);
    assert.deepEqual(tags.find(t => t[0] === 'authors'), ['authors', 'pubkeyA']);
});

test('payloadToDraft() should correctly parse tags for kind 30053', () => {
    const payload = {
        kind: 30053,
        tags: [
            ['title', 'Comm'],
            ['for', 'thing'],
            ['for_event', 'event:123'],
            ['type', 'closed'],
            ['t', 'topic'],
            ['lang', 'de'],
            ['license', 'Unlicense'],
            ['authors', 'me']
        ]
    };
    const draft = payloadToDraft(payload);

    assert.strictEqual(draft.tags.title, 'Comm');
    assert.strictEqual(draft.tags.for, 'thing');
    assert.strictEqual(draft.tags.for_event, '123');
    assert.strictEqual(draft.tags.type, 'closed');
    assert.deepEqual(draft.tags.topics, ['topic']);
    assert.strictEqual(draft.tags.lang, 'de');
    assert.strictEqual(draft.tags.license, 'Unlicense');
    assert.deepEqual(draft.tags.authors, ['me']);
});

test('createEventTemplate() should create a valid event object', () => {
    const draft = {
        kind: 30050,
        d: 'ncc-test',
        content: 'Test content',
        status: 'published'
    };
    const template = createEventTemplate(draft);

    assert.strictEqual(template.kind, 30050);
    assert.strictEqual(template.content, 'Test content');
    assert.ok(typeof template.created_at === 'number');
    assert.ok(template.tags.some(t => t[0] === 'd' && t[1] === 'ncc-test'));
    assert.ok(template.tags.some(t => t[0] === 'status' && t[1] === 'published'));
});
