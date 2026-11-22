# NCC Viewer

Lightweight server + UI for browsing Nostr Community Conventions (NCC), succession records (NSR), and endorsement signals.

## Run the web server

```bash
npm install
npm start
```

Then open `http://localhost:4321`. The server build retains the `/api/*` endpoints for deployments that want server-side relay aggregation.

## Static build and NIP-5A

The viewer UI can run without an application server: it queries Nostr relays directly from the browser and stores relay preferences and its list cache in local storage. Build it with:

```bash
npm install
npm run build
```

The static site is written to `dist/` and contains the index, NCC detail, proposal, and endorsement pages. Upload the files in `dist/` to Blossom and publish a NIP-5A root (`15128`) or named (`35128`) site manifest whose `path` tags map each file to its SHA-256 hash. The manifest should include a `server` tag for the Blossom host. Relay connectivity and browser CORS support are required; the Express API is not used by the static build.

## Signing and endorsements

All pages support NIP-07 browser extensions and NIP-46 remote signers. On an NCC detail page, connect a signer and use **Publish endorsement** to sign a kind `30052` event. The viewer publishes to the account's latest NIP-65 (`10002`) relays marked for writing (unmarked `r` entries are treated as read/write), along with the viewer's configured relays. NIP-46 supports `bunker://` connection strings and a generated `nostrconnect://` URI; keep the page open until the remote signer connects.

The same static assets and signing flows are included in nsite builds. Nsite hosting must permit browser connections to the chosen relays and signing extension.

## Configuration

- `NCC_RELAYS` comma-separated list of relays
- `NCC_CACHE_TTL_MS` cache refresh interval in milliseconds (default 60000)
- `NCC_SINCE_SECONDS` server-side unix timestamp to limit history (default 0)
- `PORT` server port (default 4321)

## Docker

```bash
docker build -t ncc-viewer .
docker run -p 4321:4321 ncc-viewer
```

Or with compose:

```bash
docker compose up --build
```

## Local testing

Run directly with Node:

```bash
npm install
npm start
```

Override relays or port for local testing:

```bash
NCC_RELAYS="wss://relay.damus.io" PORT=4322 npm start
```

## VPS reverse proxy (optional)

### Nginx

```nginx
server {
  listen 80;
  server_name ncc.example.com;

  location / {
    proxy_pass http://127.0.0.1:4321;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

### Caddy

```caddy
ncc.example.com {
  reverse_proxy 127.0.0.1:4321
}
```
