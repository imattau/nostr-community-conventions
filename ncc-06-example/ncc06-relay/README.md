# NCC-06 Minimal Relay + Sidecars + Simple Client (Node.js)

This project implements a minimal Node.js-based Nostr relay, sidecar publisher, and client resolver/connector, adhering to the NCC-06 specification for decentralized service discovery.

## Project Structure

- `relay/`: Contains the NIP-01 WebSocket relay server implementation.
- `sidecar/`: Contains scripts for publishing NCC-00, NCC-02, and NCC-05 events to the relay.
- `client/`: Contains the client-side resolver and connector logic for NCC-06.
- `test/`: Automated tests to validate NCC-06 behaviors.
- `docs/`: Placeholder for NCC-00, NCC-02, NCC-05, and NCC-06 documentation.
- `config.json`: Global configuration for the project.

## How to Run

### Prerequisites

- Node.js (v18 or higher recommended)
- npm

### Setup

1.  Navigate to the `ncc06-relay` directory:
    ```bash
    cd ncc-06-example/ncc06-relay
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```

### Configuration

All configuration is managed in `config.json` files.

- `config.json` (root): Global settings, including default relay port and test keys.
- `sidecar/config.json`: Specific configuration for the sidecar publisher, including the private key for publishing.
- `client/config.json`: Specific configuration for the client, including the public key of the service to resolve and expected `k` value.

**NOTE:** For this minimal harness, `k` is treated as a required tag for `wss` endpoints, but uses a fixed placeholder scheme like `TESTKEY:<string>`. The client "verifies" `k` by comparing it to an expected string in its config.

### Running the Components

#### 1. Start the Relay

```bash
npm run relay
```
The relay will start on the port specified in `config.json` (default: 7000).

#### 2. Run the Sidecar Publisher

The sidecar publishes NCC-02 and NCC-05 events to the running relay.

```bash
npm run sidecar:publish
```

#### 3. Run the Client Resolver & Connector

The client resolves the service endpoint using NCC-02 and NCC-05 events, then connects and performs a basic NIP-01 REQ.

```bash
npm run client:resolve-connect
```

#### 4. Run the Full Local Environment (Relay + Sidecar)

This command will start the relay and then run the sidecar publisher.

```bash
npm run start-local-env
```

### Running Tests

> **Note:** The test suite starts the relay/sidecar and uses WebSocket networking, so run `npm test` (or `npm --prefix ncc06-relay test` from the repo root) with escalated sandbox permissions (e.g., `sandbox_permissions=require_escalated`) when the environment restricts network access.

```bash
npm test
```

## Implementation Details

### Relay

- Implements NIP-01 message handling: `EVENT`, `REQ`, `CLOSE`, `EOSE`.
- Stores and serves events in-memory, including kinds 30058, 30059, 30060, 30061.
- Supports filtering by `kinds`, `authors`, `since/until`, `#d`, and `#e` tags.
- Performs basic event signature verification.

### Sidecar Publisher

- Publishes NCC-02 Service Record (kind `30059`) with `d`, `u`, `k`, `exp` tags.
- Publishes NCC-05 Locator (kind `30058`) with `d` tag and JSON content.
- Optionally publishes dummy `30060` (attestation) and `30061` (revocation) events for testing.
- Uses `nostr-tools` for event signing.

### Client Resolver & Connector

- Resolves NCC-02 then NCC-05.
- Prefers fresh NCC-05 endpoint; falls back to NCC-02 `u` when NCC-05 is expired.
- Applies TTL/expiry rules deterministically.
- Verifies the placeholder `k` tag for `wss://` endpoints.
- Connects to the resolved endpoint and performs a basic NIP-01 `REQ` roundtrip.
