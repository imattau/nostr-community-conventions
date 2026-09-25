# ncc-07-js

Minimal reference implementation of [NCC-07: Service Capability Manifest](../README.md) in TypeScript, built on [`nostr-tools`](https://github.com/nbd-wtf/nostr-tools).

## Install

```bash
npm install
npm run build
```

## Usage

### Build and publish a manifest

```ts
import { SimplePool, generateSecretKey } from 'nostr-tools';
import { publishCapabilityManifest, nccCapability, pubkeyCapability } from 'ncc-07-js';

const sk = generateSecretKey();
const pool = new SimplePool();

await publishCapabilityManifest(pool, ['wss://relay.example'], {
  secretKey: sk,
  capabilities: [
    nccCapability(2),
    nccCapability(5),
    pubkeyCapability('<author-pubkey-hex>', 'media-upload')
  ]
});
```

### Resolve a service's current capabilities

```ts
import { SimplePool } from 'nostr-tools';
import { resolveCapabilityManifest, hasCapability } from 'ncc-07-js';

const pool = new SimplePool();
const manifest = await resolveCapabilityManifest(pool, ['wss://relay.example'], servicePubkeyHex);

if (hasCapability(manifest, 'ncc:05')) {
  // service claims NCC-05 support
}
```

### Parse a raw event

```ts
import { parseCapabilityManifest } from 'ncc-07-js';

const parsed = parseCapabilityManifest(event);
if (parsed) {
  console.log(parsed.capabilities);
}
```

## What this implements

- `buildCapabilityManifest` / `publishCapabilityManifest` — construct and sign a `kind:30062` event with `d=capabilities` and one `cap` tag per asserted capability (NCC-07 §6).
- `parseCapabilityManifest` — verify an event's signature and extract its `cap` tags, returning `null` for anything that isn't a conformant manifest rather than throwing (§9).
- `resolveCapabilityManifest` — query relays for a service's manifest and apply NIP-01 addressable-event replacement, keeping only the newest valid manifest (§9.1).
- `nipCapability` / `nccCapability` / `pubkeyCapability` / `capabilityNamespace` — helpers for the three capability identifier namespaces (§7).

This library intentionally does not implement capability negotiation, capability parameters, or any specific capability's behaviour — those are out of scope for NCC-07 (§§12–13).

## Tests

```bash
npm install
npm test
```

The test suite runs entirely in-memory (a mock relay pool) and checks the build/sign/parse/verify/resolve round trip against the spec's required behaviour, including replacement semantics and rejection of tampered events.
