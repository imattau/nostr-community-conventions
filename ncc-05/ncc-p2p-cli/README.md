# NCC-P2P-CLI

A secure, private Peer-to-Peer messaging client demonstrating **NCC-05: Identity-Bound Service Locator Resolution**.

## Features

*   **NCC-05 Discovery**:
    *   Decouples Identity (Npub) from Location (IP/Tor).
    *   Finds peers automatically via Nostr Relays.
    *   Prioritizes privacy-preserving routes (Tor > IPv6 > IPv4).
*   **Tor Integration**:
    *   Auto-detects Tor.
    *   Creates ephemeral **Onion Services** for anonymity.
    *   Routes traffic through SOCKS5.
*   **End-to-End Encryption**:
    *   All P2P traffic secured with **NIP-44** (x25519) encryption.
*   **Friend Management**:
    *   **Contacts List**: Save trusted peers.
    *   **Auto-Accept**: Known friends connect automatically.
    *   **Request Handling**: Approve or Reject connection attempts from strangers.
*   **Interactive CLI**:
    *   Real-time notifications.
    *   Message history.
    *   Polished UI with `chalk` and `boxen`.

## Installation

1.  **Prerequisites**:
    *   Node.js v16+
    *   (Optional) **Tor** running with Control Port enabled (9051) for `.onion` support.

2.  **Build**:
    ```bash
    cd ncc-p2p-cli
    npm install
    npm run build
    ```

## Usage

### Interactive Client
Start the CLI to chat with friends:
```bash
npm start
```

*   **First Run**: Generates a new Identity (`.identity.json`) and asks to enable Tor.
*   **Connect**: Enter a friend's Npub.
*   **Chat**: Select a connected peer to enter the chat loop.

### Testing (Simulation)
Run the automated integration test to verify the full protocol stack (Relay + 2 Clients + Encryption):
```bash
npm test
```
*   Simulates Alice and Bob on different networks.
*   Verifies NCC-05 Resolution, Encryption, and Handshakes.

## Project Structure

*   `src/index.ts`: CLI entry point & UI logic.
*   `src/p2p.ts`: WebSocket P2P Node & NIP-44 Encryption.
*   `src/contacts.ts`: Friend list persistence.
*   `src/tor.ts`: Tor Control Port interaction.
*   `src/test_integration.ts`: End-to-End Test Suite.