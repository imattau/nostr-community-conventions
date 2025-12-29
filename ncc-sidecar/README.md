# NCC-06 Sidecar Manager

A multimodal identity manager for Nostr services. It ensures your service (Relay, Blossom, API, etc.) remains discoverable across changing network conditions (Dynamic IP, Tor Onion Services) by automatically maintaining NCC-06 (NCC-02/05) discovery records.

## Features

- **Service Agnostic**: Manage any type of service via a unified identity-bound profile.
- **Multimodal Discovery**: Automatically probes and publishes IPv4, IPv6, and Tor `.onion` endpoints.
- **NIP-46 Integration**: Modern setup flow using Nostr Connect for secure admin authority.
- **SQLite Persistence**: Robust local storage for multiple services, configurations, and publication logs.
- **React Admin Dashboard**: Professional UI for managing services, viewing status, and inviting admins.
- **Smart Change Detection**: Only publishes updates when network conditions change or records expire.

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

## Architecture

- **ncc-06-js**: Core library for record building, resolution, and security validation.
- **Sidecar Process**: Background manager that handles the publication lifecycle.
- **Admin API**: Fastify-based REST API for management.
- **Admin UI**: Vite + React + Tailwind CSS dashboard.

## Security

NCC-06 relies on **SPKI pinning** via the `k` tag. The sidecar manages these pins automatically, ensuring that clients can verify the authenticity of your service's TLS/WSS certificates even when they are self-signed.