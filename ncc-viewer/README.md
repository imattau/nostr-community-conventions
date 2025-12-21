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
