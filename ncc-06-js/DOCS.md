# ncc-06-js API Reference

`ncc-06-js` exposes a set of helpers organized around NCC-02/NCC-05 publication, NCC-06 resolution, endpoint discovery, transport framing, and runtime utilities. Each section below describes the intention, available arguments, and a usage snippet where appropriate.

## NCC-02 helpers

These functions help build, parse, and verify NCC-02 service records (kind `30059`).

### `buildNcc02ServiceRecord(options)`
- **Purpose**: create a signed service record containing `d`, `u`, `k`, and `exp`.
- **Example**:
  ```js
  const event = buildNcc02ServiceRecord({
    secretKey,
    serviceId: 'relay',
    endpoint: 'wss://127.0.0.1:7447',
    fingerprint: expectedK,
    expirySeconds: 60 * 60
  });
  ```

### `parseNcc02Tags(event)`
- Converts the `tags` array to an object map for easy lookups.

### `validateNcc02(event, { expectedAuthor?, expectedD?, now?, allowExpired? })`
- Validates signature, author, `d`, and expiration windows. Use `allowExpired` for stale fallback flows.

## NCC-05 helpers

Utilities for locator payload construction and evaluation.

### `buildLocatorPayload({ endpoints = [], ttl = 3600, updatedAt })`
- Normalizes each endpoint and generates `{ ttl, updated_at, endpoints }`.

### `parseLocatorPayload(content)`
- Safely parses JSON from the event content; returns `null` when parsing fails.

### `validateLocatorFreshness(payload, { now?, allowStale? })`
- Returns `true` when `now <= updated_at + ttl` (unless `allowStale` is true).

### `normalizeLocatorEndpoints(endpoints)`
- Normalizes each endpoint (protocol, family, priority, fingerprint/k) so `choosePreferredEndpoint` can trust consistent metadata.

## NCC-06 helpers

### `choosePreferredEndpoint(endpoints, { torPreferred?, expectedK? })`
- Applies NCC-06 policy: prefer `wss://` with matching `k`, favor onion if `torPreferred`, fall back to any `ws://`.
- Returns `{ endpoint?: NormalizedEndpoint, reason?: string, expected?, actual? }`.

### `resolveServiceEndpoint(options)`
- Orchestrates resolution by querying bootstrap relays, preferring NCC-05 locators, and falling back to NCC-02 records.
- **Options** include `bootstrapRelays`, `servicePubkey`, `serviceId`, `locatorId`, `expectedK`, `locatorSecretKey`, `torPreferred`, timeouts, and override hooks.
- **Returns** `{ endpoint, source, serviceEvent, locatorPayload, selection }`.

## Sidecar config helpers

### `buildSidecarConfig(options)`
- Mirrors the example sidecar setup and derives `ncc02ExpectedKey`, `publishRelays`, and `torControl` from operator intent so you do not need to duplicate those scripts.

### `buildClientConfig(options)`
- Rehydrates the minimal client config that the example resolver expects; dedupes publication relays, enforces `serviceIdentityUri`, and carries the `expectedK` for NCC-02 pinning.

## Key and TLS helpers

### `generateExpectedK`, `validateExpectedKFormat`
- Create or validate placeholder `TESTKEY:` tokens used during development.

### `computeKFromCertPem(pem)`
- Derives base64url SHA-256 of the certificate’s SPKI for TLS pinning.

### `getExpectedK(cfg, { baseDir? })`
- Reads a config block (`k.mode`) and returns the expected `k` string for static/generate/tls modes; used by the sidecar.

### Key helpers
- `generateKeypair()`, `toNpub()`, `fromNsec()` wrap `nostr-tools` key utilities for convenience.
- `ensureSelfSignedCert(options)` generates a self-signed cert for local `wss://` endpoints.

## Endpoint helpers

### `buildExternalEndpoints(options)`
- Builds NCC-05 endpoints (onion/IPv6/IPv4) from operator intent, adding `k` on `wss://` entries.
- **Options**: `ipv4`, `ipv6`, `tor`, `wsPort`, `wssPort`, `ncc02ExpectedKey`, `ensureOnionService`, `publicIpv4Sources`.

### `detectGlobalIPv6()`
- Returns first global IPv6 (non-link-local/unique-local).

### `getPublicIPv4({ sources? })`
- Queries HTTP endpoints for the external IPv4 address; used when you don’t hardcode `ipv4.address`.

## Scheduling helpers

### `scheduleWithJitter(baseMs, jitterRatio = 0.15)`
- Returns a delay between `0` and `baseMs` with ±`jitterRatio` wiggle. Used for sidecar timers to avoid synchronized republishing.

## Light Nostr helpers

- `parseNostrMessage(messageString)` / `serializeNostrMessage(messageArray)` guard the transport framing.
- `createReqMessage(subId, ...filters)` builds a REQ payload for subscriptions.

## Usage snapshot

```js
import { buildExternalEndpoints, resolveServiceEndpoint, scheduleWithJitter } from 'ncc-06-js';

const endpoints = await buildExternalEndpoints({ ipv4: { enabled: true, protocol: 'wss', address: '127.0.0.1', port: 7447 }, ncc02ExpectedKey: 'TESTKEY:relay-local-dev-1' });
const result = await resolveServiceEndpoint({
  bootstrapRelays: ['ws://127.0.0.1:7000'],
  servicePubkey,
  serviceId: 'relay',
  locatorId: 'relay-locator',
  expectedK: 'TESTKEY:relay-local-dev-1',
  locatorSecretKey
});

const delay = scheduleWithJitter(60000); // use this for republish timers
```

The helpers are intentionally small, focused on NCC-06 policy, and rely on the calling code for transport/threading so they can be reused inside Node scripts, CLI tools, or downstream SDKs.

## TypeScript definitions

`ncc-06-js` ships an `index.d.ts` file that mirrors the helpers documented above so TypeScript consumers receive accurate typings.
