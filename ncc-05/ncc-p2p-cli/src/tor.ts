import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';

export class TorController {
    private socket: net.Socket;
    private connected: boolean = false;
    private controlPort: number = 9051;
    private host: string = '127.0.0.1';

    constructor(host: string = '127.0.0.1', port: number = 9051) {
        this.host = host;
        this.controlPort = port;
        this.socket = new net.Socket();
    }

    async connect(): Promise<boolean> {
        return new Promise((resolve) => {
            this.socket.connect(this.controlPort, this.host, () => {
                this.connected = true;
                resolve(true);
            });

            this.socket.on('error', (err) => {
                // console.error('Tor Control connection error:', err.message);
                resolve(false);
            });
        });
    }

    private async sendCommand(cmd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            if (!this.connected) return reject(new Error("Not connected to Tor"));

            const onData = (data: Buffer) => {
                const response = data.toString();
                this.socket.removeListener('data', onData);
                resolve(response);
            };

            this.socket.on('data', onData);
            this.socket.write(cmd + '\r\n');
        });
    }

    async authenticate(): Promise<boolean> {
        if (!this.connected) return false;

        // Try standard authentication (magic cookie or none)
        try {
            let res = await this.sendCommand('AUTHENTICATE ""');
            if (res.startsWith('250')) return true;
            
            // If failed, maybe we need to read the cookie file?
            // For now, simple support.
            return false;
        } catch (e) {
            return false;
        }
    }

    /**
     * Creates an ephemeral onion service mapping onionPort -> localPort
     */
    async createOnionService(localPort: number, onionPort: number = 80): Promise<string | null> {
        if (!this.connected) return null;

        // NEW:BEST is the algorithm, Port mapping is 'Port=80,127.0.0.1:localPort'
        const cmd = `ADD_ONION NEW:BEST Port=${onionPort},127.0.0.1:${localPort}`;
        const res = await this.sendCommand(cmd);

        // Response format:
        // 250-ServiceID=...
        // 250 OK
        if (res.includes('250-ServiceID=')) {
            const match = res.match(/ServiceID=([a-z0-9]+)/);
            if (match && match[1]) {
                return `${match[1]}.onion`;
            }
        }
        return null;
    }

    close() {
        if (this.connected) {
            this.socket.end();
            this.connected = false;
        }
    }
}
