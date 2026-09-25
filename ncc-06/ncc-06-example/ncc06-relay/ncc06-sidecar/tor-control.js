import net from 'net';
import { once } from 'events';

export class TorControl {
  constructor({ host = '127.0.0.1', port = 9051, password, timeout = 5000 }) {
    this.host = host;
    this.port = port;
    this.password = password;
    this.timeout = timeout;
    this.socket = null;
    this.buffer = '';
    this.pending = null;
  }

  async connect() {
    if (this.socket) return;
    this.socket = net.connect({ host: this.host, port: this.port });
    this.socket.setEncoding('utf-8');
    this.socket.setTimeout(this.timeout);
    this.socket.on('timeout', () => {
      this.socket?.destroy(new Error('tor control connection timed out'));
    });
    this.socket.on('data', chunk => {
      this.buffer += chunk;
      this._processBuffer();
    });

    await once(this.socket, 'connect');
    await this._expectGreeting();
  }

  async authenticate() {
    const command = this.password ? `AUTHENTICATE "${this.password}"` : 'AUTHENTICATE';
    const response = await this.sendCommand(command);
    if (!response.ok) {
      throw new Error(`Tor control authentication failed: ${response.lines[0] ?? 'no response'}`);
    }
  }

  async addOnion(keySpec, portMapping) {
    const command = `ADD_ONION ${keySpec} Port=${portMapping}`;
    const response = await this.sendCommand(command);
    if (!response.ok) {
      throw new Error(`Tor control ADD_ONION failed: ${response.lines.join(' | ')}`);
    }
    return parseAddOnionResponse(response.lines);
  }

  sendCommand(command) {
    if (!this.socket) {
      return Promise.reject(new Error('Tor control socket not connected'));
    }
    if (this.pending) {
      return Promise.reject(new Error('A tor control command is already pending'));
    }
    this.pending = { resolve: null, reject: null };
    const promise = new Promise((resolve, reject) => {
      this.pending.resolve = resolve;
      this.pending.reject = reject;
    });
    this.socket.write(`${command}\r\n`);
    return promise;
  }

  _expectGreeting() {
    return new Promise((resolve, reject) => {
      const onData = () => {
        const { lines, rest } = extractLines(this.buffer);
        if (lines.length > 0) {
          this.buffer = rest;
          cleanup();
          resolve();
        }
      };
      const onError = err => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        this.socket?.off('data', onData);
        this.socket?.off('error', onError);
        this.socket?.off('close', onError);
      };
      this.socket?.on('data', onData);
      this.socket?.once('error', onError);
      this.socket?.once('close', () => onError(new Error('tor control socket closed')));
    });
  }

  _processBuffer() {
    if (!this.pending) return;
    const { lines, rest } = extractLines(this.buffer);
    this.buffer = rest;
    const completed = lines.find(line => /^\d{3} /.test(line));
    if (completed) {
      const responseLines = lines;
      this.pending.resolve({ lines: responseLines, ok: completed.startsWith('250') });
      this.pending = null;
    }
  }

  close() {
    this.socket?.destroy();
    this.socket = null;
    this.buffer = '';
    this.pending = null;
  }
}

function extractLines(buffer) {
  const parts = buffer.split('\r\n');
  const rest = parts.pop();
  return { lines: parts.filter(Boolean), rest };
}

function parseAddOnionResponse(lines) {
  const result = {};
  for (const line of lines) {
    const match = line.match(/^250[- ]([^=]+)=(.+)$/);
    if (match) {
      result[match[1]] = match[2];
    }
  }
  return result;
}
