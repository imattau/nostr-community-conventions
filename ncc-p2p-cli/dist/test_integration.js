"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ws_1 = require("ws");
const ncc_05_js_1 = require("ncc-05-js");
const p2p_js_1 = require("./p2p.js");
const nostr_tools_1 = require("nostr-tools");
const chalk_1 = __importDefault(require("chalk"));
// --- Mock Relay Implementation ---
class MockRelay {
    constructor(port) {
        this.events = [];
        this.port = port;
        this.wss = new ws_1.WebSocketServer({ port });
        this.wss.on('connection', (ws) => {
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    const type = msg[0];
                    if (type === 'EVENT') {
                        const event = msg[1];
                        // Simple storage, no validation for speed
                        this.events.push(event);
                        ws.send(JSON.stringify(["OK", event.id, true, ""]));
                    }
                    else if (type === 'REQ') {
                        const subId = msg[1];
                        const filters = msg[2];
                        this.events.forEach(event => {
                            let match = true;
                            if (filters.authors && !filters.authors.includes(event.pubkey))
                                match = false;
                            if (filters.kinds && !filters.kinds.includes(event.kind))
                                match = false;
                            // Basic tag filtering
                            if (filters['#d']) {
                                const dTag = event.tags.find((t) => t[0] === 'd')?.[1];
                                if (!filters['#d'].includes(dTag))
                                    match = false;
                            }
                            if (match) {
                                ws.send(JSON.stringify(["EVENT", subId, event]));
                            }
                        });
                        ws.send(JSON.stringify(["EOSE", subId]));
                    }
                }
                catch (e) {
                    console.error("Relay error processing message:", e);
                }
            });
        });
    }
    stop() {
        this.wss.close();
    }
    get url() {
        return `ws://localhost:${this.port}`;
    }
}
// --- Integration Test ---
async function runTest() {
    console.log(chalk_1.default.bold("Starting P2P Integration Test..."));
    // 1. Start Relay
    const RELAY_PORT = 8899;
    const relay = new MockRelay(RELAY_PORT);
    console.log(`[Relay] Started on ${relay.url}`);
    // 2. Setup Identities
    const aliceSk = (0, nostr_tools_1.generateSecretKey)();
    const aliceIdentity = {
        sk: aliceSk,
        pk: (0, nostr_tools_1.getPublicKey)(aliceSk),
        nsec: nostr_tools_1.nip19.nsecEncode(aliceSk),
        npub: nostr_tools_1.nip19.npubEncode((0, nostr_tools_1.getPublicKey)(aliceSk))
    };
    const bobSk = (0, nostr_tools_1.generateSecretKey)();
    const bobIdentity = {
        sk: bobSk,
        pk: (0, nostr_tools_1.getPublicKey)(bobSk),
        nsec: nostr_tools_1.nip19.nsecEncode(bobSk),
        npub: nostr_tools_1.nip19.npubEncode((0, nostr_tools_1.getPublicKey)(bobSk))
    };
    console.log(`[Alice] ${aliceIdentity.npub}`);
    console.log(`[Bob]   ${bobIdentity.npub}`);
    // 3. Start P2P Nodes
    const aliceNode = new p2p_js_1.P2PNode(aliceIdentity);
    const aliceHost = '127.0.0.2';
    const alicePort = await aliceNode.startServer(0, aliceHost);
    console.log(`[Alice] Listening on ${aliceHost}:${alicePort}`);
    const bobNode = new p2p_js_1.P2PNode(bobIdentity);
    const bobHost = '127.0.0.3';
    const bobPort = await bobNode.startServer(0, bobHost);
    console.log(`[Bob]   Listening on ${bobHost}:${bobPort}`);
    // 4. Publish Alice's Record (Encrypted for Bob)
    const publisher = new ncc_05_js_1.NCC05Publisher();
    const aliceEndpoints = [{
            type: 'ws',
            url: `ws://${aliceHost}:${alicePort}`,
            priority: 1,
            family: 'ipv4'
        }];
    const payload = {
        v: 1,
        ttl: 300,
        updated_at: Math.floor(Date.now() / 1000),
        endpoints: aliceEndpoints,
        notes: "Alice's Test Node"
    };
    console.log("[Alice] Publishing ENCRYPTED NCC-05 Record for Bob...");
    await publisher.publish([relay.url], aliceIdentity.sk, payload, {
        public: false,
        recipientPubkey: bobIdentity.pk
    });
    // 4b. Verify Relay content is encrypted
    const storedEvent = relay.events.find((e) => e.pubkey === aliceIdentity.pk);
    if (storedEvent) {
        const isEncrypted = !storedEvent.content.startsWith('{');
        console.log(`[Relay] Stored event content: ${storedEvent.content.slice(0, 32)}...`);
        console.log(`[Relay] Is content encrypted? ${isEncrypted ? chalk_1.default.green('YES') : chalk_1.default.red('NO')}`);
        if (!isEncrypted)
            throw new Error("Relay stored plaintext instead of ciphertext!");
    }
    // 5. Bob Resolves and Connects to Alice
    const resolver = new ncc_05_js_1.NCC05Resolver({ bootstrapRelays: [relay.url] });
    // Setup message listeners before connecting
    const messagePromise = new Promise((resolve, reject) => {
        let aliceReceived = false;
        let bobReceived = false;
        const checkDone = () => {
            if (aliceReceived && bobReceived)
                resolve(true);
        };
        aliceNode.on('message', (msg) => {
            console.log(chalk_1.default.green(`[Alice] Received from ${msg.from.slice(0, 8)}: ${JSON.stringify(msg.payload)}`));
            if (msg.payload.text === "Hello Alice!") {
                aliceReceived = true;
                checkDone();
            }
        });
        bobNode.on('message', (msg) => {
            console.log(chalk_1.default.blue(`[Bob]   Received from ${msg.from.slice(0, 8)}: ${JSON.stringify(msg.payload)}`));
            if (msg.payload.text === "Hello Bob!") {
                bobReceived = true;
                checkDone();
            }
        });
        // Timeout
        setTimeout(() => reject(new Error("Test timed out waiting for messages")), 5000);
    });
    console.log("[Bob] Resolving Alice (with decryption key)...");
    const record = await resolver.resolve(aliceIdentity.npub, bobIdentity.sk);
    if (!record) {
        console.error(chalk_1.default.red("Failed to resolve Alice!"));
        process.exit(1);
    }
    console.log(`[Bob] Resolved Alice to: ${record.endpoints[0].url}`);
    await bobNode.connectToPeer(record.endpoints[0].url, aliceIdentity.npub);
    console.log("[Bob] Connected to Alice");
    // Give a moment for handshakes (implicit/explicit)
    await new Promise(r => setTimeout(r, 500));
    // NEW: Alice must accept Bob
    console.log("[Alice] Accepting Bob...");
    aliceNode.acceptPeer(bobIdentity.pk);
    // 6. Exchange Messages
    console.log("[Bob] Sending 'Hello Alice!'...");
    bobNode.sendMessage(aliceIdentity.pk, 'chat', { text: "Hello Alice!" });
    // Wait for Bob's connection to be established on Alice's side (incoming)
    // Alice needs to know Bob's PK to send back.
    // In our P2PNode implementation, incoming connections might need a moment to identify the peer 
    // via the handshake we implemented.
    await new Promise(r => setTimeout(r, 200));
    console.log("[Alice] Sending 'Hello Bob!'...");
    aliceNode.sendMessage(bobIdentity.pk, 'chat', { text: "Hello Bob!" });
    // 7. Verify
    try {
        await messagePromise;
        console.log(chalk_1.default.bold.green("\nSUCCESS: Bidirectional encrypted communication verified!"));
    }
    catch (e) {
        console.error(chalk_1.default.bold.red(`\nFAILURE: ${e.message}`));
    }
    finally {
        relay.stop();
        publisher.close([relay.url]);
        resolver.close();
        process.exit(0);
    }
}
runTest().catch(e => {
    console.error(e);
    process.exit(1);
});
