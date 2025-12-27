# ncc-05-js

**Nostr Community Convention 05 (NCC-05)** implementation for JavaScript/TypeScript.

This library provides a standard way to publish and resolve **Identity-Bound Service Locators** on the Nostr network. It allows Nostr identities to dynamically publish endpoints (IPs, domains, Tor .onion addresses) that can be resolved by others, effectively functioning as a decentralized, identity-based DNS.

## Features

*   **Identity-Bound:** Records are signed by Nostr identities (`npub`), ensuring authenticity.
*   **Privacy-Focused:** Supports NIP-44 encryption (public, self-encrypted, targeted, and multi-recipient).
*   **Dynamic:** Updates propagate instantly across relays (Kind 30058 replaceable events).
*   **Resilient:** Supports NIP-65 gossip for decentralized discovery, finding the relays where the target user actually publishes.
*   **Flexible:** Works with any endpoint type (TCP, UDP, HTTP, Onion, etc.).
*   **Efficient:** Supports sharing a `SimplePool` instance for connection management.
*   **Typed:** Written in TypeScript with full type definitions.

## Installation

```bash
npm install ncc-05-js
```

## Quick Start

### 1. Publishing a Service Locator

```typescript
import { NCC05Publisher, NCC05Payload } from 'ncc-05-js';

const publisher = new NCC05Publisher();
const relays = ['wss://relay.damus.io', 'wss://npub1base64userpubkey...'];
const mySecretKey = '...'; // Hex string or Uint8Array

const payload: NCC05Payload = {
    v: 1,
    ttl: 3600,
    updated_at: Math.floor(Date.now() / 1000),
    endpoints: [
        { type: 'https', uri: '192.168.1.42:443', priority: 1, family: 'ipv4' }
    ]
};

// Publish a public record
try {
    await publisher.publish(relays, mySecretKey, payload, { public: true });
    console.log('Service published!');
} catch (error) {
    console.error('Publishing failed:', error);
}

publisher.close(relays);
```

### 2. Resolving a Service Locator

```typescript
import { NCC05Resolver } from 'ncc-05-js';

const resolver = new NCC05Resolver();
const targetPubkey = 'npub1...'; // or hex

try {
    const record = await resolver.resolve(targetPubkey);
    
    if (record) {
        console.log('Found endpoints:', record.endpoints);
    } else {
        console.log('No service record found.');
    }
} catch (error) {
    console.error('Resolution failed:', error);
}

resolver.close();
```

---

## Detailed Usage

### Configuration

Both `NCC05Resolver` and `NCC05Publisher` accept configuration objects.

#### Shared Connection Pool
For efficiency, especially in long-running applications or when using other Nostr libraries, you should share a single `SimplePool` instance.

```typescript
import { SimplePool } from 'nostr-tools';
import { NCC05Resolver, NCC05Publisher } from 'ncc-05-js';

const pool = new SimplePool();

const resolver = new NCC05Resolver({ pool });
const publisher = new NCC05Publisher({ pool });

// ... usage ...

// You are responsible for closing the pool if you passed it in
// pool.close(usedRelays); 
```

#### Custom Relays & Timeouts

```typescript
const resolver = new NCC05Resolver({
    // Relays to start looking at (Bootstrap relays)
    bootstrapRelays: ['wss://relay.custom.com'], 
    // Timeout for resolution in milliseconds (Default: 10000)
    timeout: 5000 
});
```

### Publishing Records

The `NCC05Publisher` supports different privacy levels using NIP-44 encryption.

#### Public Records (Unencrypted)
Readable by anyone.

```typescript
await publisher.publish(relays, secretKey, payload, { 
    identifier: 'my-service', // 'd' tag
    public: true 
});
```

#### Private Records (Self-Encrypted)
Only readable by you (the publisher). Useful for personal device syncing or private configuration.

```typescript
await publisher.publish(relays, secretKey, payload, { 
    identifier: 'my-device' 
    // public: false is default
    // recipient defaults to self if omitted
});
```

#### Targeted Records
Readable only by a specific recipient.

```typescript
await publisher.publish(relays, secretKey, payload, { 
    identifier: 'for-alice',
    recipientPubkey: 'alice_hex_pubkey' 
});
```

#### Wrapped Records (Multi-Recipient)
Readable by a group of users. Uses a "wrapping" pattern where the payload is encrypted with a random session key, and that session key is encrypted individually for each recipient.

```typescript
const recipients = ['hex_pubkey_1', 'hex_pubkey_2', 'hex_pubkey_3'];

await publisher.publishWrapped(
    relays, 
    secretKey, 
    recipients, 
    payload, 
    'team-service'
);
```

### Resolving Records

The `NCC05Resolver` finds the latest valid record for a given user and identifier.

```typescript
const payload = await resolver.resolve(
    targetPubkey, // npub or hex
    mySecretKey,  // Required if the record is encrypted for you (can be null/undefined if public)
    'my-service', // The 'd' tag identifier (default: 'addr')
    { 
        gossip: true, // Enable NIP-65 relay discovery (Highly Recommended)
        strict: false // If true, returns null for expired records instead of just logging a warning
    }
);
```

**Note on Keys:** All methods accept keys as either **Hex Strings** or **Uint8Array**.

## API Reference

### `NCC05Payload`

The core data structure representing the service locator.

```typescript
interface NCC05Payload {
    v: number;                 // Version (always 1)
    ttl: number;               // Time-to-live (seconds)
    updated_at: number;        // Unix timestamp
    endpoints: NCC05Endpoint[];
    caps?: string[];           // Optional capabilities (e.g. ['upload', 'stream'])
    notes?: string;            // Optional human-readable notes
}

interface NCC05Endpoint {
    type: string;     // e.g., 'tcp', 'http', 'ipfs', 'hyper'
    uri: string;      // e.g., '10.0.0.1:80', '[2001:db8::1]:443', 'onion_address:80'
    priority: number; // Lower number = higher priority
    family: string;   // 'ipv4', 'ipv6', 'onion', 'unknown'
}
```

### `NCC05Resolver`

*   `constructor(options?)`
    *   `bootstrapRelays`: `string[]` (Default: `['wss://relay.damus.io', 'wss://npub1...']`)
    *   `timeout`: `number` (ms) (Default: `10000`)
    *   `pool`: `SimplePool` (optional)
*   `resolve(targetPubkey, secretKey?, identifier?, options?)`: `Promise<NCC05Payload | null>`
    *   `gossip`: `boolean` - Fetch target's relay list (NIP-65) to find where they publish.
    *   `strict`: `boolean` - Enforce TTL expiration strictly.
*   `close()`: Closes connections (only if pool was created internally).

### `NCC05Publisher`

*   `constructor(options?)`
    *   `pool`: `SimplePool` (optional)
    *   `timeout`: `number` (ms) (Default: `5000`)
*   `publish(relays, secretKey, payload, options?)`: `Promise<Event>`
    *   `identifier`: `string` (Default: `'addr'`)
    *   `public`: `boolean` (Default: `false`)
    *   `recipientPubkey`: `string` (Default: self)
    *   `privateLocator`: `boolean` (Default: `false`) - Adds `["private", "true"]` tag.
*   `publishWrapped(relays, secretKey, recipients, payload, options?)`: `Promise<Event>`
    *   `options`: `{ identifier?: string, privateLocator?: boolean }` or `string` (identifier)
*   `close(relays)`: Closes connections to specific relays (only if pool was created internally).

## Error Handling

Errors are typed for granular handling:

*   `NCC05TimeoutError`: Relay operations took too long.
*   `NCC05RelayError`: Failed to publish or query relays.
*   `NCC05DecryptionError`: Bad key or invalid ciphertext.
*   `NCC05ArgumentError`: Invalid inputs (e.g. malformed keys).

## Utilities

*   `TAG_PRIVATE`: Constant string `'private'`.
*   `isPrivateLocator(event: Event): boolean`: Helper to check if an event has the `["private", "true"]` tag.

## Protocol Details

This library implements **NCC-05**, which uses Nostr **Kind 30058** (Parametrized Replaceable Event) to store service locators.

It leverages:
*   **NIP-01:** Basic protocol flow.
*   **NIP-19:** bech32-encoded entities (npub, nsec).
*   **NIP-44:** Encryption (XChaCha20-Poly1305).
*   **NIP-65:** Relay discovery (Gossip).

## License

CC0-1.0