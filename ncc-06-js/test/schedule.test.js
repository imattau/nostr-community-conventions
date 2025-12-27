import { strict as assert } from 'assert';
import { test } from 'node:test';
import { scheduleWithJitter } from '../src/schedule.js';

test('scheduleWithJitter bounds delay between 0 and base interval', () => {
  const values = [];
  for (let i = 0; i < 100; i++) {
    const delay = scheduleWithJitter(1000, 0.25);
    assert.ok(delay >= 0, 'delay should not be negative');
    assert.ok(delay <= 1000, 'delay should not exceed base interval');
    values.push(delay);
  }
  assert.ok(values.some(v => v < 1000), 'some jittered delays should be less than base');
});

test('scheduleWithJitter throws for invalid args', () => {
  assert.throws(() => scheduleWithJitter(-1), /non-negative number/);
  assert.throws(() => scheduleWithJitter(1000, -0.1), /non-negative number/);
});
