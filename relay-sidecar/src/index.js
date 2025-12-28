import { loadConfig } from './config.js';
import { loadState } from './state.js';
import { runPublishCycle, startScheduler } from './app.js';
import { buildInventory } from './inventory.js';

async function main() {
  const command = process.argv[2] || 'daemon';
  const config = loadConfig();
  const state = loadState(config.statePath);

  switch (command) {
    case 'daemon':
      console.log(`[Main] Starting NCC-06 Relay Sidecar in daemon mode.`);
      startScheduler(config, state);
      break;

    case 'publish':
      console.log(`[Main] Force publishing records...`);
      // Force publish by resetting the last publish timestamp in memory for this call
      await runPublishCycle(config, { ...state, last_full_publish_timestamp: 0 });
      process.exit(0);
      break;

    case 'status':
      console.log(`--- NCC-06 Sidecar Status ---`);
      console.log(`Identity: ${config.npub}`);
      console.log(`Service ID: ${config.serviceId}`);
      console.log(`Last NCC-02: ${state.last_published_ncc02_id || 'Never'}`);
      console.log(`Last Success:`);
      Object.entries(state.last_success_per_relay).forEach(([relay, res]) => {
        console.log(`  ${relay}: ${res.success ? 'OK' : 'FAIL (' + res.error + ')'} at ${new Date(res.timestamp).toISOString()}`);
      });
      process.exit(0);
      break;

    case 'inventory':
      console.log(`--- Effective Endpoints ---`);
      const inventory = await buildInventory(config.endpoints);
      console.table(inventory.map(ep => ({
        url: ep.url,
        family: ep.family,
        priority: ep.priority,
        k: ep.k ? `${ep.k.slice(0, 10)}...` : 'NONE'
      })));
      process.exit(0);
      break;

    default:
      console.log(`Unknown command: ${command}`);
      console.log(`Usage: relay-sidecar [daemon|publish|status|inventory]`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error(`Fatal Error: ${err.message}`);
  process.exit(1);
});
