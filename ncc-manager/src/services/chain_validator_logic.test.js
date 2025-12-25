import test from 'node:test';
import assert from 'node:assert';
import { validateDraftForPublish } from './chain_validator.js';
import { KINDS } from '../state.js';

test('validateDraftForPublish should require d tag', () => {
    assert.match(validateDraftForPublish({ kind: KINDS.ncc }), /d tag/);
});

test('validateDraftForPublish should validate NCC (kind 30050)', () => {
    const valid = {
        kind: KINDS.ncc,
        d: 'ncc-test',
        title: 'Title',
        content: 'Content',
        tags: { version: '1' }
    };
    assert.strictEqual(validateDraftForPublish(valid), null);

    assert.match(validateDraftForPublish({ ...valid, title: '' }), /Title/);
    assert.match(validateDraftForPublish({ ...valid, content: '' }), /Content/);
    assert.match(validateDraftForPublish({ ...valid, tags: {} }), /Version/);
});

test('validateDraftForPublish should validate NSR (kind 30051)', () => {
    const valid = {
        kind: KINDS.nsr,
        d: 'ncc-test',
        tags: { 
            authoritative: 'a'.repeat(64),
            reason: 'Test' 
        }
    };
    assert.strictEqual(validateDraftForPublish(valid), null);

    assert.match(validateDraftForPublish({ ...valid, tags: { reason: 'Test' } }), /Authoritative/);
    assert.match(validateDraftForPublish({ ...valid, tags: { authoritative: 'bad', reason: 'Test' } }), /Invalid Authoritative/);
    assert.match(validateDraftForPublish({ ...valid, tags: { authoritative: 'a'.repeat(64) } }), /Reason/);
});

test('validateDraftForPublish should validate Endorsement (kind 30052)', () => {
    const valid = {
        kind: KINDS.endorsement,
        d: 'ncc-test',
        tags: { endorses: 'a'.repeat(64) }
    };
    assert.strictEqual(validateDraftForPublish(valid), null);

    assert.match(validateDraftForPublish({ ...valid, tags: {} }), /Endorsed/);
    assert.match(validateDraftForPublish({ ...valid, tags: { endorses: 'bad' } }), /Invalid Endorsed/);
});

test('validateDraftForPublish should validate Supporting (kind 30053)', () => {
    const valid = {
        kind: KINDS.supporting,
        d: 'ncc-test',
        tags: { type: 'open', for: 'ncc-01' }
    };
    assert.strictEqual(validateDraftForPublish(valid), null);

    assert.match(validateDraftForPublish({ ...valid, tags: { for: 'ncc-01' } }), /Type/);
    assert.match(validateDraftForPublish({ ...valid, tags: { type: 'open' } }), /Target NCC/);
});
