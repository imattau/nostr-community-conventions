import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { createRelayServer } from '../lib/relay.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rawArgs = process.argv.slice(2);
const buildOnly = rawArgs.includes('--build-only');
const configCandidate = resolveConfigPath(rawArgs);
const configPath = path.resolve(process.cwd(), configCandidate);

if (buildOnly) {
  console.log('JavaScript relay does not require a build step.');
  process.exit(0);
}

let relayInstance;
let shuttingDown = false;

const run = async () => {
  const configPayload = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(configPayload);
  relayInstance = createRelayServer(config);
  await relayInstance.start();

  const host = config.relayHost || '127.0.0.1';
  const port = config.relayPort || 7000;
  console.log(`Relay listening on ws://${host}:${port}`);
  if (relayInstance.isWssEnabled()) {
    const wssPort = config.relayWssPort || 7447;
    console.log(`Relay listening on wss://${host}:${wssPort}`);
  }
};

run().catch(err => {
  console.error('Relay failed to start:', err);
  process.exit(1);
});

const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (relayInstance) {
    try {
      await relayInstance.stop();
    } catch (err) {
      console.error('Error while shutting down relay:', err);
    }
  }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function resolveConfigPath(args) {
  const configArgIndex = args.findIndex(arg => arg === '--config');
  if (configArgIndex !== -1 && args[configArgIndex + 1]) {
    return args[configArgIndex + 1];
  }

  const inlineArg = args.find(arg => arg.startsWith('--config='));
  if (inlineArg) {
    const [, inlineValue] = inlineArg.split('=');
    if (inlineValue) {
      return inlineValue;
    }
  }

  return path.resolve(__dirname, '..', 'config.json');
}
