// relay/server.js
import { WebSocketServer } from 'ws';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { eventStore } from './store.js';
import {
  parseNostrMessage,
  serializeNostrMessage,
  createOkMessage,
  createEoseMessage,
  createEventMessage,
  createNoticeMessage,
} from './protocol.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configPath = path.resolve(__dirname, '../config.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));

const PORT = config.relayPort || 7000;
const HOST = config.relayHost || '127.0.0.1';
const wss = new WebSocketServer({ port: PORT, host: HOST });

console.log(`Nostr Relay starting on ws://${HOST}:${PORT}`);

// Active subscriptions map: Map<WebSocket, Map<subId, Filter[]>>
const activeSubscriptions = new Map();

wss.on('connection', ws => {
  console.log('Client connected');
  activeSubscriptions.set(ws, new Map()); // Initialize subscriptions for this client

  ws.on('message', message => {
    const nostrMessage = parseNostrMessage(message.toString());

    if (!nostrMessage) {
      ws.send(serializeNostrMessage(createNoticeMessage("Invalid message format")));
      return;
    }

    const [type, ...payload] = nostrMessage;

    switch (type) {
      case 'EVENT':
        const [event] = payload;
        const [eventId, accepted, msg] = eventStore.addEvent(event);
        ws.send(serializeNostrMessage(createOkMessage(eventId, accepted, msg)));
        if (accepted && msg === "stored") {
          // Notify all active subscribers that match the new event
          wss.clients.forEach(client => {
            if (client.readyState === ws.OPEN) {
              const clientSubscriptions = activeSubscriptions.get(client);
              if (clientSubscriptions) {
                for (const [subId, filters] of clientSubscriptions.entries()) {
                  const matchingEvents = eventStore.queryEvents(filters).filter(e => e.id === eventId);
                  if (matchingEvents.length > 0) {
                    client.send(serializeNostrMessage(createEventMessage(subId, event)));
                  }
                }
              }
            }
          });
        }
        break;

      case 'REQ':
        const [subId, ...filters] = payload;
        activeSubscriptions.get(ws).set(subId, filters); // Store subscription for future events

        const matchingEvents = eventStore.queryEvents(filters);
        matchingEvents.forEach(event => {
          ws.send(serializeNostrMessage(createEventMessage(subId, event)));
        });
        ws.send(serializeNostrMessage(createEoseMessage(subId)));
        break;

      case 'CLOSE':
        const [closeSubId] = payload;
        activeSubscriptions.get(ws).delete(closeSubId);
        break;

      default:
        ws.send(serializeNostrMessage(createNoticeMessage(`Unknown message type: ${type}`)));
        break;
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    activeSubscriptions.delete(ws); // Clean up subscriptions for disconnected client
  });

  ws.on('error', error => {
    console.error('WebSocket error:', error);
  });
});

wss.on('listening', () => {
  console.log(`Nostr Relay is listening on port ${PORT}`);
});

wss.on('error', error => {
  console.error('WebSocket server error:', error);
});
