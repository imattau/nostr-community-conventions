# NCC Manager

Web app for drafting, publishing, and verifying NCC, NSR, and endorsement events that ships as a CLI + Express server.

## Install & run

### Run without installing globally

```bash
npx ncc-manager
```

Since the package exposes a `bin` entry for `ncc-manager` you can also run `npx @0xx0lostcause0xx0/ncc-manager` if you prefer the scoped reference. The CLI builds `dist/` (if needed), starts the Express server, and opens your browser automatically. Pass `--no-open` to skip launching the browser or `--host/--port` to override the defaults (`127.0.0.1` and `5179`).

### Global install

```bash
npm install -g @0xx0lostcause0xx0/ncc-manager
ncc-manager
```

The globally installed CLI also respects `--host`, `--port`, and `--no-open`:

```
ncc-manager --host 0.0.0.0 --port 4322 --no-open
```

## Documentation

- [Architecture Overview](docs/architecture.md) - System design and data flow.
- [Nostr Event Kinds](docs/event-kinds.md) - Details on Kind 30050, 30051, 30052, and 30053.
- [Internal API](docs/api.md) - Documentation for the local REST API.
- [Chain Validation](docs/validation.md) - Explanation of the NCC validation logic.

## Development

```bash
npm ci
npm run build
npm start
```

`npm start` runs `NODE_ENV=production node server.js`, so it is safe to point browsers at the published UI (`http://localhost:5179` by default).

Use `npm run dev:all` for the Vite dev server + Express API combo during active development.

## Configuration

- `NCC_RELAYS`: comma-separated list of relays used by the server default response.
- `PORT`: server HTTP port (default `5179`). Use the CLI `--port` flag instead when running via `ncc-manager`.
- `HOST`: host to bind. Default `127.0.0.1`; override via the CLI `--host`.
- `NCC_SERVER_STORE`: set to `0` to turn off server-side storage.
- `NCC_MANAGER_DB`: full path to the SQLite file if you need to place it somewhere else (default is per-user storage).

## Supporting documents

You can publish supporting document events (kind: 30053) via the _Supporting Docs_ view in the sidebar. At minimum you must supply:

- **Document ID (`d`)**: unique per author (no enforced prefix).
- **For NCC (`for`)**: which NCC this document supports; it must start with `ncc-`.
- **Title** and **Published at**: the document metadata.

Additional optional tags are available (for_event, type, language, topics, authors, license) to mirror Appendix E. The editor validates the required relationships before allowing publication.

## Caching & offline mode

- NCC documents fetched from relays are cached in `localStorage` per relay list for five minutes (TTL). The refresh button forces a new fetch, but when the cache is fresh or you’re offline the cached data is reused so you don’t hit the relays unnecessarily.
- The UI listens for `online`/`offline` events and informs you via toasts; NCC/endorsement events fetched from relays are cached in `localStorage` for five minutes per relay set, so you still see data when temporarily offline.
- Drafts are persisted via the server’s SQLite store whenever it is reachable, and a fallback in-memory cache keeps the most recent drafts available even while offline. Publishing while offline will queue the request but eventually retries the relay publish attempts once connectivity returns.

### Database location

By default the server stores drafts at the OS-specific data path provided by [`env-paths`](https://www.npmjs.com/package/env-paths), ensuring writable locations even for global installs. For example:

- Linux: `~/.config/ncc-manager/ncc_manager.sqlite`
- macOS: `~/Library/Application Support/ncc-manager/ncc_manager.sqlite`
- Windows: `%APPDATA%\\ncc-manager\\ncc_manager.sqlite`

Set `NCC_MANAGER_DB` to a custom full path if you need to colocate the database elsewhere (e.g., on a shared drive).

## Testing & packaging

- `npm run pack:test`: builds the UI, runs `npm pack`, installs the generated tarball globally, and verifies `ncc-manager --no-open` starts cleanly. It does not automatically uninstall anything.
- `npm run build`: compile the Vite app into `dist/`.

## Publishing

1. `npm run build` (ensures `dist/` exists for publishing).
2. `npm run pack:test` to sanity-check the packed package.
3. `npm publish --access public` (or via your CI) once the package is ready.

The package publishes `dist/`, `server.js`, `src/`, `bin/`, `README.md`, and `LICENSE` thanks to the `files` entry in `package.json`. The `prepublishOnly` hook keeps `dist/` up to date before every publish.
