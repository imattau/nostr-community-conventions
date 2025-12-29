# NCC Service Catalog (Firefox)

This lightweight Firefox extension queries NCC-02 service records from configurable Nostr relays and exposes a quick catalogue inside the popup UI. It pockets discovered endpoints, TLS fingerprints, and the relays that reported them.

## Getting started

1. Open `about:debugging` and click **This Firefox**.
2. Choose **Load Temporary Add-on...** and pick `manifest.json` from this folder.
3. Click the toolbar button to open the catalogue popup, adjust the relay list if desired, and tap **Refresh Catalogue**.

## Notes

- The background script maintains a simple cache of service entries using `storage.local` so the catalogue survives popup reloads.
- Each refresh opens WebSocket connections to the listed relays, subscribes for `kind:30059` events, and closes once the relays signal completion or a 15-second timeout elapses.
- Use newline/comma-separated relay URIs; the extension normalizes them to `ws://`/`wss://` schemes and falls back to the default bundle if none are provided.
