# NCC-06 Relay Sidecar

A standalone, service-agnostic companion process that keeps your Nostr service NCC-06 compliant by automatically publishing and refreshing NCC-02 Service Records and NCC-05 Locators.

## Features

- **Automated Publication:** Handles Kind 30059 (NCC-02) and Kind 30058 (NCC-05) events.
- **Redundant Delivery:** Publishes to a configurable Publication Relay Set.
- **Security First:** Automatically extracts SPKI fingerprints (`k` tags) for secure endpoints.
- **Change Detection:** Automatically republishes if your endpoints or keys change.
- **Scheduler:** Periodic refresh with jitter to keep records fresh.
- **Deterministic:** Ensures stable ordering of endpoints and consistent record IDs.

## Installation

```bash
cd relay-sidecar
npm install
```

## Configuration

Copy `config.example.json` to `config.json` and update the values:

```json
{
  "service_nsec": "nsec1...",
  "endpoints": [
    { "url": "wss://relay.example.com", "priority": 10 }
  ],
  "publication_relays": [
    "wss://relay.damus.io",
    "wss://nos.lol"
  ]
}
```

## Usage

### Run as a Daemon
```bash
npm start
```

### Force Publish Now
```bash
npm run publish
```

### Check Status
```bash
npm run status
```

### Preview Inventory
```bash
node src/index.js inventory
```

## Architecture

1. **Inventory:** Probes configured endpoints, fetches TLS fingerprints if missing.
2. **Builder:** Assembles NCC-02 and NCC-05 events using the `ncc-06-js` library.
3. **Publisher:** Delivers events to multiple relays with retry logic.
4. **Scheduler:** Triggers updates based on change detection or refresh intervals.
