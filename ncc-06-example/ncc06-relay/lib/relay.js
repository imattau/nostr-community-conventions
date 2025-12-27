import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';

import WebSocket, { WebSocketServer } from 'ws';
import { validateEvent } from 'nostr-tools/pure';

import {
  createEventMessage,
  createEoseMessage,
  createNoticeMessage,
  createOkMessage,
  serializeNostrMessage
} from './protocol.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_WS_PORT = 7000;
const DEFAULT_WSS_PORT = 7447;

const log = (...items) => console.log('[Relay]', ...items);

class EventStore {
  constructor() {
    this.events = new Map();
  }

  add(event) {
    if (!event || !event.id || !event.pubkey) {
      return { id: event?.id || '', accepted: false, message: 'invalid: missing id or pubkey' };
    }
    if (this.events.has(event.id)) {
      return { id: event.id, accepted: true, message: 'duplicate: event already exists' };
    }
    this.events.set(event.id, event);
    return { id: event.id, accepted: true, message: 'stored' };
  }

  query(filters) {
    if (!filters || filters.length === 0) {
      return this.allEvents();
    }

    const matched = new Map();
    for (const event of this.events.values()) {
      for (const filter of filters) {
        if (matchesFilter(filter, event)) {
          matched.set(event.id, event);
          break;
        }
      }
    }

    const result = [...matched.values()];
    result.sort((a, b) => (toNumber(a.created_at) || 0) - (toNumber(b.created_at) || 0));
    return result.reverse();
  }

  allEvents() {
    const result = [...this.events.values()];
    result.sort((a, b) => (toNumber(b.created_at) || 0) - (toNumber(a.created_at) || 0));
    return result;
  }
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.subscriptions = new Map();
  }

  send(payload) {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(serializeNostrMessage(payload));
    } catch (err) {
      log('Failed to send message to client:', err.message);
    }
  }

  setSubscription(subId, filters) {
    if (!filters || filters.length === 0) {
      this.subscriptions.delete(subId);
      return;
    }
    this.subscriptions.set(subId, filters);
  }

  clearSubscription(subId) {
    this.subscriptions.delete(subId);
  }

  matchingSubscriptions(event) {
    const matches = [];
    for (const [subId, filters] of this.subscriptions.entries()) {
      for (const filter of filters) {
        if (matchesFilter(filter, event)) {
          matches.push(subId);
          break;
        }
      }
    }
    return matches;
  }
}

export class RelayServer {
  constructor(config = {}) {
    this.config = config;
    this.store = new EventStore();
    this.clients = new Set();
    this.host = config.relayHost || DEFAULT_HOST;
    this.port = config.relayPort || DEFAULT_WS_PORT;
    this.wssPort = config.relayWssPort || DEFAULT_WSS_PORT;
    this.bindHost = config.relayBindHost || this.host;
    this.bindWssHost = config.relayWssBindHost || this.bindHost;
    this.tlsKey = config.relayTlsKey;
    this.tlsCert = config.relayTlsCert;
    this.tlsEnabled = Boolean(this.tlsKey && this.tlsCert);
    this.httpServer = null;
    this.httpsServer = null;
    this.wsServer = null;
    this.wssServer = null;
  }

  async start() {
    await this.startWs();
    if (this.tlsEnabled) {
      try {
        await this.startWss();
      } catch (err) {
        log('Secure relay interface could not start:', err.message);
      }
    }
  }

  async stop() {
    await Promise.all([
      this.closeWebSocketServer(this.wsServer, this.httpServer),
      this.closeWebSocketServer(this.wssServer, this.httpsServer)
    ]);
    for (const session of this.clients) {
      session.ws.close();
    }
    this.clients.clear();
  }

  isWssEnabled() {
    return Boolean(this.wssServer);
  }

  startWs() {
    if (this.wsServer) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => {
        res.writeHead(404);
        res.end('Nostr relay only');
      });
      this.wsServer = new WebSocketServer({ server: this.httpServer });
      this.wsServer.on('connection', ws => this.handleConnection(ws));
      this.wsServer.on('error', err => log('WebSocket error:', err.message));
      this.httpServer.once('error', err => reject(err));
      this.httpServer.once('listening', () => resolve());
      this.httpServer.listen(this.port, this.bindHost);
    });
  }

  startWss() {
    const resolvedKey = path.resolve(process.cwd(), this.tlsKey);
    const resolvedCert = path.resolve(process.cwd(), this.tlsCert);
    let credentials;
    try {
      credentials = {
        key: fs.readFileSync(resolvedKey),
        cert: fs.readFileSync(resolvedCert)
      };
    } catch (err) {
      log('Failed to load TLS credentials:', err.message);
      this.tlsEnabled = false;
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      this.httpsServer = https.createServer(credentials);
      this.wssServer = new WebSocketServer({ server: this.httpsServer });
      this.wssServer.on('connection', ws => this.handleConnection(ws));
      this.wssServer.on('error', err => log('WSS error:', err.message));
      this.httpsServer.once('error', err => reject(err));
      this.httpsServer.once('listening', () => resolve());
      this.httpsServer.listen(this.wssPort, this.bindWssHost);
      this.tlsEnabled = true;
    });
  }

  async closeWebSocketServer(wsServer, httpServer) {
    if (wsServer) {
      wsServer.removeAllListeners();
      wsServer.close();
    }
    if (httpServer) {
      await new Promise(resolve => httpServer.close(() => resolve()));
    }
  }

  handleConnection(ws) {
    const session = new Session(ws);
    this.clients.add(session);
    ws.on('message', message => this.handleMessage(session, message));
    ws.on('close', () => {
      this.clients.delete(session);
    });
    ws.on('error', err => {
      log('Client socket error:', err.message);
    });
  }

  handleMessage(session, raw) {
    let data;
    try {
      const payload = typeof raw === 'string' ? raw : raw.toString('utf-8');
      data = JSON.parse(payload);
    } catch (err) {
      session.send(createNoticeMessage('invalid message format'));
      return;
    }

    if (!Array.isArray(data) || data.length === 0) {
      session.send(createNoticeMessage('invalid message format'));
      return;
    }

    const [messageType, ...payload] = data;
    if (typeof messageType !== 'string') {
      session.send(createNoticeMessage('malformed message type'));
      return;
    }

    switch (messageType) {
      case 'EVENT':
        this.handleEventMessage(session, payload[0]);
        break;
      case 'REQ':
        this.handleReqMessage(session, payload);
        break;
      case 'CLOSE':
        this.handleCloseMessage(session, payload[0]);
        break;
      default:
        session.send(createNoticeMessage(`unknown message type: ${messageType}`));
    }
  }

  handleEventMessage(session, event) {
    if (!event || typeof event !== 'object') {
      session.send(createNoticeMessage('EVENT missing payload'));
      return;
    }

    const eventId = typeof event.id === 'string' ? event.id : '';
    try {
      validateEvent(event);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      session.send(createOkMessage(eventId, false, `invalid: ${message}`));
      return;
    }

    const result = this.store.add(event);
    session.send(createOkMessage(result.id, result.accepted, result.message));
    if (result.accepted && result.message === 'stored') {
      log(`Stored event ${event.id} (kind ${event.kind})`);
      this.broadcastEvent(event);
    }
  }

  handleReqMessage(session, payload) {
    if (!payload || payload.length === 0) {
      session.send(createNoticeMessage('REQ missing subId or filters'));
      return;
    }

    const [subId, ...rawFilters] = payload;
    if (typeof subId !== 'string' || subId.trim() === '') {
      session.send(createNoticeMessage('invalid subscription id'));
      return;
    }

    const filters = normalizeFilters(rawFilters);
    session.setSubscription(subId, filters);
    this.deliverStoredEvents(session, subId, filters);
  }

  handleCloseMessage(session, subId) {
    if (typeof subId !== 'string' || subId.trim() === '') return;
    session.clearSubscription(subId);
  }

  deliverStoredEvents(session, subId, filters) {
    const events = this.store.query(filters);
    for (const event of events) {
      session.send(createEventMessage(subId, event));
    }
    session.send(createEoseMessage(subId));
  }

  broadcastEvent(event) {
    for (const session of this.clients) {
      const matchingSubs = session.matchingSubscriptions(event);
      for (const subId of matchingSubs) {
        session.send(createEventMessage(subId, event));
      }
    }
  }
}

export function createRelayServer(config) {
  return new RelayServer(config);
}

function normalizeFilters(rawFilters) {
  if (!Array.isArray(rawFilters)) {
    rawFilters = [];
  }
  const normalized = [];
  for (const raw of rawFilters) {
    const parsed = normalizeFilter(raw);
    if (parsed) {
      normalized.push(parsed);
    }
  }
  if (normalized.length === 0 && rawFilters.length === 0) {
    normalized.push(createEmptyFilter());
  }
  if (normalized.length === 0 && rawFilters.length > 0) {
    normalized.push(createEmptyFilter());
  }
  return normalized;
}

function createEmptyFilter() {
  return { tags: {} };
}

function normalizeFilter(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const normalized = { tags: {} };
  if (raw.ids) {
    normalized.ids = toLowerStringArray(raw.ids);
  }
  if (raw.authors) {
    normalized.authors = toLowerStringArray(raw.authors);
  }
  if (raw.kinds) {
    normalized.kinds = toNumberArray(raw.kinds);
  }
  if (raw.since !== undefined) {
    const value = toNumber(raw.since);
    if (!Number.isNaN(value)) {
      normalized.since = value;
    }
  }
  if (raw.until !== undefined) {
    const value = toNumber(raw.until);
    if (!Number.isNaN(value)) {
      normalized.until = value;
    }
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith('#')) {
      continue;
    }
    const tagName = key.slice(1);
    const tagValues = toStringArray(value);
    normalized.tags[tagName] = tagValues;
  }
  return normalized;
}

function matchesFilter(filter, event) {
  if (!filter) {
    return true;
  }
  if (filter.ids?.length) {
    const id = (event.id || '').toLowerCase();
    if (!filter.ids.includes(id)) {
      return false;
    }
  }
  if (filter.kinds?.length) {
    if (!filter.kinds.includes(event.kind)) {
      return false;
    }
  }
  if (filter.authors?.length) {
    const author = (event.pubkey || '').toLowerCase();
    if (!filter.authors.includes(author)) {
      return false;
    }
  }
  if (filter.since !== undefined) {
    if ((event.created_at || 0) < filter.since) {
      return false;
    }
  }
  if (filter.until !== undefined) {
    if ((event.created_at || 0) > filter.until) {
      return false;
    }
  }
  for (const [tagName, tagValues] of Object.entries(filter.tags || {})) {
    if (!eventHasTag(event, tagName, tagValues || [])) {
      return false;
    }
  }
  return true;
}

function eventHasTag(event, name, values) {
  const tags = Array.isArray(event.tags) ? event.tags : [];
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag.length < 2) {
      continue;
    }
    if (tag[0] !== name) {
      continue;
    }
    if (!values || values.length === 0) {
      return true;
    }
    if (values.includes(String(tag[1]))) {
      return true;
    }
  }
  return false;
}

function toNumber(value) {
  return Number(value ?? 0);
}

function toNumberArray(value) {
  return toStringArray(value).map(item => Number(item)).filter(item => !Number.isNaN(item));
}

function toStringArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map(item => String(item));
  }
  return [String(value)];
}

function toLowerStringArray(value) {
  return toStringArray(value).map(item => item.toLowerCase());
}
