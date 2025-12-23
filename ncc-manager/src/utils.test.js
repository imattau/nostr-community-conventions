import test from 'node:test';
import assert from 'node:assert';
import { 
    esc, 
    shortenKey, 
    stripNccNumber, 
    buildNccIdentifier, 
    incrementVersion,
    suggestNextNccNumber,
    normalizeEventId
} from './utils.js';

test('esc() should escape HTML characters', () => {
    assert.strictEqual(esc('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
});

test('shortenKey() should truncate long strings', () => {
    const longKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    assert.strictEqual(shortenKey(longKey, 4, 4), '0123…cdef');
    assert.strictEqual(shortenKey('short', 4, 4), 'short');
});

test('stripNccNumber() should extract only digits', () => {
    assert.strictEqual(stripNccNumber('ncc-01'), '01');
    assert.strictEqual(stripNccNumber('NCC-42'), '42');
    assert.strictEqual(stripNccNumber('abc123def'), '123');
    assert.strictEqual(stripNccNumber(''), '');
});

test('buildNccIdentifier() should format as ncc-XX', () => {
    assert.strictEqual(buildNccIdentifier('1'), 'ncc-1');
    assert.strictEqual(buildNccIdentifier('ncc-05'), 'ncc-05');
});

test('incrementVersion() should handle numeric increments', () => {
    assert.strictEqual(incrementVersion('1'), '2');
    assert.strictEqual(incrementVersion('v1'), 'v2');
    assert.strictEqual(incrementVersion('0.1'), '0.2');
    assert.strictEqual(incrementVersion(''), '1');
    assert.strictEqual(incrementVersion('abc'), 'abc');
});

test('suggestNextNccNumber() should find the next available number', () => {
    const docs = [
        { tags: [['d', 'ncc-01']] },
        { tags: [['d', 'ncc-05']] },
        { tags: [['d', 'ncc-03']] }
    ];
    assert.strictEqual(suggestNextNccNumber(docs), '06');
    assert.strictEqual(suggestNextNccNumber([]), '01');
});

test('normalizeEventId() should remove event: prefix', () => {
    assert.strictEqual(normalizeEventId('event:abc123'), 'abc123');
    assert.strictEqual(normalizeEventId('ABC123'), 'abc123');
});
