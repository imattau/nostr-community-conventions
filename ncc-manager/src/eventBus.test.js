import test from 'node:test';
import assert from 'node:assert';
import { eventBus } from './eventBus.js';

test('eventBus should allow subscribing and emitting events', () => {
    let callCount = 0;
    let lastPayload = null;

    const unsubscribe = eventBus.on('test-event', (payload) => {
        callCount++;
        lastPayload = payload;
    });

    eventBus.emit('test-event', { data: 123 });
    assert.strictEqual(callCount, 1);
    assert.deepStrictEqual(lastPayload, { data: 123 });

    eventBus.emit('test-event', { data: 456 });
    assert.strictEqual(callCount, 2);
    assert.deepStrictEqual(lastPayload, { data: 456 });

    unsubscribe();
    eventBus.emit('test-event', { data: 789 });
    assert.strictEqual(callCount, 2);
});

test('eventBus should handle multiple subscribers', () => {
    let call1 = 0;
    let call2 = 0;

    eventBus.on('multi', () => call1++);
    eventBus.on('multi', () => call2++);

    eventBus.emit('multi');
    assert.strictEqual(call1, 1);
    assert.strictEqual(call2, 1);
});
