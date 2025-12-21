# NCC Viewer

Lightweight server + UI for browsing Nostr Community Conventions (NCC), succession records (NSR), and endorsement signals.

## Run

```bash
npm install
npm start
```

Then open `http://localhost:4321`.

## Configuration

- `NCC_RELAYS` comma-separated list of relays
- `NCC_CACHE_TTL_MS` cache refresh interval in milliseconds (default 60000)
- `NCC_SINCE_SECONDS` unix timestamp to limit history (default 0)
- `PORT` server port (default 4321)
