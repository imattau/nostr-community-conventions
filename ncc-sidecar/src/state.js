import { readFileSync, writeFileSync } from 'fs';

export function loadState(statePath) {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch (err) {
    return {
      last_published_ncc02_id: null,
      last_published_ncc05_id: null,
      last_endpoints_hash: null,
      last_success_per_relay: {},
      last_full_publish_timestamp: 0
    };
  }
}

export function saveState(statePath, state) {
  writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
}
