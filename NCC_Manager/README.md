# NCC Manager

Web app for drafting, publishing, and verifying NCC, NSR, and endorsement events.

## Run (dev)

```bash
npm install
npm run dev:all
```

Vite runs on `http://localhost:5173` and the API server runs on `http://localhost:5179`.

## Build + run (production)

```bash
npm run build
npm start
```

Then open `http://localhost:5179`.

## Configuration

- `NCC_RELAYS` comma-separated default relays (server-side defaults)
- `PORT` server port (default 5179)
- `NCC_SERVER_STORE` set to `0` to disable server-side storage
- `NCC_MANAGER_DB` override the sqlite DB path (default `NCC_Manager/src/ncc_manager.sqlite`)

## Notes

- Drafts and settings are stored in the browser (IndexedDB + session storage) and also synced to the server when enabled.
- Signing uses NIP-07 when available, or a session-only `nsec` for local signing.
