# ncc-06-js

Reusable helpers extracted from the NCC-06 example relay, sidecar, and client implementations. This package focuses on the core utilities that compose NCC-02, NCC-05, and NCC-06 resolution and trust semantics without bundling a relay, sidecar, or heavy client.

## Key features

- **NCC-02 builders & validators** (`buildNcc02ServiceRecord`, `parseNcc02Tags`, `validateNcc02`) that manage the `d`, `u`, `k`, and `exp` tags a service record must expose.
- **NCC-05 helpers** (`buildLocatorPayload`, `normalizeLocatorEndpoints`, `validateLocatorFreshness`) that assemble locator payloads, parse stored JSON, and enforce TTL/`updated_at` freshness rules.
- **Deterministic NCC-06 resolution** via `choosePreferredEndpoint` and `resolveServiceEndpoint`, which query bootstrap relays, prefer fresh NCC-05 locators, verify `k` fingerprints for `wss://`, and fall back to NCC-02 `u` values.
- **External endpoint helpers** (`buildExternalEndpoints`, `detectGlobalIPv6`, `getPublicIPv4`) so sidecars can declare onion/IPv6/IPv4 reachability in a reproducible order without making the relay probe the network.
- **Scheduling helpers** (`scheduleWithJitter`) for applying bounded jitter to recurring NCC-02/NCC-05 timers without ever publishing outside the declared window.
- **TLS/key utilities** (`ensureSelfSignedCert`, `generateKeypair`, `toNpub`, `fromNsec`, `generateExpectedK`, `validateExpectedKFormat`) that mirror the key and fingerprint management used by the example sidecar.
- **Lightweight protocol helpers** (`parseNostrMessage`, `serializeNostrMessage`, `createReqMessage`) for downstream code that wants to reuse the same framing logic as the example client.

## Usage

Install directly from the repository (example workspace):

```bash
npm install ../ncc-06-js
```

Then import the helpers you need:

```js
import {
  resolveServiceEndpoint,
  buildExternalEndpoints,
  generateExpectedK
} from 'ncc-06-js';

const endpoints = await buildExternalEndpoints({
  ipv4: { enabled: true, protocol: 'wss', address: '1.2.3.4', port: 7447 },
  wsPort: 7000,
  wssPort: 7447,
  ncc02ExpectedKey: 'TESTKEY:relay-local-dev-1',
  ensureOnionService
});

const resolution = await resolveServiceEndpoint({
  bootstrapRelays: ['ws://127.0.0.1:7000'],
  servicePubkey: '...',
  serviceId: 'relay',
  locatorId: 'relay-locator',
  expectedK: 'TESTKEY:relay-local-dev-1',
  locatorSecretKey: '...'
});

console.log('Resolved endpoint:', resolution.endpoint);
```

The package exposes modular helpers so you can keep using your own transport stack while reusing the deterministic NCC-06 behaviour that now powers the `ncc06-client` harness.

## Trust model

- `k` is the binding between NCC-02/NCC-05 records and the TLS key that serves `wss://` endpoints. Clients connect with `rejectUnauthorized=false` and enforce trust by comparing the published `k` value to the expected fingerprint before using the endpoint.
- When migrating to real TLS/SPKI pins, update the sidecar to publish the real fingerprint via `ncc02ExpectedKey` and update the resolver’s `expectedK`. The shared helpers keep the rest of the resolution flow untouched.

## Reference Docs

Detailed API documentation lives in `DOCS.md` for quick lookup of every helper described above.

## Testing

```
npm test
```

The tests cover the helper modules (NCC-02/NCC-05 builders, selector logic, endpoint builder, resolver) to keep the deterministic behaviour aligned with the example harness.
