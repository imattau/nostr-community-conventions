// test/helpers.js
import { spawn } from 'child_process';
import WebSocket from 'ws';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { parseNostrMessage, serializeNostrMessage, createReqMessage } from '../lib/protocol.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootConfigPath = path.resolve(__dirname, '../config.json');
const rootConfig = JSON.parse(readFileSync(rootConfigPath, 'utf-8'));

const RELAY_PORT = rootConfig.relayPort || 7000;
const RELAY_URL = `ws://127.0.0.1:${RELAY_PORT}`;

let relayProcess = null;

export const startRelay = async () => {
  return new Promise((resolve, reject) => {
    relayProcess = spawn('node', ['scripts/run-relay.js'], {
      cwd: path.resolve(__dirname, '..'), // Run from the ncc06-relay root
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true // Allows the relay to run independently
    });

    relayProcess.stdout.on('data', data => {
      process.stdout.write(`[Relay STDOUT] ${data}`);
      if (data.toString().includes(`Relay listening on ws://127.0.0.1:${RELAY_PORT}`)) {
        resolve(true);
      }
    });

    relayProcess.stderr.on('data', data => {
      process.stderr.write(`[Relay STDERR] ${data}`);
      if (data.toString().includes('error')) {
          reject(new Error(`Relay startup error: ${data.toString()}`));
      }
    });

    relayProcess.on('error', err => {
      console.error(`Failed to start relay process: ${err}`);
      reject(err);
    });

    relayProcess.on('close', code => {
      console.log(`Relay process exited with code ${code}`);
      if (code !== 0) {
        reject(new Error(`Relay process exited with non-zero code: ${code}`));
      }
    });
    console.log(`Attempting to start relay on port ${RELAY_PORT}...`);
  });
};

export const stopRelay = () => {
  if (relayProcess && !relayProcess.killed) {
    console.log('Stopping relay process...');
    try {
      process.kill(-relayProcess.pid, 'SIGTERM'); // Kill the process group
    } catch (err) {
      if (err.code !== 'ESRCH') {
        console.error('Error stopping relay process:', err);
      }
    }
    relayProcess = null;
  }
};

/**
 * Connects to the relay and sends a REQ message, collecting events until EOSE.
 * @param {Array<object>} filters - Array of Nostr filters.
 * @param {string} relayUrl - URL of the relay.
 * @returns {Promise<Array<object>>} - Promise resolving to an array of received events.
 */
export const queryRelay = (filters, relayUrl = RELAY_URL) => {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrl);
    const events = [];
    const subId = 'test-query-' + Math.random().toString().slice(2, 6); // Unique subscription ID

    ws.onopen = () => {
      ws.send(serializeNostrMessage(createReqMessage(subId, ...filters)));
    };

    ws.onmessage = message => {
      const nostrMessage = parseNostrMessage(message.data.toString());
      if (!nostrMessage) return;

      if (nostrMessage[0] === 'EVENT') {
        events.push(nostrMessage[2]); // [ "EVENT", <subId>, <event> ]
      } else if (nostrMessage[0] === 'EOSE') {
        if (nostrMessage[1] === subId) {
          ws.close();
          resolve(events);
        }
      } else if (nostrMessage[0] === 'NOTICE') {
          console.log(`[Relay NOTICE] ${nostrMessage[1]}`);
      }
    };

    ws.onerror = err => {
      console.error('WebSocket error in queryRelay:', err);
      reject(err);
    };

    ws.onclose = () => {
      // console.log('Query relay connection closed.');
    };
  });
};

export const RELAY_CONSTANTS = {
    URL: RELAY_URL,
    PORT: RELAY_PORT
};

// Ensure relay process is stopped on exit
process.on('exit', stopRelay);
process.on('SIGINT', () => { stopRelay(); process.exit(); });
process.on('SIGTERM', () => { stopRelay(); process.exit(); });
process.on('uncaughtException', err => {
    console.error('Uncaught exception:', err);
    stopRelay();
    process.exit(1);
});
