import test from 'node:test';
import assert from 'node:assert';
import { stateManager } from './stateManager.js';

test('stateManager should initialize with default state', () => {
  const state = stateManager.getState();
  assert.strictEqual(state.theme, 'power');
  assert.ok(state.uiRefreshId > 0);
});

test('updateState should update the state and notify subscribers', () => {
  let subCalls = 0;
  let lastState = null;

  const unsubscribe = stateManager.subscribe((state) => {
    subCalls++;
    lastState = state;
  });

  stateManager.updateState({ theme: 'vscode', testProp: 123 });

  const currentState = stateManager.getState();
  assert.strictEqual(currentState.theme, 'vscode');
  assert.strictEqual(currentState.testProp, 123);
  
  // Verify subscription
  assert.strictEqual(subCalls, 1);
  assert.strictEqual(lastState.theme, 'vscode');

  unsubscribe();
});

test('subscribe should return an unsubscribe function', () => {
  let subCalls = 0;
  const unsubscribe = stateManager.subscribe(() => {
    subCalls++;
  });

  stateManager.updateState({ a: 1 });
  assert.strictEqual(subCalls, 1);

  unsubscribe();
  stateManager.updateState({ a: 2 });
  assert.strictEqual(subCalls, 1, 'Subscriber should not be called after unsubscribe');
});
