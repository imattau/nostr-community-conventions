"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TorController = void 0;
const net = __importStar(require("net"));
class TorController {
    constructor(host = '127.0.0.1', port = 9051) {
        this.connected = false;
        this.controlPort = 9051;
        this.host = '127.0.0.1';
        this.host = host;
        this.controlPort = port;
        this.socket = new net.Socket();
    }
    async connect() {
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
    async sendCommand(cmd) {
        return new Promise((resolve, reject) => {
            if (!this.connected)
                return reject(new Error("Not connected to Tor"));
            const onData = (data) => {
                const response = data.toString();
                this.socket.removeListener('data', onData);
                resolve(response);
            };
            this.socket.on('data', onData);
            this.socket.write(cmd + '\r\n');
        });
    }
    async authenticate() {
        if (!this.connected)
            return false;
        // Try standard authentication (magic cookie or none)
        try {
            let res = await this.sendCommand('AUTHENTICATE ""');
            if (res.startsWith('250'))
                return true;
            // If failed, maybe we need to read the cookie file?
            // For now, simple support.
            return false;
        }
        catch (e) {
            return false;
        }
    }
    /**
     * Creates an ephemeral onion service mapping onionPort -> localPort
     */
    async createOnionService(localPort, onionPort = 80) {
        if (!this.connected)
            return null;
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
exports.TorController = TorController;
