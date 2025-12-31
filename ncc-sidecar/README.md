# NCC-06 Sidecar Manager

A multimodal identity manager for Nostr services. It ensures your service (Relay, Blossom, API, etc.) remains discoverable across changing network conditions (Dynamic IP, Tor Onion Services) by automatically maintaining NCC-06 (NCC-02/05) discovery records.

## Features

- **Service Agnostic**: Manage any type of service via a unified identity-bound profile.
- **Multimodal Discovery**: Automatically probes and publishes IPv4, IPv6, and Tor `.onion` endpoints.
- **NIP-46 Integration**: Modern setup flow using Nostr Connect for secure admin authority.
- **SQLite Persistence**: Robust local storage for multiple services, configurations, and publication logs.
- **React Admin Dashboard**: Professional UI for managing services, viewing status, and inviting admins.
- **Smart Change Detection**: Only publishes updates when network conditions change or records expire.

## Recent updates

- **Admin notification messages** now wrap the NIP-44 ciphertext inside a NIP-17 envelope, keeping the encrypted alerts compatible with modern Nostr clients and covered by `test/dm.test.js`.
- **Timestamps in the admin UI** render with the viewer’s timezone context so every log row clearly states when an action occurred in your locale.

## Quick Start

```bash
# Install dependencies
npm run setup

# Build the admin UI
npm run build

# Start the manager
npm start

# Force reset and re-run setup wizard
npm run first-run

# Wipe all data and exit (factory reset)
npm run reset
```

## Running NCC-06 Sidecar

1. **Prerequisites**
   - Node.js 24+ (LTS) installed.
   - Ports 3000 (API/UI) and 5173 (UI dev) accessible locally.
   - Optional Tor control credentials if you intend to publish `.onion` endpoints.

2. **Initialize**
   - Start the app (`npm start`).
   - Visit `http://127.0.0.1:3000` (or the printed URL after startup) to launch the React dashboard.
   - Authenticate via Nostr Connect (NIP-46) or paste an admin `npub` manually in the “Force Connection” dialog. The dashboard will store the verified pubkey in local storage so you stay logged in even after restarts.
   - The provisioning wizard runs automatically the first time you connect, creating the Sidecar Node service and generating TLS certs if configured.

3. **Managing Services**
   - Each service card shows the public `d`/`npub`, discovered endpoints (IPv4, IPv6, Tor), TLS fingerprint, and last publish timestamp.
   - Click the card to edit the profile. Fields include `Name`, `About`, and `Picture`, along with the ability to add private recipients (`ncc05_recipients`).
   - Regenerating TLS certs is handled either from the card (for self-signed services) or the “Danger Zone” section inside the editor. The new fingerprint is used on the next publish cycle.
   - Service visibility modes: `public` records include endpoints/`k`; `private` records omit them and require `ncc-05` recipients plus publication relays to deliver locator payloads securely.

4. **Publication Relays**
   - Use the hamburger menu → “Publishing Relays” to adjust the shared relay list. Enter one `wss://` endpoint per line; non-`ws` values are normalized for you.
   - Saving relays propagates the list to every stored service, so the next publish cycle uses the updated set immediately.
   - Click “Republish All” to force every service to send its NCC-02/NCC-05/kind-0 records out over the current relay list and auto-refresh the system logs with the rich metadata that now includes event IDs, content, fingerprints, and publish results per relay.

5. **System Logs & Troubleshooting**
   - The log panel lists recent actions (publish cycles, errors, TLS regeneration, forced republish) with timestamps.
   - Click a log entry to expand detailed metadata: NCC-02/NCC-05/kind-0 IDs, locator payloads, primary endpoint info, and any private recipient list.
   - Use this view to confirm endpoints, fingerprints, and publication successes/failures on specific relays (the most common failures are connectivity issues or HTTP 301 redirect responses, which indicate you need the direct `wss://` URL).

6. **Additional Tools**
   - The Firefox extension `extensions/ncc-service-catalog-firefox` can subscribe to relays, collect NCC-02 cards, and show metadata, NPUBs, and the display name derived from kind-0 events. Install it to monitor how others see your published records.
   - `read-logs.js`, `check-services.js`, and the integration tests in `ncc-sidecar/test/` help you validate that the publication pipeline is healthy.

7. **Operational Notes**
   - To run NCC-06 Sidecar under a service manager, point your unit (systemd, launchd, etc.) at `node src/index.js` with the repo as your working directory. Ensure the service has read/write access to `sidecar.db` and the `certs/` folder where TLS material is stored.
   - Use `npm run reset` only when you need a clean slate; data, services, and logs are erased.

## Architecture

- **ncc-06-js**: Core library for record building, resolution, and security validation.
- **Sidecar Process**: Background manager that handles the publication lifecycle.
- **Admin API**: Fastify-based REST API for management.
- **Admin UI**: Vite + React + Tailwind CSS dashboard.

## Security

NCC-06 relies on **SPKI pinning** via the `k` tag. The sidecar manages these pins automatically, ensuring that clients can verify the authenticity of your service's TLS/WSS certificates even when they are self-signed.

## Automated installation

For production deployments you can use the installer inside this package:

```bash
cd ncc-sidecar
sudo ./scripts/install-sidecar.sh [flags]
```

Available flags:

| Flag | Default | Description |
| --- | --- | --- |
| `--install-dir` | `/opt/ncc-sidecar` | Where the source is deployed |
| `--data-dir` | `/var/lib/ncc-sidecar` | Location of `sidecar.db`, TLS certs, and runtime files |
| `--service-user` | `ncc-sidecar` | Linux user that owns the daemon |
| `--repo-source` | current checkout | Git URL or path to the sources to build; clones automatically when a remote is provided |
| `--allow-remote` | `false` | Sets `NCC_SIDECAR_ALLOW_REMOTE=true` for remote admin access |
| `--npm-package` | (none) | npm package (e.g. `ncc-sidecar@latest`) to install instead of a local repo |

The script copies or clones the code, installs Node and UI dependencies, rebuilds the frontend, links the data directory, and installs/enables `ncc-sidecar.service` with `NCC_SIDECAR_DB_PATH` already configured. Re-running the script updates the install and restarts the systemd service, so it doubles as your update path.

If `node`/`npm` are missing, the installer downloads Node.js 24.x for the appropriate Linux architecture (using `curl` and `tar`) into `$INSTALL_DIR/.node` and uses that runtime for building and running the service. Update/reinstall commands now reuse the cached runtime so you do not redownload Node every time.

The installer now accepts commands before the options. The default action is `install`. You can also use:

| Command | Description |
| --- | --- |
| `install` | Full install (default) |
| `update` | Pull/build fresh artifacts without deleting data |
| `reinstall` | Remove the current install and data, then run `install` |
| `remove` | Uninstall the service, delete the data directory, and delete the service user |

`update` simply stops the service, re-syncs the source, rebuilds the UI, rewrites the systemd unit, and restarts the daemon. `reinstall` first removes everything (service, data, user) and then performs a clean `install`. If `--npm-package` is provided, the installer fetches that tarball via `npm pack` and performs the build/install from its contents rather than cloning a git repo.
