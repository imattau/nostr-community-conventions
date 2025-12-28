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
}
```

### 2. Publish a Service Record

```javascript
import { NCC02Builder } from 'ncc-02-js';

// Initialize with private key (hex)
const builder = new NCC02Builder(privateKey);

// Example 1: Public IP-based Service
const event = builder.createServiceRecord({
  serviceId: 'media',
  endpoint: 'https://203.0.113.45:8443',
  fingerprint: 'sha256:fingerprint',
  expiryDays: 14
});

// Example 2: Private / Invite-Only Service
const privateEvent = builder.createServiceRecord({
  serviceId: 'wallet',
  fingerprint: 'sha256:fingerprint',
  expiryDays: 7
});
// publish events to relays...
```

### 3. Issue an Attestation (CA)

```javascript
const caBuilder = new NCC02Builder(caPrivateKey);
const attestation = caBuilder.createAttestation({
  subjectPubkey: 'npub1...', // The service owner being certified
  serviceId: 'media',
  serviceEventId: serviceRecordEventId,
  level: 'verified',
  validDays: 30
});
```

## Trust Model & Security

### Trust Levels
- `self`: Asserted by the service owner (default if no attestation).
- `verified`: Attested by a trusted third party.
- `hardened`: Attested by a third party with stricter verification (e.g., physical proof or long-term history).

### Threat Model
- **Endpoint Impersonation**: Prevented by binding the endpoint URI to a public key fingerprint (`k` tag).
- **Man-in-the-Middle (MITM)**: Mitigated via cryptographic pinning of transport-level keys.
- **Stale Records**: Limited by required expiry (`exp`) and support for revocations.
- **Relay Censorship**: Mitigated by querying multiple relays (implemented via `SimplePool`).

### Fail-Closed Design
The library follows a fail-closed principle. If a policy requirement is not met (e.g., `requireAttestation: true` but no valid attestation is found), it throws an `NCC02Error` rather than returning a partially verified record.

## API Reference

### `NCC02Resolver(relays, options)`
- `relays`: Array of relay URLs.
- `options.pool`: (Optional) Existing `nostr-tools` SimplePool.
- `options.trustedCAPubkeys`: (Optional) Array of pubkeys trusted to issue attestations.

#### `resolve(pubkey, serviceId, options)`
- `options.requireAttestation`: Fails if no trusted attestation is found.
- `options.minLevel`: Minimum trust level required.

### `NCC02Builder(privateKey)`
- `createServiceRecord({ serviceId, endpoint?, fingerprint?, expiryDays? })`
- `createAttestation({ subjectPubkey, serviceId, serviceEventId, level, validDays })`
- `createRevocation({ attestationId, reason })`

## License

CC0-1.0
