import { WebSocketServer, WebSocket } from 'ws';
import { nip44, nip19 } from 'nostr-tools';
import { Identity } from './identity.js';
import { EventEmitter } from 'events';
import { IncomingMessage } from 'http';
import { SocksProxyAgent } from 'socks-proxy-agent';

export interface PeerMessage {
    type: string;
    payload: any;
}

enum PeerStatus {
    PENDING = 'pending',
    CONNECTED = 'connected'
}

export class P2PNode extends EventEmitter {
    private server: WebSocketServer | null = null;
    private peers: Map<string, WebSocket> = new Map(); // Map npub -> ws
    private peerStatus: Map<string, PeerStatus> = new Map();
    private identity: Identity;
    public port: number = 0;

    constructor(identity: Identity) {
        super();
        this.identity = identity;
    }

    async startServer(port: number = 0, host: string = '127.0.0.1'): Promise<number> {
        return new Promise((resolve) => {
            this.server = new WebSocketServer({ port, host });
            this.server.on('connection', (ws: WebSocket, req: IncomingMessage) => {
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

    async connectToPeer(address: string, targetPubkey: string, useTor: boolean = false) {
        let hexPubkey = targetPubkey;
        if (targetPubkey.startsWith('npub1')) {
            const decoded = nip19.decode(targetPubkey);
            if (decoded.type === 'npub') {
                hexPubkey = decoded.data as string;
            }
        }

        let ws: WebSocket;
        
        let url = address;
        if (!url.includes('://')) {
            url = `ws://${url}`;
        }

        if (useTor || address.includes('.onion')) {
            const agent = new SocksProxyAgent('socks5h://127.0.0.1:9050');
            ws = new WebSocket(url, { agent });
        } else {
            ws = new WebSocket(url);
        }

        return new Promise<void>((resolve, reject) => {
            ws.on('open', () => {
                this.handleConnection(ws, hexPubkey, false);
                resolve();
            });
            ws.on('error', (err) => {
                reject(err);
            });
        });
    }

    private handleConnection(ws: WebSocket, targetPk: string | null, isIncoming: boolean) {
        let remotePubkey = targetPk;

        ws.on('message', (data: Buffer) => {
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
                             remotePubkey = possibleHandshake.pubkey!;
                             this.peers.set(remotePubkey!, ws);
                             this.peerStatus.set(remotePubkey!, isIncoming ? PeerStatus.PENDING : PeerStatus.CONNECTED);
                             this.emit('peer:connected', { pubkey: remotePubkey, isIncoming });
                         }
                         return; // Handshake handled
                     }
                } catch {}
                
                if (!remotePubkey) return;
                
                // IGNORE messages from pending peers (Protocol level enforcement)
                if (this.peerStatus.get(remotePubkey) === PeerStatus.PENDING) {
                    return; 
                }

                const conversationKey = nip44.getConversationKey(this.identity.sk, remotePubkey);
                const decrypted = nip44.decrypt(rawString, conversationKey);
                const msg: PeerMessage = JSON.parse(decrypted);
                
                this.emit('message', { from: remotePubkey, ...msg });
            } catch (e) {
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

    acceptPeer(pubkey: string) {
        if (this.peers.has(pubkey)) {
            this.peerStatus.set(pubkey, PeerStatus.CONNECTED);
        }
    }

    sendMessage(targetPubkey: string, type: string, payload: any) {
        const ws = this.peers.get(targetPubkey);
        if (!ws) throw new Error("Not connected to peer");
        
        // Block sending if pending? Maybe not necessary but good practice.
        if (this.peerStatus.get(targetPubkey) !== PeerStatus.CONNECTED) {
            throw new Error("Peer is not accepted/connected");
        }

        const content = JSON.stringify({ type, payload });
        const conversationKey = nip44.getConversationKey(this.identity.sk, targetPubkey);
        const ciphertext = nip44.encrypt(content, conversationKey);
        
        ws.send(ciphertext);
    }
    
    broadcast(type: string, payload: any) {
        for (const [pk, ws] of this.peers) {
             if (this.peerStatus.get(pk) === PeerStatus.CONNECTED) {
                try {
                    this.sendMessage(pk, type, payload);
                } catch (e) {}
             }
        }
    }

    disconnectPeer(pubkey: string) {
        const ws = this.peers.get(pubkey);
        if (ws) {
            ws.close();
            this.peers.delete(pubkey);
            this.peerStatus.delete(pubkey);
            this.emit('peer:disconnected', pubkey);
        }
    }
}