# ncc-06-js

Reusable helpers extracted from the NCC-06 example relay, sidecar, and client implementations. This package focuses on the core utilities that compose NCC-02, NCC-05, and NCC-06 resolution and trust semantics without bundling a relay, sidecar, or heavy client.

## Key features

- **NCC-02 builders & validators** (`buildNcc02ServiceRecord`, `parseNcc02Tags`, `validateNcc02`) that manage the `d`, `u`, `k`, and `exp` tags a service record must expose.
- **NCC-05 helpers** (`buildLocatorPayload`, `normalizeLocatorEndpoints`, `validateLocatorFreshness`) that assemble locator payloads, parse stored JSON, and enforce TTL/`updated_at` freshness rules.
- **Deterministic NCC-06 resolution** via `choosePreferredEndpoint` and `resolveServiceEndpoint`. It queries bootstrap relays, prefers fresh NCC-05 locators, verifies `k` fingerprints for any secure protocol (`wss://`, `https://`, etc.), and falls back to NCC-02 `u` values.
- **Service-Agnostic Helpers:** While originally built for relays, all helpers support generic `serviceUrl`, `serviceMode`, and custom `allowedProtocols`.
- **External endpoint helpers** (`buildExternalEndpoints`, `detectGlobalIPv6`, `getPublicIPv4`) so services can declare onion/IPv6/IPv4 reachability in a reproducible order.
...
- **Sidecar config helpers** (`buildSidecarConfig`, `buildClientConfig`) so you can reuse the same config generation logic. Supports `serviceUrl` and `serviceMode` aliases for broader application.
...
- **Relay & Service mode helpers** (`getRelayMode`, `setRelayMode`) so you can control whether your service is *public* (publishes NCC-05 locators) or *private`.

## Why NCC-06? (Identity vs Location)

Unlike DNS, which binds a service to a **location** (domain/IP), NCC-06 binds a service to an **identity** (Public Key / Npub).

- **Portability:** Move your service to a new IP, Tor address, or provider instantly. Clients follow the *key*, not the server.
- **Censorship Resistance:** Discovery happens via decentralized relays, not centralized root servers.
- **Trust:** End-to-end authentication is built-in. The "K" fingerprint ensures the server you connect to is authorized by the identity you resolved.

## Usage

Install directly from the repository (example workspace):

```bash
npm install ../ncc-06-js
```

### Resolving an HTTP API Service

```js
import { resolveServiceEndpoint } from 'ncc-06-js';

// "Bootstrap Relays" act as the decentralized directory for finding the service's current location.
const resolution = await resolveServiceEndpoint({
  bootstrapRelays: ['wss://relay.damus.io'],
  servicePubkey: '...',
  serviceId: 'my-api',
  locatorId: 'api-locator',
  expectedK: '...', // SPKI fingerprint for HTTPS pinning
  allowedProtocols: ['https', 'http'] // Override default [wss, ws]
});

console.log('Resolved API endpoint:', resolution.endpoint);
```

### Resolving a Tor Service via Npub

```js
import { resolveServiceEndpoint, fromNpub } from 'ncc-06-js';

const servicePubkey = fromNpub('npub1...');

const resolution = await resolveServiceEndpoint({
  bootstrapRelays: ['wss://relay.damus.io'],
  servicePubkey,
  serviceId: 'relay',
  locatorId: 'relay-locator',
  torPreferred: true // Prefer .onion endpoints if available
});

console.log('Resolved Onion Endpoint:', resolution.endpoint);
```

### Configuring an Onion Service Sidecar

```js
import { buildExternalEndpoints, buildSidecarConfig } from 'ncc-06-js';

// 1. Build endpoints (detects Onion, IPv6, IPv4)
const endpoints = await buildExternalEndpoints({
  tor: { enabled: true },
  ensureOnionService: async () => ({ address: 'abcdef...', servicePort: 80 })
});

// 2. Build config
const config = buildSidecarConfig({
  secretKey: '...',
  serviceUrl: 'ws://abcdef....onion', // Primary identity URL
  externalEndpoints: endpoints,
  serviceMode: 'public'
});
```

### Building a Service Config (No DNS)

```js
import { buildSidecarConfig } from 'ncc-06-js';

const config = buildSidecarConfig({
  secretKey: '...',
  serviceUrl: 'tcp://203.0.113.1:9000', // Direct IP or any URI scheme
  serviceId: 'my-custom-service',
  serviceMode: 'public'
});
```

The package exposes modular helpers so you can keep using your own transport stack while reusing deterministic NCC-06 behaviour.

## Trust model

- `k` is the binding between NCC-02/NCC-05 records and the transport-level key (TLS/SPKI) that serves the endpoint.
- This applies to **any secure protocol** (`wss://`, `https://`, `tls://`, `tcps://`).
- **Trust Model:** This mimics DANE: the `k` tag pins the expected SPKI fingerprint of the endpoint's certificate.
- **Self-Signed vs CA:** You can use **self-signed certificates** or CA-signed ones. The security comes from the NCC record's signature (the Identity) pinning the transport key, not from a centralized CA.
- **Verification:** The shared helpers compare the endpoint's actual fingerprint against the published `k` value. This allows clients to securely connect to self-signed endpoints without security warnings, provided the NCC record is valid.

## Reference Docs

Detailed API documentation lives in `DOCS.md` for quick lookup of every helper described above.

## Testing

```
npm test
```

The tests cover the helper modules (NCC-02/NCC-05 builders, selector logic, endpoint builder, resolver) to keep the deterministic behaviour aligned with the example harness.
