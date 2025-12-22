# NCC Manager

Web app for drafting, publishing, and verifying NCC, NSR, and endorsement events that ships as a CLI + Express server.

## Install & run

### Run without installing globally

```bash
npx @0xx0lostcause0xx0/ncc-manager
```

This builds the UI (if needed), serves `dist/` via Express, and opens your browser automatically. Use `--no-open` to skip the browser launch, e.g., `npx ncc-manager --no-open`.

### Global install

```bash
npm install -g @0xx0lostcause0xx0/ncc-manager
ncc-manager
```

You can also set the host/port on the CLI:

```
ncc-manager --host 0.0.0.0 --port 4322 --no-open
```

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

You can publish supporting document events (kind: 30053) via the *Supporting Docs* view in the sidebar. At minimum you must supply:

- **Document ID (`d`)**: unique per author (no enforced prefix).
- **For NCC (`for`)**: which NCC this document supports; it must start with `ncc-`.
- **Title** and **Published at**: the document metadata.

Additional optional tags are available (for_event, type, language, topics, authors, license) to mirror Appendix E. The editor validates the required relationships before allowing publication.

## Caching & offline mode

- NCC documents fetched from relays are cached in `localStorage` per relay list for five minutes (TTL). The refresh button forces a new fetch, but when the cache is fresh or you’re offline the cached data is reused so you don’t hit the relays unnecessarily.
- The UI listens for `online`/`offline` events and informs you via toasts; drafts are always saved locally (IndexedDB + the server’s SQLite store) even when no network is available.
- Publishing while offline will still attempt to connect to relays, but you can keep editing drafts locally and publish once connectivity returns.

### Database location

By default the server stores drafts at the OS-specific data path provided by [`env-paths`](https://www.npmjs.com/package/env-paths); for example:

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
