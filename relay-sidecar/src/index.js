import WebSocket from 'ws';
globalThis.WebSocket = WebSocket;

import { initDb, isInitialized, getConfig, setState, getState } from './db.js';
import { startWebServer } from './web.js';
import { startScheduler } from './app.js';
import { buildInventory } from './inventory.js';
import { fromNsec } from 'ncc-06-js';
import { getPublicKey } from 'nostr-tools/pure';

async function main() {
  const command = process.argv[2] || 'daemon';
  
  // Initialize SQLite
  initDb('./sidecar.db');

  if (command === 'status') {
    if (!isInitialized()) {
      console.log('Sidecar not initialized. Please complete setup via the web interface.');
      process.exit(0);
    }
    const admin = getConfig('admin_pubkey');
    const appConfig = getConfig('app_config');
    console.log(`--- NCC-06 Sidecar Status ---`);
    console.log(`Admin: ${admin}`);
    console.log(`Service Config: ${JSON.stringify(appConfig, null, 2)}`);
    process.exit(0);
  }

  // Always start web server for admin UI
  const port = Number(process.env.ADMIN_PORT || 3000);
  await startWebServer(port);

  if (!isInitialized()) {
    console.log(`[Main] First-run setup required. Visit http://127.0.0.1:${port} to configure.`);
    return; // Wait for user to complete setup
  }

  const appConfig = getConfig('app_config');
  const serviceNsec = getConfig('service_nsec');
  
  const fullConfig = {
    ...appConfig,
    secretKey: fromNsec(serviceNsec),
    publicKey: getPublicKey(fromNsec(serviceNsec)),
    statePath: './sidecar.db' // Not used as much now with direct DB calls
  };

  if (command === 'daemon') {
    console.log(`[Main] Starting NCC-06 Relay Sidecar daemon.`);
    // Note: We'll need to adapt app.js to use DB for state instead of JSON file
    // But for MVP we can keep passing a state object and persist it.
    const state = getState('app_state', {
      last_published_ncc02_id: null,
      last_endpoints_hash: null,
      last_success_per_relay: {},
      last_full_publish_timestamp: 0
    });
    
    startScheduler(fullConfig, state);
  }
}

main().catch(err => {
  console.error(`Fatal Error: ${err.message}`);
  process.exit(1);
});