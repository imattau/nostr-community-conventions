# NCC-02 + NCC-05 Toy App

A demonstration of using **NCC-02 (Public Service Records)** and **NCC-05 (Private Service Locators)** together.

## Features

- **Public Discovery**: Publishes a public service record (NCC-02).
- **Private Override**: Publishes an encrypted private locator (NCC-05).
- **Resolution Logic**:
    1.  Resolves public record.
    2.  Attempts to resolve private record (if authorized).
    3.  If private record is found and valid, it **overrides** the public endpoint.
    4.  Otherwise, falls back to the public endpoint.
- **Simulation**: Runs against an in-memory mock relay network for instant, reliable testing.

## Prerequisites

- Node.js (v18+)
- npm

## Setup

```bash
npm install
npm run build
```

## Usage

### Run Tests (Simulation)

Run the integration tests to see the full flow in action:

```bash
npm test
```

### CLI

You can also use the CLI manually (it will use the configured simulation relays, which are in-memory, so distinct runs won't share state unless you modify `src/config.ts` to use real relays and rebuild).

**Note:** Since the default config uses mock relays `ws://mock-relay.local`, the CLI will try to connect to them. Since they don't exist outside the test process, the CLI won't work against them.
To use the CLI against real relays, edit `src/config.ts` to use real relays (e.g., `wss://relay.damus.io`).

## Project Structure

- `src/publish.ts`: Publishes NCC-02 and NCC-05 records.
- `src/resolve.ts`: Implements the resolution and override logic.
- `src/adapter.ts`: Adapter to make `nostr-tools` SimplePool compatible with `ncc-02-js`.
- `src/simulation.ts`: In-memory Nostr relay simulation.
- `test/integration.test.ts`: End-to-end tests.
