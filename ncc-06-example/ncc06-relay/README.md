# NCC-06 Minimal Relay + Sidecars + Simple Client (Node.js)

This project pairs a Node.js-based NIP-01 relay with Node.js sidecar and client helpers to exercise the NCC-06 conventions for discovery and resolver-driven trust. The relay, sidecar, and `ncc06-client` harness are all JavaScript modules that cooperate to publish NCC-02/NCC-05 data and resolve identity URIs.

## Project Structure

- `lib/relay.js`: The Node relay implementation delivering a protocol-dumb NIP-01 server that stores events and serves filters.
- `scripts/run-relay.js`: Launches the Node relay using `config.json`.
- `certs/`: TLS key/cert pair used by the `wss://` interface (packaged for the harness).
- `ncc06-sidecar/`: Contains scripts for publishing NCC-00, NCC-02, and NCC-05 events to the relay.
- `ncc06-client/`: Contains the client-side resolver and connector logic for NCC-06.
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
- `ncc06-sidecar/config.json`: Specific configuration for the sidecar publisher, including the private key for publishing.
- `ncc06-client/config.json`: Specific configuration for the client, including the public key of the service to resolve and expected `k` value.
- `ncc06-sidecar/config.json`: now optionally includes a `torControl` block so the sidecar can provision a Tor v3 hidden service and publish `ws://<onion>.onion` locators.

**NOTE:** For this minimal harness, `k` is treated as a required tag for `wss` endpoints, but uses a fixed placeholder scheme like `TESTKEY:<string>`. The client "verifies" `k` by comparing it to an expected string in its config.

- `config.json` now powers both the discovery relay (ws://127.0.0.1:7000) and the secure wss endpoint (`wss://127.0.0.1:7447`). The TLS key/cert pair live under `certs/` and are consumed by the Node relay purely as encrypted transport; their fingerprints are asserted through NCC-02 `k` rather than Web PKI, and the client never performs traditional CA validation.
- `ncc06-sidecar/config.json` stores the relay’s service identity (`serviceSk`, `servicePk`, `serviceNpub`) together with the NCC-02/NCC-05 metadata (service id, locator id, TTLs, and the placeholder `k` value `TESTKEY:relay-local-dev-1`).
- The sidecar can optionally connect to Tor’s control port (`torControl.enabled`) to create a v3 onion service pointing at the relay port; the generated `ws://<onion>.onion` endpoint is published inside NCC-05 (no `k` tag is applied to onion).
- `ncc06-client/config.json` now provides `serviceIdentityUri` (e.g., `wss://<service_npub>`). The resolver derives the pubkey from that identity and verifies matching `k` tags before connecting to whichever concrete endpoint the NCC-02/NCC-05 resolution returns; the TLS cert is only used for encryption, not trust.

### Running the Components

#### 1. Start the relay (Node.js)

`scripts/run-relay.js` (invoked via `npm run relay`) launches the Node-based relay under `lib/relay.js` using `config.json`.  
```bash
npm run relay
```
There is no compilation step for the JavaScript relay; `relay:build` simply reports that there is nothing to build.
```bash
npm run relay:build
```

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

This command will start the Node relay (via `scripts/run-relay.js`) and then run the sidecar publisher.

```bash
npm run start-local-env
```

### Running Tests

> **Note:** The test suite starts the relay/sidecar and uses WebSocket networking, so run `npm test` (or `npm --prefix ncc06-relay test` from the repo root) with escalated sandbox permissions (e.g., `sandbox_permissions=require_escalated`) when the environment restricts network access.

```bash
npm test
```

You can also verify style and types with:

```bash
npm run lint
npm run typecheck
```

## Implementation Details

### Relay

- Implemented in Node.js via `lib/relay.js`, the relay handles the standard NIP-01 verbs (`EVENT`, `REQ`, `CLOSE`, `EOSE`) while remaining protocol-dumb.
- Stores events in-memory and serves filters that touch `kinds`, `authors`, `since`/`until`, and `#d`/`#e` tags.
- Validates incoming events via `nostr-tools` before responding with `OK` and notifying open subscriptions.
- TLS material (from `certs/`) is used only for encrypting traffic; endpoint authenticity and `k` pinning stay on the NCC-02/NCC-05 client path.
- `scripts/run-relay.js` launches the Node relay directly without any build step.

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
