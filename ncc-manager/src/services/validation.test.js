import test from 'node:test';
import assert from 'node:assert';
import { validateDraftForPublish } from './validation.js';
import { KINDS } from '../state.js';

test('validateDraftForPublish() should require identifier', () => {
    const draft = { kind: KINDS.ncc };
    assert.strictEqual(validateDraftForPublish(draft), "NCC identifier (d tag) is required.");
});

test('validateDraftForPublish() should validate NCC fields', () => {
    const draft = { kind: KINDS.ncc, d: 'ncc-01' };
    assert.strictEqual(validateDraftForPublish(draft), "Title is required for NCC.");
    
    draft.title = 'Test';
    assert.strictEqual(validateDraftForPublish(draft), "Content is required for NCC.");
    
    draft.content = 'Content';
    assert.strictEqual(validateDraftForPublish(draft), "Version is required for NCC.");
    
    draft.tags = { version: '1' };
    assert.strictEqual(validateDraftForPublish(draft), null);
});

test('validateDraftForPublish() should validate NSR fields', () => {
    const draft = { kind: KINDS.nsr, d: 'ncc-01' };
    assert.strictEqual(validateDraftForPublish(draft), "Authoritative event ID is required for NSR.");
    
    draft.tags = { authoritative: 'short' };
    assert.strictEqual(validateDraftForPublish(draft), "Reason is required for NSR.");
    
    draft.tags.reason = 'Testing';
    assert.strictEqual(validateDraftForPublish(draft), "Invalid Authoritative event ID format.");
    
    draft.tags.authoritative = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    assert.strictEqual(validateDraftForPublish(draft), null);
});
