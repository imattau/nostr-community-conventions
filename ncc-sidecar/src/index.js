import WebSocket from 'ws';
globalThis.WebSocket = WebSocket;

import { initDb, wipeDb } from './db/index.js';
import { isInitialized, getServices } from './db.js';
import { startWebServer } from './web.js';
import { startManager } from './app.js';

async function main() {
  const args = process.argv.slice(2);
  const isFirstRun = args.includes('--first-run');
  const command = args.find(a => !a.startsWith('--')) || 'daemon';
  
  // Initialize SQLite
  const dbPath = process.env.NCC_SIDECAR_DB_PATH || './sidecar.db';
  initDb(dbPath);

  if (isFirstRun) {
    console.log('[Main] --first-run detected. Wiping database...');
    wipeDb();
  }

  if (command === 'reset') {
    console.log('[Main] Resetting system to factory defaults...');
    wipeDb();
    console.log('[Main] Database wiped. All services and logs cleared.');
    process.exit(0);
  }

  if (command === 'status') {
    if (!isInitialized()) {
      console.log('Sidecar not initialized. Please complete setup via the web interface.');
      process.exit(0);
    }
    const services = getServices();
    console.log(`--- NCC Sidecar Status ---`);
    console.log(`Managed Services: ${services.length}`);
    services.forEach(s => {
      console.log(` - ${s.name} (${s.type}): ${s.status}`);
    });
    process.exit(0);
  }

  // Always start web server for admin UI
  const port = Number(process.env.ADMIN_PORT || 3000);
  
  let managerStarted = false;
  const startApp = () => {
    if (managerStarted) return;
    managerStarted = true;
    console.log(`[Main] Starting NCC Multi-Service Manager daemon.`);
    startManager(getServices);
  };

  await startWebServer(port, startApp);

  if (!isInitialized()) {
    console.log(`[Main] First-run setup required. Visit http://127.0.0.1:${port} to configure.`);
    return;
  }

  // Start background manager
  startApp();
}

main().catch(err => {
  console.error(`Fatal Error: ${err.message}`);
  process.exit(1);
});
