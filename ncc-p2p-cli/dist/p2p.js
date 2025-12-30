"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.P2PNode = void 0;
const ws_1 = require("ws");
const nostr_tools_1 = require("nostr-tools");
const events_1 = require("events");
const socks_proxy_agent_1 = require("socks-proxy-agent");
var PeerStatus;
(function (PeerStatus) {
    PeerStatus["PENDING"] = "pending";
    PeerStatus["CONNECTED"] = "connected";
})(PeerStatus || (PeerStatus = {}));
class P2PNode extends events_1.EventEmitter {
    constructor(identity) {
        super();
        this.server = null;
        this.peers = new Map(); // Map npub -> ws
        this.peerStatus = new Map();
        this.port = 0;
        this.identity = identity;
    }
    async startServer(port = 0, host = '127.0.0.1') {
        return new Promise((resolve) => {
            this.server = new ws_1.WebSocketServer({ port, host });
            this.server.on('connection', (ws, req) => {
                this.handleConnection(ws, null, true); // Incoming
            });
            this.server.on('listening', () => {
                const address = this.server?.address();
                if (address && typeof address !== 'string') {
                    this.port = address.port;
                    resolve(this.port);
                }
            });
        });
    }
    async connectToPeer(address, targetPubkey, useTor = false) {
        let hexPubkey = targetPubkey;
        if (targetPubkey.startsWith('npub1')) {
            const decoded = nostr_tools_1.nip19.decode(targetPubkey);
            if (decoded.type === 'npub') {
                hexPubkey = decoded.data;
            }
        }
        let ws;
        let url = address;
        if (!url.includes('://')) {
            url = `ws://${url}`;
        }
        if (useTor || address.includes('.onion')) {
            const agent = new socks_proxy_agent_1.SocksProxyAgent('socks5h://127.0.0.1:9050');
            ws = new ws_1.WebSocket(url, { agent });
        }
        else {
            ws = new ws_1.WebSocket(url);
        }
        return new Promise((resolve, reject) => {
            ws.on('open', () => {
                this.handleConnection(ws, hexPubkey, false);
                resolve();
            });
            ws.on('error', (err) => {
                reject(err);
            });
        });
    }
    handleConnection(ws, targetPk, isIncoming) {
        let remotePubkey = targetPk;
        ws.on('message', (data) => {
            try {
                const rawString = data.toString();
                // Check for handshake FIRST (Plaintext)
                try {
                    const possibleHandshake = JSON.parse(rawString);
                    if (possibleHandshake.type === 'handshake' && possibleHandshake.pubkey) {
                        // Prevent self-connection
                        if (possibleHandshake.pubkey === this.identity.pk) {
                            ws.close();
                            return;
                        }
                        if (!remotePubkey) {
                            remotePubkey = possibleHandshake.pubkey;
                            this.peers.set(remotePubkey, ws);
                            this.peerStatus.set(remotePubkey, isIncoming ? PeerStatus.PENDING : PeerStatus.CONNECTED);
                            this.emit('peer:connected', { pubkey: remotePubkey, isIncoming });
                        }
                        return; // Handshake handled
                    }
                }
                catch { }
                if (!remotePubkey)
                    return;
                // IGNORE messages from pending peers (Protocol level enforcement)
                if (this.peerStatus.get(remotePubkey) === PeerStatus.PENDING) {
                    return;
                }
                const conversationKey = nostr_tools_1.nip44.getConversationKey(this.identity.sk, remotePubkey);
                const decrypted = nostr_tools_1.nip44.decrypt(rawString, conversationKey);
                const msg = JSON.parse(decrypted);
                this.emit('message', { from: remotePubkey, ...msg });
            }
            catch (e) {
                // console.error("Failed to process message:", e);
            }
        });
        ws.on('close', () => {
            if (remotePubkey) {
                this.peers.delete(remotePubkey);
                this.peerStatus.delete(remotePubkey);
                this.emit('peer:disconnected', remotePubkey);
            }
        });
        // Send handshake
        const handshake = JSON.stringify({ type: 'handshake', pubkey: this.identity.pk });
        ws.send(handshake);
        if (!isIncoming && remotePubkey) {
            this.peers.set(remotePubkey, ws);
            this.peerStatus.set(remotePubkey, PeerStatus.CONNECTED);
            this.emit('peer:connected', { pubkey: remotePubkey, isIncoming: false });
        }
    }
    acceptPeer(pubkey) {
        if (this.peers.has(pubkey)) {
            this.peerStatus.set(pubkey, PeerStatus.CONNECTED);
        }
    }
    sendMessage(targetPubkey, type, payload) {
        const ws = this.peers.get(targetPubkey);
        if (!ws)
            throw new Error("Not connected to peer");
        // Block sending if pending? Maybe not necessary but good practice.
        if (this.peerStatus.get(targetPubkey) !== PeerStatus.CONNECTED) {
            throw new Error("Peer is not accepted/connected");
        }
        const content = JSON.stringify({ type, payload });
        const conversationKey = nostr_tools_1.nip44.getConversationKey(this.identity.sk, targetPubkey);
        const ciphertext = nostr_tools_1.nip44.encrypt(content, conversationKey);
        ws.send(ciphertext);
    }
    broadcast(type, payload) {
        for (const [pk, ws] of this.peers) {
            if (this.peerStatus.get(pk) === PeerStatus.CONNECTED) {
                try {
                    this.sendMessage(pk, type, payload);
                }
                catch (e) { }
            }
        }
    }
    disconnectPeer(pubkey) {
        const ws = this.peers.get(pubkey);
        if (ws) {
            ws.close();
            this.peers.delete(pubkey);
            this.peerStatus.delete(pubkey);
            this.emit('peer:disconnected', pubkey);
        }
    }
}
exports.P2PNode = P2PNode;
