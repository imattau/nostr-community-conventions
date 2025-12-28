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

### 2. Publish a Service Record
...
### Trust Model & Security

### Trust Levels
- `self`: Asserted by the service owner (default if no attestation).
- `verified`: Attested by a trusted third party.
- `hardened`: Attested by a third party with stricter verification (e.g., physical proof or long-term history).

### Resolution Optimization
The resolver is designed to be network-efficient. It will only query for attestations (Kind 30060) and revocations (Kind 30061) if the provided policy requires them (e.g., when `requireAttestation` is set to `true` or a `minLevel` higher than `self` is requested).

### Threat Model
...
### API Reference

### `NCC02Resolver(relays, options)`
- `relays`: Array of relay URLs.
- `options.pool`: (Optional) Existing `nostr-tools` SimplePool.
- `options.trustedCAPubkeys`: (Optional) Array of pubkeys trusted to issue attestations.

#### `resolve(pubkey, serviceId, options)`
- `options.requireAttestation`: Fails if no trusted attestation is found.
- `options.minLevel`: Minimum trust level required.

#### `close()`
Closes WebSocket connections to all relays. If the resolver was initialized with an external `pool`, this will *not* close the pool; it only untracks the relays for this instance. If the resolver created its own internal pool, it will close it entirely.


### `NCC02Builder(privateKey)`
- `createServiceRecord({ serviceId, endpoint?, fingerprint?, expiryDays? })`
- `createAttestation({ subjectPubkey, serviceId, serviceEventId, level, validDays })`
- `createRevocation({ attestationId, reason })`

## License

CC0-1.0
