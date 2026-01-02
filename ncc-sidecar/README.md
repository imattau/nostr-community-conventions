# NCC-06 Sidecar Manager

NCC-06 Sidecar keeps your services (relays, APIs, media, etc.) discoverable on Nostr by continuously maintaining NCC-02/NCC-05 records, probing multiple network interfaces, and publishing authentication-ready metadata whenever endpoints or certificates change.

## Highlights

- **Service-agnostic change detection** watches IPv4, IPv6, and Tor endpoints, TLS fingerprints, and profile metadata so only meaningful updates result in new NCC records.
- **Modern remote administration** uses NIP-46 (Nostr Connect) while still providing the manual `npub`/`nsec` paths, admin alerts, and a local guard that can enforce “localhost only” unless explicitly relaxed.
- **Secure admin notifications** now send straight-up NIP-44 encrypted DMs (no wrappers) so recipients using legacy clients can still decrypt onion or TLS updates.
- **TypeScript-friendly tooling** adds `tsc --noEmit` plus an incremental `tsconfig.json`, giving you zero-effort typechecking for the existing JS codebase alongside ESLint/Lint scripts.
- **Production installer** automates Node download, systemd unit creation, and database placement while also exposing update/reinstall/remove commands for maintenance.

## Getting started

1. **Prepare your environment**
   - Install Node.js 24+ (LTS), npm, and optionally `tor` with control port access (default 9051).
   - Open ports 3000 (REST API/UI) and 5173 (UI dev server) locally unless you plan to use the installer’s `NCC_SIDECAR_ALLOW_REMOTE` flag.

2. **Install dependencies**
   ```bash
   npm run setup
   cd ui && npm install
   ```

3. **Build and run**
   ```bash
   npm run build
   npm start
   ```
   Visit the printed URL (usually `http://127.0.0.1:3000`) to complete the web-based provisioning wizard: connect an admin via NIP-46, authorize the Sidecar Node, then add any custom service profiles.

4. **CLI shortcuts**
   - `npm run first-run` – reset and re-run the provisioning flow.
   - `npm run reset` – delete `sidecar.db`, certificates, and service logs.
   - `npm run test` – run the unit/integration test suites.
   - `npm run lint` – enforce ESLint rules.
   - `npm run typecheck` – run `tsc --noEmit` against `src/`/`test/`/`scripts/`.

## Core workflows

- **Managing services from the UI**
  - Each card displays the service identifier (`d`, `npub`), discovered endpoints per family, TLS fingerprints, and last publish time.
  - The profile editor shares the same familiar controls for secrets, endpoint rotation, TLS regeneration, and recipient management – all actions trigger a publish cycle with helpful log metadata.
  - Use the “Force Connection” modal to validate admins manually (via `npub` hex or `nsec`) when remote clients struggle.

- **Publication relays & logs**
  - Publication relays are shared across services; update them once through the “Publishing Relays” modal under the hamburger menu.
  - System logs now expand with rich metadata: event IDs (NCC-02/NCC-05/kind-0), locator payloads, TLS fingerprints, and per-relay publish results.
  - Log entries become actionable when you click them, showing details like `reason`, `publicationRelays`, and `privateRecipients`.

- **Nostr list backups**
  - Use the “Nostr list backup” controls on the database card to export a signed Generic List (kind `30001`) event that captures sanitized services, recipients, and app settings without leaking secrets.
  - Paste the event back into the same UI or POST it to `/api/backup/list` to restore matching services (by `service_id`) and app settings; the endpoint validates the signature before applying the update so only the authorized sidecar identity can perform restores.
  - The backup event is published automatically whenever the sidecar detects configuration changes, and the UI pulls the most recent list as soon as you log in, with built-in throttling so relay traffic stays reasonable.

- **Remote signer & notifications**
  - The remote signer (Amber, Nex, Bunker) handshake shows a QR code, relay health, and logs; the relay list is configurable and can fall back to any working `wss://` endpoints.
  - Admin alerts (e.g., onion rotations) are delivered as direct NIP-44 messages, so clients that only speak “Legacy Standard” still decrypt the updates.

## Installation options

- **From source (development)**
  ```bash
  npm run setup
  npm run build
  npm start
  ```

- **Production installer**
  ```bash
  cd ncc-sidecar
  sudo ./scripts/install-sidecar.sh [command] [flags]
  ```
  Commands: `install`, `update`, `reinstall`, `remove`. Flags configure install dir, data dir, service user, publication relays, `NCC_SIDECAR_ALLOW_REMOTE`, and even the npm package to deploy. The script bundles Node.js 24+ automatically if your machine lacks it.

## Tooling & validation

- `npm run lint` – run ESLint across `src/` and `test/`.
- `npm run typecheck` – execute `tsc --noEmit` using the provided `tsconfig.json`. (It runs in JS mode but keeps incremental artifacts in `tsconfig.tsbuildinfo`.)
- `npm run test` – run the built-in database, integration, and web tests to ensure services publish correctly, change detection works, and the UI flow completes.

## Architecture & security

- **Sidecar daemon** – `src/app.js`, `builder.js`, `publisher.js`, and `inventory.js` handle probing, change detection, and NCC-02/05 record generation.
- **Admin API** – `src/web.js` exposes REST endpoints for services, relays, database management, and TLS/key regeneration.
- **Database** – `better-sqlite3` backfills `config`, `service`, and `log` tables in `sidecar.db`.
- **Security** – TLS fingerprints (`k` tags), NIP-44 encrypted DMs for admin notifications, and optional DB password protection keep the environment auditable and locked down.

## Support

- `read-logs.js` and `check-services.js` help diagnose issues outside the UI.
- Browser extensions (Firefox + Chromium) fetch NCC-02 records from relays to visualize service metadata and TLS fingerprints.
- If you run into problems, the system logs and annotated publish metadata provide insight into which relay, event, or endpoint misbehaved.
