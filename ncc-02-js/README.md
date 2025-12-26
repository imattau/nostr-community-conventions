# ncc-02-js

A JavaScript library for implementing **NCC-02: Pubkey-Owned Service Discovery and Trust**.

This library provides tools for service owners to publish records and for clients to resolve them with cryptographic verification and third-party attestation support.

## Features

- **Service Discovery**: Resolve Kind 30059 service records.
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

const resolver = new NCC02Resolver(relay, [trustedCAPubkey]);

try {
  const service = await resolver.resolve(ownerPubkey, 'api', {
    requireAttestation: true,
    minLevel: 'verified'
  });
  console.log('Resolved endpoint:', service.endpoint);
} catch (err) {
  console.error('Resolution failed:', err.code, err.message);
}
```

### 2. Publish a Service Record

```javascript
import { NCC02Builder } from 'ncc-02-js';

const builder = new NCC02Builder(privateKey);
const event = builder.createServiceRecord('api', 'https://api.example.com', 'sha256:fingerprint');
// publish event to relays...
```

## API

### `NCC02Resolver`
- `resolve(pubkey, serviceId, options)`: Resolves and verifies a service record.
- `verifyEndpoint(resolved, actualFingerprint)`: Helper to check if a connected endpoint matches the record.

### `NCC02Builder`
- `createServiceRecord(id, uri, fingerprint, expiryDays)`
- `createAttestation(subject, srv, eventId, level, validDays)`
- `createRevocation(attestationId, reason)`

## License

CC0-1.0
