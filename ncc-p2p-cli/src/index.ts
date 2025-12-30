import chalk from 'chalk';
import boxen from 'boxen';
import ora from 'ora';
import Enquirer from 'enquirer'; // Correct import for commonjs/default export
// @ts-ignore
const { prompt } = Enquirer;

import { loadOrGenerateIdentity } from './identity.js';
import { P2PNode } from './p2p.js';
import { TorController } from './tor.js';
import { ContactManager } from './contacts.js';
import { NCC05Publisher, NCC05Resolver, NCC05Payload, NCC05Endpoint, selectEndpoints } from 'ncc-05-js';
import { nip19 } from 'nostr-tools';

// Configuration
const BOOTSTRAP_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

// Global State for Chat
const messageHistory = new Map<string, Array<{sender: string, text: string, time: string}>>();
let currentChatPeer: string | null = null;
const contacts = new ContactManager();

function addToHistory(pubkey: string, msg: {sender: string, text: string, time: string}) {
   if (!messageHistory.has(pubkey)) messageHistory.set(pubkey, []);
   const history = messageHistory.get(pubkey)!;
   history.push(msg);
   // Keep last 50
   if (history.length > 50) history.shift();
}

function getDisplayName(pubkey: string): string {
    const contact = contacts.getContact(pubkey);
    if (contact && contact.name) return contact.name;
    return pubkey.slice(0, 8) + '...';
}

async function main() {
    console.clear();
    console.log(chalk.bold.cyan(boxen("NCC-05 P2P CLI", { padding: 1, borderStyle: 'round' })));

    // 1. Identity
    const spinner = ora('Loading Identity...').start();
    const identity = loadOrGenerateIdentity();
    spinner.succeed(`Identity Loaded: ${chalk.green(identity.npub)}`);

    // 2. Network Setup
    const p2p = new P2PNode(identity);
    const port = await p2p.startServer(0); // Random port
    spinner.succeed(`P2P Server listening on port ${chalk.yellow(port)}`);

    // 3. Tor Setup
    const tor = new TorController();
    let onionAddress: string | null = null;
    let useTor = false;

    if (await tor.connect()) {
        spinner.succeed("Tor Control Port detected.");
        spinner.stop();
        
        const response = await prompt({
            type: 'confirm',
            name: 'enableTor',
            message: 'Do you want to enable Tor Hidden Service for this session?'
        }) as { enableTor: boolean };

        if (response.enableTor) {
            spinner.start("Authenticating with Tor...");
            if (await tor.authenticate()) {
                spinner.text = "Creating Ephemeral Onion Service...";
                onionAddress = await tor.createOnionService(port);
                if (onionAddress) {
                    spinner.succeed(`Onion Service Created: ${chalk.magenta(onionAddress)}`);
                    useTor = true;
                } else {
                    spinner.fail("Failed to create Onion Service.");
                }
            } else {
                spinner.fail("Tor Authentication failed.");
            }
        }
    } else {
        spinner.info("Tor Control Port not detected (is Tor running?). Skipping Tor setup.");
    }

    // 4. NCC-05 Publication
    spinner.start("Publishing Service Locator...");
    const publisher = new NCC05Publisher();
    const endpoints: NCC05Endpoint[] = [];
    
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

    const payload: NCC05Payload = {
        v: 1,
        ttl: 300, // 5 minutes
        updated_at: Math.floor(Date.now() / 1000),
        endpoints: endpoints,
        notes: "NCC-P2P-CLI Node"
    };

    try {
        await publisher.publish(BOOTSTRAP_RELAYS, identity.sk, payload, { public: true });
        spinner.succeed("Service Locator Published to Nostr!");
    } catch (e: any) {
        spinner.warn(`Publication partial/failed: ${e.message}`);
    }

    // 5. Main Loop
    const resolver = new NCC05Resolver({ bootstrapRelays: BOOTSTRAP_RELAYS });
    const pendingPeers: Set<string> = new Set();
    const activePeers: Set<string> = new Set();

    p2p.on('peer:connected', (event: any) => {
        const pubkey = event.pubkey || event;
        const isIncoming = event.isIncoming;

        if (isIncoming) {
            // Check if trusted
            if (contacts.isTrusted(pubkey)) {
                activePeers.add(pubkey);
                p2p.acceptPeer(pubkey);
                console.log('\n' + boxen(chalk.green(`Friend Connected: ${getDisplayName(pubkey)}`), { 
                    padding: 0, borderStyle: 'single', borderColor: 'green' 
                }));
            } else {
                pendingPeers.add(pubkey);
                console.log('\n' + boxen(chalk.yellow(`New Connection Request!
${pubkey}`), { 
                    padding: 0, borderStyle: 'double', borderColor: 'yellow'
                }));
            }
        } else {
            activePeers.add(pubkey);
        }
    });

    p2p.on('peer:disconnected', (pubkey: string) => {
        activePeers.delete(pubkey);
        pendingPeers.delete(pubkey);
        console.log(chalk.red(`\n[-] Peer disconnected: ${getDisplayName(pubkey)}`));
        if (currentChatPeer === pubkey) {
             currentChatPeer = null; 
        }
    });

    p2p.on('message', (msg) => {
        const { from, type, payload } = msg;
        if (type === 'chat') {
            const time = new Date().toLocaleTimeString();
            addToHistory(from, { sender: 'them', text: payload.text, time });

            if (currentChatPeer === from) {
                console.log(chalk.blue(`[${time}] ${getDisplayName(from)}: ${payload.text}`));
            }
        }
    });

    while (true) {
        const choices = ['Chat', 'Contacts', 'Connect', 'Status', 'Quit'];
        if (pendingPeers.size > 0) {
            choices.unshift(`Handle Requests (${pendingPeers.size})`);
        }

        const answer = await prompt({
            type: 'select',
            name: 'action',
            message: 'What would you like to do?',
            choices: choices
        }) as { action: string };

        if (answer.action === 'Quit') {
            process.exit(0);
        }

        if (answer.action === 'Contacts') {
            const allContacts = contacts.getAll();
            if (allContacts.length === 0) {
                console.log(chalk.yellow("No contacts saved."));
                continue;
            }

            const choices = allContacts.map(c => c.name ? `${c.name} (${c.pubkey.slice(0,8)}...)` : c.pubkey);
            const { selected } = await prompt({
                type: 'select',
                name: 'selected',
                message: 'Select a contact:',
                choices: [...choices, 'Back']
            }) as { selected: string };

            if (selected !== 'Back') {
                 const contact = allContacts.find(c => (c.name && selected.startsWith(c.name)) || selected === c.pubkey);
                 if (contact) {
                     const { op } = await prompt({
                         type: 'select',
                         name: 'op',
                         message: `Contact: ${contact.name || contact.pubkey}`,
                         choices: ['Connect', 'Remove', 'Back']
                     }) as { op: string };

                     if (op === 'Connect') {
                         await connectTo(contact.pubkey, p2p, resolver, useTor, spinner, activePeers);
                     } else if (op === 'Remove') {
                         contacts.removeContact(contact.pubkey);
                         console.log(chalk.green("Contact removed."));
                     }
                 }
            }
        }

        if (answer.action.startsWith('Handle Requests')) {
             const requests = Array.from(pendingPeers);
             const { selectedRequest } = await prompt({
                 type: 'select',
                 name: 'selectedRequest',
                 message: 'Select a request to manage:',
                 choices: [...requests, 'Back']
             }) as { selectedRequest: string };

             if (selectedRequest !== 'Back') {
                 const { decision } = await prompt({
                     type: 'select',
                     name: 'decision',
                     message: `Accept connection from ${selectedRequest.slice(0, 8)}...?`,
                     choices: ['Accept', 'Reject']
                 }) as { decision: string };

                 if (decision === 'Accept') {
                     pendingPeers.delete(selectedRequest);
                     activePeers.add(selectedRequest);
                     p2p.acceptPeer(selectedRequest);
                     console.log(chalk.green(`Accepted ${selectedRequest.slice(0,8)}...`));
                     
                     // Add to contacts?
                     const { addContact } = await prompt({
                        type: 'confirm',
                        name: 'addContact',
                        message: 'Add to trusted contacts?'
                     }) as { addContact: boolean };

                     if (addContact) {
                         const { name } = await prompt({
                             type: 'input',
                             name: 'name',
                             message: 'Nickname (optional):'
                         }) as { name: string };
                         contacts.addContact(selectedRequest, name);
                         console.log(chalk.green("Contact saved."));
                     }
                     
                     const { chatNow } = await prompt({
                        type: 'confirm',
                        name: 'chatNow',
                        message: 'Start chatting now?'
                     }) as { chatNow: boolean };
                     
                     if (chatNow) {
                         await startChatSession(p2p, selectedRequest, activePeers);
                     }

                 } else {
                     pendingPeers.delete(selectedRequest);
                     p2p.disconnectPeer(selectedRequest);
                     console.log(chalk.red(`Rejected ${selectedRequest.slice(0,8)}...`));
                 }
             }
        }

        if (answer.action === 'Status') {
            console.log(boxen(`
My Npub: ${identity.npub}
Local Port: ${port}
Onion: ${onionAddress || 'N/A'}
Active Peers: ${activePeers.size}
Pending Requests: ${pendingPeers.size}
Known Contacts: ${contacts.getAll().length}
            `.trim(), { padding: 1 }));
        }

        if (answer.action === 'Connect') {
            const { target } = await prompt({
                type: 'input',
                name: 'target',
                message: 'Enter target Npub:'
            }) as { target: string };

            if (target === identity.npub) {
                console.log(chalk.red("You cannot connect to yourself!"));
                continue;
            }

            // Check if input is hex or npub
            let hex = target;
            try {
                if (target.startsWith('npub')) {
                    const d = nip19.decode(target);
                    if (d.type === 'npub') hex = d.data as string;
                }
            } catch {} // Ignore decoding errors, assume it's already hex

            await connectTo(target, p2p, resolver, useTor, spinner, activePeers);
            
            // If connected successfully and not in contacts, offer to add
            if (!contacts.isTrusted(hex)) {
                 // We don't block here, just optional flow
            }
        }

        if (answer.action === 'Chat') {
            if (activePeers.size === 0) {
                console.log(chalk.yellow("No active peers. Connect to someone first!"));
                continue;
            }
            
            const choices = Array.from(activePeers).map(pk => ({
                name: pk,
                message: getDisplayName(pk)
            }));

            const { peer } = await prompt({
                type: 'select',
                name: 'peer',
                message: 'Select peer to chat with:',
                choices: [...choices, { name: 'Broadcast All', message: 'Broadcast All' }]
            }) as { peer: string };

            if (peer === 'Broadcast All') {
                 const { message } = await prompt({
                    type: 'input',
                    name: 'message',
                    message: 'Broadcast:'
                }) as { message: string };
                p2p.broadcast('chat', { text: message });
            } else {
                await startChatSession(p2p, peer, activePeers);
            }
        }
    }
}

async function connectTo(target: string, p2p: P2PNode, resolver: NCC05Resolver, useTor: boolean, spinner: any, activePeers: Set<string>) {
    spinner.start("Resolving address...");
    try {
        const record = await resolver.resolve(target);
        if (record && record.endpoints.length > 0) {
            spinner.succeed(`Found ${record.endpoints.length} endpoints.`);
            const sorted = selectEndpoints(record.endpoints);
            let best = sorted[0];

            if (best.family === 'onion' && !useTor) {
                const nonOnion = sorted.find(e => e.family !== 'onion');
                if (nonOnion) best = nonOnion;
                else throw new Error("Only onion endpoints found but Tor is disabled.");
            }

            spinner.start(`Connecting to ${best.url}...`);
            await p2p.connectToPeer(best.url, target, best.family === 'onion');
            spinner.succeed("Connected!");
            
            // Get hex
            let hex = target;
            try {
                if (target.startsWith('npub')) {
                    const d = nip19.decode(target);
                    if (d.type === 'npub') hex = d.data as string;
                }
            } catch {} // Ignore decoding errors, assume it's already hex
            
            // If valid hex, add to active peers so we can chat
            if (hex) activePeers.add(hex);

            const { chatNow } = await prompt({
                type: 'confirm',
                name: 'chatNow',
                message: 'Start chatting now?'
             }) as { chatNow: boolean };

             if (chatNow) {
                 await startChatSession(p2p, hex, activePeers);
             }

        } else {
            spinner.fail("No records found or resolution failed.");
        }
    } catch (e: any) {
        spinner.fail(`Error: ${e.message}`);
    }
}

async function startChatSession(p2p: P2PNode, targetHex: string, activePeers: Set<string>) {
    currentChatPeer = targetHex;
    console.clear();
    const name = getDisplayName(targetHex);
    console.log(chalk.cyan(`Entered Chat with ${name}...`));
    console.log(chalk.gray("Type '/exit' to return to menu."));
    console.log(chalk.dim("------------------------------------------------"));

    // Print History
    const history = messageHistory.get(targetHex) || [];
    history.forEach(m => {
        if (m.sender === 'me') {
            console.log(chalk.gray(`[${m.time}] Me: ${m.text}`));
        } else {
            console.log(chalk.blue(`[${m.time}] ${name}: ${m.text}`));
        }
    });
    console.log(""); 

    while (true) {
        if (!activePeers.has(targetHex)) {
            console.log(chalk.red("Peer disconnected. Exiting chat."));
            break;
        }

        const { message } = await prompt({
            type: 'input',
            name: 'message',
            message: 'You:'
        }) as { message: string };

        if (message === '/exit') {
            break;
        }

        const time = new Date().toLocaleTimeString();
        try {
            p2p.sendMessage(targetHex, 'chat', { text: message });
            addToHistory(targetHex, { sender: 'me', text: message, time });
            console.log(chalk.gray(`[${time}] Me: ${message}`));
        } catch (e) {
            console.log(chalk.red("Failed to send message."));
        }
    }
    currentChatPeer = null;
}

main().catch(console.error);
