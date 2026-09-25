# NCC Service Catalog (Chrome / Brave / Chromium)

This lightweight Chromium-family extension queries NCC-02 service records from configurable Nostr relays and keeps a live catalogue inside the toolbar popup. The background page shares identical logic with the Firefox build, so service discovery follows the same flow.

## Getting started

1. Navigate to `chrome://extensions` (or `edge://extensions` / `brave://extensions` for the respective Chromium fork).
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select this folder.
4. Click the toolbar button to open the catalogue popup, adjust the relay list if desired, and tap **Refresh Catalogue**.

## Notes

- The background page maintains a simple cache of service entries using `storage.local` so the catalogue survives popup reloads.
- Each refresh opens WebSocket connections to the listed relays, subscribes for `kind:30059` events, and closes once the relays signal completion or a 15-second timeout elapses.
- Use newline/comma-separated relay URIs; the extension normalizes them to `ws://`/`wss://` schemes and falls back to the default bundle if none are provided.
