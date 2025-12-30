"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const chalk_1 = __importDefault(require("chalk"));
const boxen_1 = __importDefault(require("boxen"));
const ora_1 = __importDefault(require("ora"));
const enquirer_1 = __importDefault(require("enquirer")); // Correct import for commonjs/default export
// @ts-ignore
const { prompt } = enquirer_1.default;
const identity_js_1 = require("./identity.js");
const p2p_js_1 = require("./p2p.js");
const tor_js_1 = require("./tor.js");
const ncc_05_js_1 = require("ncc-05-js");
// Configuration
const BOOTSTRAP_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
// Global State for Chat
const messageHistory = new Map();
let currentChatPeer = null;
function addToHistory(pubkey, msg) {
    if (!messageHistory.has(pubkey))
        messageHistory.set(pubkey, []);
    const history = messageHistory.get(pubkey);
    history.push(msg);
    // Keep last 50
    if (history.length > 50)
        history.shift();
}
async function main() {
    console.clear();
    console.log(chalk_1.default.bold.cyan((0, boxen_1.default)("NCC-05 P2P CLI", { padding: 1, borderStyle: 'round' })));
    // 1. Identity
    const spinner = (0, ora_1.default)('Loading Identity...').start();
    const identity = (0, identity_js_1.loadOrGenerateIdentity)();
    spinner.succeed(`Identity Loaded: ${chalk_1.default.green(identity.npub)}`);
    // 2. Network Setup
    const p2p = new p2p_js_1.P2PNode(identity);
    const port = await p2p.startServer(0); // Random port
    spinner.succeed(`P2P Server listening on port ${chalk_1.default.yellow(port)}`);
    // 3. Tor Setup
    const tor = new tor_js_1.TorController();
    let onionAddress = null;
    let useTor = false;
    if (await tor.connect()) {
        spinner.succeed("Tor Control Port detected.");
        spinner.stop();
        const response = await prompt({
            type: 'confirm',
            name: 'enableTor',
            message: 'Do you want to enable Tor Hidden Service for this session?'
        });
        if (response.enableTor) {
            spinner.start("Authenticating with Tor...");
            if (await tor.authenticate()) {
                spinner.text = "Creating Ephemeral Onion Service...";
                onionAddress = await tor.createOnionService(port);
                if (onionAddress) {
                    spinner.succeed(`Onion Service Created: ${chalk_1.default.magenta(onionAddress)}`);
                    useTor = true;
                }
                else {
                    spinner.fail("Failed to create Onion Service.");
                }
            }
            else {
                spinner.fail("Tor Authentication failed.");
            }
        }
    }
    else {
        spinner.info("Tor Control Port not detected (is Tor running?). Skipping Tor setup.");
    }
    // 4. NCC-05 Publication
    spinner.start("Publishing Service Locator...");
    const publisher = new ncc_05_js_1.NCC05Publisher();
    const endpoints = [];
    // Add Local IP (Naive detection for now, just placeholder or loopback if not detected)
    endpoints.push({
        type: 'ws',
        url: `ws://127.0.0.1:${port}`,
        priority: 10,
        family: 'ipv4'
    });
    if (onionAddress) {
        endpoints.push({
            type: 'ws',
            url: `ws://${onionAddress}`,
            priority: 1, // Higher priority for privacy
            family: 'onion'
        });
    }
    const payload = {
        v: 1,
        ttl: 300, // 5 minutes
        updated_at: Math.floor(Date.now() / 1000),
        endpoints: endpoints,
        notes: "NCC-P2P-CLI Node"
    };
    try {
        await publisher.publish(BOOTSTRAP_RELAYS, identity.sk, payload, { public: true });
        spinner.succeed("Service Locator Published to Nostr!");
    }
    catch (e) {
        spinner.warn(`Publication partial/failed: ${e.message}`);
    }
    // 5. Main Loop
    const resolver = new ncc_05_js_1.NCC05Resolver({ bootstrapRelays: BOOTSTRAP_RELAYS });
    const pendingPeers = new Set();
    const activePeers = new Set();
    p2p.on('peer:connected', (event) => {
        const pubkey = event.pubkey || event;
        const isIncoming = event.isIncoming;
        if (isIncoming) {
            pendingPeers.add(pubkey);
            console.log('\n' + (0, boxen_1.default)(chalk_1.default.green(`New Connection Request!\n${pubkey}`), {
                padding: 0,
                borderStyle: 'double',
                borderColor: 'green'
            }));
        }
        else {
            activePeers.add(pubkey);
        }
    });
    p2p.on('peer:disconnected', (pubkey) => {
        activePeers.delete(pubkey);
        pendingPeers.delete(pubkey);
        console.log(chalk_1.default.red(`\n[-] Peer disconnected: ${pubkey.slice(0, 8)}...`));
        if (currentChatPeer === pubkey) {
            currentChatPeer = null; // Exit chat will happen in startChatSession loop
        }
    });
    p2p.on('message', (msg) => {
        const { from, type, payload } = msg;
        if (type === 'chat') {
            const time = new Date().toLocaleTimeString();
            addToHistory(from, { sender: 'them', text: payload.text, time });
            if (currentChatPeer === from) {
                // If in chat, output directly
                console.log(chalk_1.default.blue(`[${time}] ${from.slice(0, 8)}: ${payload.text}`));
            }
            else {
                // Notify if not in chat with them
                if (!currentChatPeer) {
                    // Or maybe just log it simply.
                    // console.log(chalk.cyan(`\n(New message from ${from.slice(0,8)}...)`));
                }
            }
        }
    });
    while (true) {
        const choices = ['Chat', 'Connect', 'Status', 'Quit'];
        if (pendingPeers.size > 0) {
            choices.unshift(`Handle Requests (${pendingPeers.size})`);
        }
        const answer = await prompt({
            type: 'select',
            name: 'action',
            message: 'What would you like to do?',
            choices: choices
        });
        if (answer.action === 'Quit') {
            process.exit(0);
        }
        if (answer.action.startsWith('Handle Requests')) {
            const requests = Array.from(pendingPeers);
            const { selectedRequest } = await prompt({
                type: 'select',
                name: 'selectedRequest',
                message: 'Select a request to manage:',
                choices: [...requests, 'Back']
            });
            if (selectedRequest !== 'Back') {
                const { decision } = await prompt({
                    type: 'select',
                    name: 'decision',
                    message: `Accept connection from ${selectedRequest.slice(0, 8)}...?`,
                    choices: ['Accept', 'Reject']
                });
                if (decision === 'Accept') {
                    pendingPeers.delete(selectedRequest);
                    activePeers.add(selectedRequest);
                    p2p.acceptPeer(selectedRequest);
                    console.log(chalk_1.default.green(`Accepted ${selectedRequest.slice(0, 8)}...`));
                    const { chatNow } = await prompt({
                        type: 'confirm',
                        name: 'chatNow',
                        message: 'Start chatting now?'
                    });
                    if (chatNow) {
                        await startChatSession(p2p, selectedRequest, activePeers);
                    }
                }
                else {
                    pendingPeers.delete(selectedRequest);
                    p2p.disconnectPeer(selectedRequest);
                    console.log(chalk_1.default.red(`Rejected ${selectedRequest.slice(0, 8)}...`));
                }
            }
        }
        if (answer.action === 'Status') {
            console.log((0, boxen_1.default)(`
My Npub: ${identity.npub}
Local Port: ${port}
Onion: ${onionAddress || 'N/A'}
Active Peers: ${activePeers.size}
Pending Requests: ${pendingPeers.size}
            `.trim(), { padding: 1 }));
        }
        if (answer.action === 'Connect') {
            const { target } = await prompt({
                type: 'input',
                name: 'target',
                message: 'Enter target Npub:'
            });
            if (target === identity.npub) {
                console.log(chalk_1.default.red("You cannot connect to yourself!"));
                continue;
            }
            spinner.start("Resolving address...");
            try {
                const record = await resolver.resolve(target);
                if (record && record.endpoints.length > 0) {
                    spinner.succeed(`Found ${record.endpoints.length} endpoints.`);
                    const sorted = (0, ncc_05_js_1.selectEndpoints)(record.endpoints);
                    let best = sorted[0];
                    if (best.family === 'onion' && !useTor) {
                        const nonOnion = sorted.find(e => e.family !== 'onion');
                        if (nonOnion)
                            best = nonOnion;
                        else
                            throw new Error("Only onion endpoints found but Tor is disabled.");
                    }
                    spinner.start(`Connecting to ${best.url}...`);
                    await p2p.connectToPeer(best.url, target, best.family === 'onion');
                    spinner.succeed("Connected!");
                    const { chatNow } = await prompt({
                        type: 'confirm',
                        name: 'chatNow',
                        message: 'Start chatting now?'
                    });
                    if (chatNow) {
                        let hex = target;
                        try {
                            const d = (await import('nostr-tools')).nip19.decode(target);
                            if (d.type === 'npub')
                                hex = d.data;
                        }
                        catch { } // Ignore decoding errors, assume it's already hex
                        await startChatSession(p2p, hex, activePeers);
                    }
                }
                else {
                    spinner.fail("No records found or resolution failed.");
                }
            }
            catch (e) {
                spinner.fail(`Error: ${e.message}`);
            }
        }
        if (answer.action === 'Chat') {
            if (activePeers.size === 0) {
                console.log(chalk_1.default.yellow("No active peers. Connect to someone first!"));
                continue;
            }
            const choices = Array.from(activePeers);
            const { peer } = await prompt({
                type: 'select',
                name: 'peer',
                message: 'Select peer to chat with:',
                choices: [...choices, 'Broadcast All']
            });
            if (peer === 'Broadcast All') {
                const { message } = await prompt({
                    type: 'input',
                    name: 'message',
                    message: 'Broadcast:'
                });
                p2p.broadcast('chat', { text: message });
            }
            else {
                await startChatSession(p2p, peer, activePeers);
            }
        }
    }
}
async function startChatSession(p2p, targetHex, activePeers) {
    currentChatPeer = targetHex;
    console.clear();
    console.log(chalk_1.default.cyan(`Entered Chat with ${targetHex.slice(0, 8)}...`));
    console.log(chalk_1.default.gray("Type '/exit' to return to menu."));
    console.log(chalk_1.default.dim("------------------------------------------------"));
    // Print History
    const history = messageHistory.get(targetHex) || [];
    history.forEach(m => {
        if (m.sender === 'me') {
            console.log(chalk_1.default.gray(`[${m.time}] Me: ${m.text}`));
        }
        else {
            console.log(chalk_1.default.blue(`[${m.time}] ${targetHex.slice(0, 8)}: ${m.text}`));
        }
    });
    console.log(""); // Newline
    while (true) {
        if (!activePeers.has(targetHex)) {
            console.log(chalk_1.default.red("Peer disconnected. Exiting chat."));
            break;
        }
        const { message } = await prompt({
            type: 'input',
            name: 'message',
            message: 'You:'
        });
        if (message === '/exit') {
            break;
        }
        const time = new Date().toLocaleTimeString();
        try {
            p2p.sendMessage(targetHex, 'chat', { text: message });
            // Add to history and print echo
            addToHistory(targetHex, { sender: 'me', text: message, time });
            console.log(chalk_1.default.gray(`[${time}] Me: ${message}`));
        }
        catch (e) {
            console.log(chalk_1.default.red("Failed to send message."));
        }
    }
    currentChatPeer = null;
}
main().catch(console.error);
