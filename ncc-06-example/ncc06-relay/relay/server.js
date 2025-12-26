// relay/server.js
import WebSocket, { WebSocketServer } from 'ws';
import https from 'https';
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

const HOST = config.relayHost || '127.0.0.1';
const WS_PORT = config.relayPort || 7000;
const WSS_PORT = config.relayWssPort || 7447;
const projectRoot = path.resolve(__dirname, '..');
const tlsKeyPath = config.relayTlsKey ? path.resolve(projectRoot, config.relayTlsKey) : null;
const tlsCertPath = config.relayTlsCert ? path.resolve(projectRoot, config.relayTlsCert) : null;

const wsServer = new WebSocketServer({ port: WS_PORT, host: HOST });
let wssServer = null;
let httpsServer = null;

if (tlsKeyPath && tlsCertPath) {
  try {
    const tlsOptions = {
      key: readFileSync(tlsKeyPath),
      cert: readFileSync(tlsCertPath),
    };
    httpsServer = https.createServer(tlsOptions);
    wssServer = new WebSocketServer({ server: httpsServer });
    httpsServer.listen(WSS_PORT, HOST, () => {
      console.log(`Nostr Relay is running on wss://${HOST}:${WSS_PORT}`);
    });
    httpsServer.on('error', error => {
      console.error('HTTPS server error:', error);
    });
    wssServer.on('error', error => {
      console.error('WSS server error:', error);
    });
  } catch (error) {
    console.error('Failed to start wss interface:', error);
  }
} else {
  console.warn('TLS configuration missing; WSS interface disabled.');
}

console.log(`Nostr Relay starting on ws://${HOST}:${WS_PORT}`);

// Track all active client connections and their subscriptions.
const activeSubscriptions = new Map();
const connectedClients = new Set();

function notifySubscribers(event, eventId) {
  connectedClients.forEach(client => {
    if (client.readyState !== WebSocket.OPEN) return;
    const clientSubscriptions = activeSubscriptions.get(client);
    if (!clientSubscriptions) return;
    for (const [subId, filters] of clientSubscriptions.entries()) {
      const matchingEvents = eventStore.queryEvents(filters).filter(e => e.id === eventId);
      if (matchingEvents.length > 0) {
        client.send(serializeNostrMessage(createEventMessage(subId, event)));
      }
    }
  });
}

function handleConnection(ws) {
  console.log('Client connected');
  connectedClients.add(ws);
  activeSubscriptions.set(ws, new Map());

  ws.on('message', message => {
    const nostrMessage = parseNostrMessage(message.toString());

    if (!nostrMessage) {
      ws.send(serializeNostrMessage(createNoticeMessage('Invalid message format')));
      return;
    }

    const [type, ...payload] = nostrMessage;

    switch (type) {
      case 'EVENT': {
        const [event] = payload;
        const [eventId, accepted, msg] = eventStore.addEvent(event);
        ws.send(serializeNostrMessage(createOkMessage(eventId, accepted, msg)));
        if (accepted && msg === 'stored') {
          notifySubscribers(event, eventId);
        }
        break;
      }

      case 'REQ': {
        const [subId, ...filters] = payload;
        const subscriptions = activeSubscriptions.get(ws);
        if (subscriptions) {
          subscriptions.set(subId, filters);
        }

        const matchingEvents = eventStore.queryEvents(filters);
        matchingEvents.forEach(event => {
          ws.send(serializeNostrMessage(createEventMessage(subId, event)));
        });
        ws.send(serializeNostrMessage(createEoseMessage(subId)));
        break;
      }

      case 'CLOSE': {
        const [closeSubId] = payload;
        const subscriptions = activeSubscriptions.get(ws);
        subscriptions?.delete(closeSubId);
        break;
      }

      default:
        ws.send(serializeNostrMessage(createNoticeMessage(`Unknown message type: ${type}`)));
        break;
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    activeSubscriptions.delete(ws);
    connectedClients.delete(ws);
  });

  ws.on('error', error => {
    console.error('WebSocket error:', error);
  });
}

wsServer.on('connection', handleConnection);

wsServer.on('listening', () => {
  console.log(`Nostr Relay is listening on port ${WS_PORT}`);
});

wsServer.on('error', error => {
  console.error('WebSocket server error:', error);
});

if (wssServer) {
  wssServer.on('connection', handleConnection);
  wssServer.on('listening', () => {
    console.log(`WSS server listening on port ${WSS_PORT}`);
  });
}
