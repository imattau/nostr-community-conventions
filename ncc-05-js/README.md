# ncc-05

Nostr Community Convention 05 - Identity-Bound Service Locator Resolution.

This library provides a simple way to publish and resolve identity-bound service endpoints (IP/Port/Onion) using Nostr `kind:30058` events.

## Installation

```bash
npm install ncc-05
```

## Usage

### Resolver

Resolve an identity-bound service locator for a given pubkey.

```typescript
import { NCC05Resolver } from 'ncc-05';
import { nip19 } from 'nostr-tools';

const resolver = new NCC05Resolver();

// Your secret key is needed to decrypt the record (NIP-44)
const mySecretKey = nip19.decode('nsec...').data as Uint8Array;
const targetPubkey = '...'; 

const payload = await resolver.resolve(targetPubkey, mySecretKey);

if (payload) {
    console.log('Resolved Endpoints:');
    payload.endpoints.forEach(ep => {
        console.log(`- ${ep.type}://${ep.uri} (${ep.family})`);
    });
}
```

### Publisher

Publish your own service locator record.

```typescript
import { NCC05Publisher, NCC05Payload } from 'ncc-05';

const publisher = new NCC05Publisher();
const mySecretKey = ...;

const payload: NCC05Payload = {
    v: 1,
    ttl: 600,
    updated_at: Math.floor(Date.now() / 1000),
    endpoints: [
        {
            type: 'tcp',
            uri: '127.0.0.1:8080',
            priority: 10,
            family: 'ipv4'
        }
    ]
};

const relays = ['wss://relay.damus.io', 'wss://nos.lol'];
await publisher.publish(relays, mySecretKey, payload);
```

## Features

- **NIP-44 Encryption**: All locator records are encrypted by default.
- **NIP-01/NIP-33**: Uses standard Nostr primitives.
- **Identity-Centric**: Resolution is bound to a cryptographic identity (Pubkey).

## License

MIT
