# NCC-06 Minimal Relay + Sidecars + Simple Client (Node.js)

This project pairs a Node.js-based NIP-01 relay with Node.js sidecar and client helpers to exercise the NCC-06 conventions for discovery and resolver-driven trust. The relay, sidecar, and `ncc06-client` harness are all JavaScript modules that cooperate to publish NCC-02/NCC-05 data and resolve identity URIs.

## Project Structure

- `lib/relay.js`: The Node relay implementation delivering a protocol-dumb NIP-01 server that stores events and serves filters.
- `scripts/run-relay.js`: Launches the Node relay using `config.json`.
- `certs/`: TLS key/cert pair used by the `wss://` interface (packaged for the harness).
- `ncc06-sidecar/`: Contains scripts for publishing NCC-00, NCC-02, and NCC-05 events to the relay, plus the `external-endpoints` helpers that assemble onion/IPv6/IPv4 locator lists from operator-configured reachability.
- `ncc06-client/`: Contains the client-side resolver and connector logic for NCC-06.
- `../ncc-06-js/`: Companion npm package containing shared NCC-02/NCC-05 builders, selectors, and resolver helpers that the client harness now reuses.
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

### Bootstrap secrets

After installing dependencies, run the helper scripts to generate the ignored config files and TLS keys that the relay, sidecar, and client expect:

```bash
npm run ensure-configs
npm run ensure-certs
```

`npm run ensure-configs` produces `ncc06-sidecar/config.json` and `ncc06-client/config.json` with deterministic service identities and locator secrets derived from stable seeds, while `npm run ensure-certs` creates the self-signed key/cert pair under `certs/` (both directories are already ignored). These commands also run automatically before `npm test`, so you typically only need to run them manually if you delete the generated artifacts.

### Configuration

All configuration is managed in `config.json` files.

- `config.json` (root): Global settings, including default relay ports, TLS paths, and logging controls.
- `ncc06-sidecar/config.json`: Sidecar-only settings covering the service keypair, NCC-02/NCC-05 metadata, and optional Tor control values.
- `ncc06-client/config.json`: Client-only settings such as the service identity URI, expected `k`, TTL overrides, and locator secrets.
- `ncc06-sidecar/config.example.json` and `ncc06-client/config.example.json`: Template files you can copy, edit, or inspect before generating the actual `config.json` payloads.

The per-component config files are intentionally ignored by Git because they carry private material. Run `npm run ensure-configs` to generate them automatically (you can also customize the template files and rerun the command). The generated values are deterministic, so the sidecar/client keep working even if you regenerate them.

**NOTE:** For this minimal harness, `k` is treated as a required tag for `wss` endpoints and uses a placeholder scheme like `TESTKEY:<string>`. The client compares the received `k` to the expected string in its config instead of relying on Web PKI.

- `config.json` powers both the discovery relay (`ws://127.0.0.1:7000`) and the secure WSS endpoint (`wss://127.0.0.1:7447`). TLS material lives under `certs/` and is consumed purely for encrypted transport; authenticity still comes from NCC-02 `k`.
- `ncc06-sidecar/config.json` captures the service identity (`serviceSk`, `servicePk`, `serviceNpub`) plus NCC-02/NCC-05 metadata (`serviceId`, `locatorId`, TTL values, and the placeholder `k` value `TESTKEY:relay-local-dev-1`).
- `ncc06-sidecar/config.json` captures the service identity plus `ncc02ExpectedKey` and `ncc02ExpectedKeySource`; by default the harness uses `TESTKEY:relay-local-dev-1`, but you can set `NCC06_NCC02_KEY_SOURCE=cert` before running `npm run clean-configs` to compute `k` from the TLS certificate (`config.json`’s `relayTlsCert`).
- The sidecar can optionally contact Tor’s control port (`torControl.enabled`) to provision a v3 onion service and publish `ws://<onion>.onion` locators (no `k` tag is required for onion entries).
- `ncc06-client/config.json` resolves `serviceIdentityUri` (e.g., `wss://<service_npub>`), derives the pubkey, and enforces NCC-02/NCC-05 ordering and `k` verification before connecting.
- `config.json` also exposes `relayBindHost` and `relayWssBindHost` to let the relay process bind to a separate interface (e.g., `0.0.0.0`) when the advertised host (`relayHost`) must stay at `127.0.0.1` so clients can connect. Adjust the bind hosts when the sandbox/environment prohibits listening directly on the advertised address.

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
`npm test` now runs `npm run clean-configs` automatically before generating secrets, so you can toggle `NCC06_NCC02_KEY_SOURCE` or TLS material and trust the regenerated configs. Run `npm run clean-configs` manually whenever you need to reseed the sidecar/client secrets.

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
- The resolver now reuses the shared `ncc-06-js` helpers (`choosePreferredEndpoint`, `normalizeLocatorEndpoints`, etc.) so the deterministic logic can be reused by downstream projects and the tests.

### Testing Enhancements

- Additional integration scenarios now cover multiple resolvers running concurrently plus a group-wrapped NCC-05 locator so you can observe how the resolver decrypts multi-recipient locators and shares the load; these rely on the deterministic configs produced by `npm run clean-configs`.
