import { WebSocketServer, WebSocket } from 'ws';
import { NCC05Publisher, NCC05Resolver, NCC05Payload, NCC05Endpoint } from 'ncc-05-js';
import { P2PNode, PeerMessage } from './p2p.js';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import chalk from 'chalk';

// --- Improved Mock Relay (Supports Replaceable Events NIP-16) ---
class MockRelay {
    public wss: WebSocketServer;
    private events: any[] = [];
    private port: number;

    constructor(port: number) {
        this.port = port;
        this.wss = new WebSocketServer({ port });
        this.wss.on('connection', (ws: WebSocket) => {
            ws.on('message', (data: any) => {
                try {
                    const msg = JSON.parse(data.toString());
                    const type = msg[0];

                    if (type === 'EVENT') {
                        const event = msg[1];
                        // Replaceable event logic (Kind 30058)
                        if (event.kind === 30058) {
                            const dTag = event.tags.find((t: any) => t[0] === 'd')?.[1];
                            const idx = this.events.findIndex(e => 
                                e.pubkey === event.pubkey && 
                                e.kind === event.kind && 
                                e.tags.find((t: any) => t[0] === 'd')?.[1] === dTag
                            );
                            if (idx !== -1) {
                                if (event.created_at >= this.events[idx].created_at) {
                                    this.events[idx] = event;
                                }
                            } else {
                                this.events.push(event);
                            }
                        } else {
                            this.events.push(event);
                        }
                        ws.send(JSON.stringify(["OK", event.id, true, ""]));
                    } else if (type === 'REQ') {
                        const subId = msg[1];
                        const filters = msg[2];
                        this.events.forEach(event => {
                            let match = true;
                            if (filters.authors && !filters.authors.includes(event.pubkey)) match = false;
                            if (filters.kinds && !filters.kinds.includes(event.kind)) match = false;
                            if (filters['#d']) {
                                const dTag = event.tags.find((t: any) => t[0] === 'd')?.[1];
                                if (!filters['#d'].includes(dTag)) match = false;
                            }
                            if (match) ws.send(JSON.stringify(["EVENT", subId, event]));
                        });
                        ws.send(JSON.stringify(["EOSE", subId]));
                    }
                } catch (e) {}
            });
        });
    }

    stop() { this.wss.close(); }
    get url() { return `ws://localhost:${this.port}`}
    get storedEvents() { return this.events; }
}

async function runTests() {
    console.log(chalk.bold.cyan("\n>>> Starting Comprehensive NCC-P2P Integration Tests <<<\n"));

    // 1. Setup Infrastructure
    const relay1 = new MockRelay(8801);
    const relay2 = new MockRelay(8802);
    const relays = [relay1.url, relay2.url];
    console.log(`[Relays] Running on ${relays.join(', ')}`);

    // 2. Setup Identities
    const aliceSk = generateSecretKey();
    const aliceId = { 
        sk: aliceSk, 
        pk: getPublicKey(aliceSk), 
        nsec: nip19.nsecEncode(aliceSk),
        npub: nip19.npubEncode(getPublicKey(aliceSk)) 
    };
    const bobSk = generateSecretKey();
    const bobId = { 
        sk: bobSk, 
        pk: getPublicKey(bobSk), 
        nsec: nip19.nsecEncode(bobSk),
        npub: nip19.npubEncode(getPublicKey(bobSk)) 
    };

    const aliceNode = new P2PNode(aliceId);
    const bobNode = new P2PNode(bobId);
    const publisher = new NCC05Publisher();
    const resolver = new NCC05Resolver({ bootstrapRelays: relays });

    // ---------------------------------------------------------
    // PHASE 1: Initial Port
    // ---------------------------------------------------------
    const portA = await aliceNode.startServer(0, '127.0.0.2');
    console.log(chalk.yellow(`[Alice] Started on Port A: ${portA}`));

    await publisher.publish(relays, aliceId.sk, {
        v: 1, ttl: 60, updated_at: Math.floor(Date.now() / 1000),
        endpoints: [{ type: 'ws', url: `ws://127.0.0.2:${portA}`, family: 'ipv4', priority: 1 }]
    }, { public: false, recipientPubkey: bobId.pk });
    console.log("[Alice] Published Port A (Encrypted for Bob).");

    // VERIFY ENCRYPTION
    const storedEvent = relay1.storedEvents.find(e => e.pubkey === aliceId.pk);
    if (storedEvent && !storedEvent.content.startsWith('{')) {
        console.log(chalk.green("PASS: Relay content is encrypted (ciphertext)."));
    } else {
        throw new Error("Relay content is plaintext! Encryption failed.");
    }

    console.log("[Bob] Resolving Alice...");
    const recordA = await resolver.resolve(aliceId.npub, bobId.sk);
    console.log(`[Bob] Resolved Alice to: ${recordA?.endpoints[0].url}`);

    await bobNode.connectToPeer(recordA!.endpoints[0].url, aliceId.npub);
    
    // VERIFY CHAT & ACCEPT
    const chatPromise = new Promise(resolve => {
        bobNode.on('message', (msg) => {
            if (msg.payload.text === 'Hello Bob!') resolve(true);
        });
    });

    // Wait for connection
    await new Promise(r => setTimeout(r, 500));
    
    console.log("[Alice] Accepting Bob...");
    aliceNode.acceptPeer(bobId.pk);
    
    console.log("[Alice] Sending 'Hello Bob!'...");
    aliceNode.sendMessage(bobId.pk, 'chat', { text: 'Hello Bob!' });
    
    await chatPromise;
    console.log(chalk.green("PASS: Encrypted chat received in Phase 1."));

    console.log(chalk.green("[P2P] Initial connection established."));

    // ---------------------------------------------------------
    // PHASE 2: Migration to Port B
    // ---------------------------------------------------------
    console.log(chalk.bold.magenta("\n[Migration] Alice is changing networks...\n"));
    
    // Simulate Alice's server "moving" (shut down old, start new)
    (aliceNode as any).server.close();
    const portB = await aliceNode.startServer(0, '127.0.0.2');
    console.log(chalk.yellow(`[Alice] Now listening on new Port B: ${portB}`));

    // Publish update (must have higher timestamp)
    await publisher.publish(relays, aliceId.sk, {
        v: 1, ttl: 60, updated_at: Math.floor(Date.now() / 1000) + 1,
        endpoints: [{ type: 'ws', url: `ws://127.0.0.2:${portB}`, family: 'ipv4', priority: 1 }]
    }, { public: true });
    console.log("[Alice] Published updated record to relays.");

    // Bob re-resolves (simulating discovery of the new location)
    console.log("[Bob] Re-resolving Alice...");
    const bobResolver2 = new NCC05Resolver({ bootstrapRelays: relays }); // Fresh resolver to bypass simple memory cache if any
    const recordB = await bobResolver2.resolve(aliceId.npub);
    console.log(`[Bob] Resolved Alice to NEW address: ${recordB?.endpoints[0].url}`);

    if (recordB?.endpoints[0].url.includes(portB.toString())) {
        console.log(chalk.green("SUCCESS: Bob discovered Alice's new port via NCC-05!"));
    } else {
        throw new Error(`Failed to resolve new port. Got: ${recordB?.endpoints[0].url}`);
    }

    // Connect to new port
    console.log("[Bob] Connecting to new port...");
    
    // Wait for Alice to receive Bob's connection handshake before accepting
    const connectionPromise = new Promise(resolve => {
        const handler = (evt: any) => {
            const pk = evt.pubkey || evt;
            if (pk === bobId.pk) {
                aliceNode.off('peer:connected', handler);
                resolve(true);
            }
        };
        aliceNode.on('peer:connected', handler);
    });

    await bobNode.connectToPeer(recordB!.endpoints[0].url, aliceId.npub);
    await connectionPromise;
    aliceNode.acceptPeer(bobId.pk);

    // Final Chat Verification
    const finalChatPromise = new Promise((resolve) => {
        aliceNode.on('message', (msg) => {
            if (msg.payload.text === "Migration successful!") resolve(true);
        });
    });

    bobNode.sendMessage(aliceId.pk, 'chat', { text: "Migration successful!" });
    await finalChatPromise;
    console.log(chalk.bold.green("\n>>> TEST PASSED: Discovery handles dynamic endpoint changes across multiple relays! <<<\n"));

    relay1.stop();
    relay2.stop();
    process.exit(0);
}

runTests().catch(e => {
    console.error(chalk.red(`TEST FAILED: ${e.message}`));
    process.exit(1);
});