# NCC Sidecar Manager

A centralized management agent for Nostr identities. It keeps multiple services (Relays, Media Servers, APIs) compliant with NCC-02, NCC-05, and NCC-06 protocols by automatically managing discovery records and transport security.

## Features

- **Multi-Service Control:** Manage multiple identities and services from a single dashboard.
- **Automated Discovery:** Real-time probing of IPv4, IPv6, and Tor availability.
- **Multimodal Connectivity:** Publish multiple network paths (Onion + IP) with intelligent priority fallback.
- **Privacy First:** Support for Targeted and Group-Wrapped NCC-05 locators.
- **Security:** Automatic SPKI fingerprint (`k` tag) extraction and optional self-signed cert generation.
- **Modern Admin UI:** Bold, high-contrast dashboard with NIP-46 (Nostr Connect) login support.
- **SQLite Persistence:** Robust storage for service configurations, state, and operational logs.

## Quick Start

### 1. Install Dependencies
```bash
npm run setup
```

### 2. Build the UI
```bash
npm run build
```

### 3. Launch
```bash
npm start
```
Visit the URL shown in the console (default `http://127.0.0.1:3000`) to complete the first-run setup.

## Usage

### Development Mode
```bash
npm run dev
```
Starts both backend and frontend with hot-reloading.

### Operational Commands
- `npm run status`: Show managed services and their current health.
- `ADMIN_PORT=4000 npm start`: Run the admin interface on a custom port.

## Architecture

1. **Identity Layer:** Maps cryptographic Npubs to managed services.
2. **Discovery Layer:** Leverages NCC-05 to provide dynamic, location-independent routing.
3. **Security Layer:** Enforces transport-level trust via `k` tag pinning (DANE-over-Nostr).
4. **Persistence:** SQLite-backed configuration and state management.