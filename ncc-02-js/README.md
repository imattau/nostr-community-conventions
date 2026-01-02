# ncc-02-js

A JavaScript library for implementing **NCC-02: Pubkey-Owned Service Discovery and Trust**.

This library provides tools for service owners to publish records and for clients to resolve them with cryptographic verification and third-party attestation support.

## Features

- **Service Discovery**: Resolve Kind 30059 service records for both public and private services.
- **Verification**: Built-in signature and expiry validation.
- **Trust Policy**: Support for third-party attestations (Kind 30060) and revocations (Kind 30061).
- **Security**: Cross-validation of subject and service identifiers to prevent impersonation.
- **Fail-Closed**: Explicit error reporting for policy or verification failures.

## Installation

```bash
npm install ncc-02-js
```

## Usage

### 1. Resolve a Service

```javascript
import { NCC02Resolver } from 'ncc-02-js';

// Initialize with relay URLs and optional trusted CA pubkeys
const resolver = new NCC02Resolver(['wss://192.0.2.1:443'], {
  trustedCAPubkeys: ['npub1...'] // Trusted third-party certifiers
});

try {
  // ownerPubkey can be hex or npub
  const service = await resolver.resolve(ownerPubkey, 'media', {
    requireAttestation: true,
    minLevel: 'verified' // 'self', 'verified', 'hardened'
  });
  if(service.endpoint) {
    console.log('Resolved endpoint:', service.endpoint);
  } else {
    console.log('Resolved private service, use NCC-05 for endpoint discovery.');
  }
} catch (err) {
  console.error('Resolution failed:', err.code, err.message);
} finally {
  resolver.close(); // Clean up WebSocket connections
}
```

### 2. Publish Service Records and Attestations

```javascript
import { NCC02Builder } from 'ncc-02-js';

const builder = new NCC02Builder(privateKey);

const serviceRecord = await builder.createServiceRecord({
  serviceId: 'api',
  endpoint: 'https://service.example.com',
  fingerprint: '<spki fingerprint>',
  expiryDays: 7
});

const attestation = await builder.createAttestation({
  subjectPubkey: ownerPubkey,
  serviceId: 'api',
  serviceEventId: serviceRecord.id,
  level: 'verified',
  validDays: 30
});

await builder.createRevocation({
  attestationId: attestation.id,
  reason: 'Key rotation'
});
```

The builder helpers emit the expected NCC-02 event kinds: Kind 30059 for service records, 30060 for attestations, and 30061 for revocations. `createServiceRecord` always includes the `d` and `exp` tags while optionally populating `u` and `k`. Attestations include `subj`, `srv`, `e`, `std`, `lvl`, `nbf`, and `exp`. Revocations only need the `e` tag and an optional reason. You can supply either a raw private key (hex string or `Uint8Array`) or a signer implementing `getPublicKey`/`signEvent`.

### 3. Trust Model & Security

The resolver treats the service owner’s pubkey as the root authority. Certificates and revocations are additive layers that you opt into via `requireAttestation` or `minLevel`. Validation failures surface as `NCC02Error` instances with codes such as `INVALID_SIGNATURE`, `EXPIRED`, or `POLICY_FAILURE`, helping clients react instead of defaulting to insecure fallbacks.

### 4. Resolution Optimization

To avoid unnecessary relay traffic, attestation and revocation feeds are only fetched when the resolver’s policy requests them. Keep expiries short and rotate fingerprints with the `k` tag to reduce the blast radius of compromised keys.

### 5. Threat Model

The library defends against endpoint impersonation, MITM, stale records, and relay censorship by enforcing signed records, short expiries, revocation checks, and optional third-party attestations. It deliberately keeps scope focused on application-layer trust and does not replace TLS or browser PKI.

### 6. Testing with MockRelay

```javascript
import { MockRelay, NCC02Builder, NCC02Resolver } from 'ncc-02-js';

const mock = new MockRelay();
const builder = new NCC02Builder(privateKey);
const serviceRecord = await builder.createServiceRecord({ serviceId: 'api', endpoint: 'https://example', fingerprint: '<fp>' });
await mock.publish(serviceRecord);

const resolver = new NCC02Resolver(['mock://local'], { pool: mock });
await resolver.resolve(ownerPubkey, 'api');
```

`MockRelay` mimics a Nostr relay by verifying signatures and honoring `kinds`, `authors`, `ids`, and `#tag` filters. It makes writing unit tests and integration suites deterministic without external dependencies.

### 7. Endpoint Verification Helpers

After resolving a service, call `resolver.verifyEndpoint(serviceStatus, actualFingerprint)` to ensure the runtime transport fingerprint matches the declared `k` tag. Use `verifyNCC02Event` when you ingest raw events and `isExpired` to quickly skip expired records before attempting network validation.

## API Reference

### `NCC02Resolver(relays, options)`
- `relays`: Array of relay URLs.
- `options.pool`: (Optional) Shared `nostr-tools` `SimplePool`.
- `options.trustedCAPubkeys`: Optional array of certifier pubkeys that may issue trusted attestations.

#### `resolve(pubkey, serviceId, options)`
- `options.requireAttestation`: Reject if no trusted attestation is available.
- `options.minLevel`: Minimum `lvl` tag level (`self`, `verified`, `hardened`).
- `options.standard`: Expected `std` tag value (defaults to `nostr-service-trust-v0.1`).
- Returns `ServiceStatus` including `endpoint`, `fingerprint`, `expiry`, `attestations`, `attestationCount`, `isRevoked`, `eventId`, `pubkey`, and the raw `serviceEvent`.

#### `verifyEndpoint(resolved, actualFingerprint)`
- Compares the resolved fingerprint with the observed transport fingerprint for an additional rejection guard.

#### `close()`
- Closes relay subscriptions when the resolver owns the `SimplePool`.

### `NCC02Builder(signer)`
- `signer`: Hex private key, `Uint8Array`, or custom signer with `getPublicKey`/`signEvent`.

#### `createServiceRecord({ serviceId, endpoint?, fingerprint?, expiryDays? })`
- Returns a signed Kind 30059 event. `endpoint` maps to `u`, `fingerprint` to `k`, and `expiryDays` controls `exp`.

#### `createAttestation({ subjectPubkey, serviceId, serviceEventId, level?, validDays? })`
- Emits Kind 30060 with `subj`, `srv`, `e`, `std`, `lvl`, `nbf`, and `exp`.

#### `createRevocation({ attestationId, reason? })`
- Emits Kind 30061 pointing to the revoked attestation.

### `MockRelay`
- `publish(event)`: Verifies and stores the event (returns `true` if accepted).
- `query(filter)`: Filters stored events by `kinds`, `authors`, `ids`, and `#tag` criteria.

### Helpers
- `verifyNCC02Event(event)`: Signature verification wrapper.
- `isExpired(event)`: Returns `true` when the `exp` tag is in the past.
- `KINDS`: Enum with `SERVICE_RECORD`, `ATTESTATION`, and `REVOCATION`.

## License

CC0-1.0
