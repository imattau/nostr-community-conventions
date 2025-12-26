# ncc-05

Nostr Community Convention 05 - Identity-Bound Service Locator Resolution

## Installation

You can install this library using npm:

```bash
npm install ncc-05
```

## Configuration

### Relays

The `NCC05Resolver` uses a set of bootstrap relays to discover service locators. By default, it uses `['wss://relay.damus.io', 'wss://nos.lol']`. You can provide your own list of relays during initialization:

```typescript
import { NCC05Resolver } from 'ncc-05';

const customRelays = ['wss://relay.example.com', 'wss://another.relay.io'];
const resolver = new NCC05Resolver({ bootstrapRelays: customRelays });
```

The `NCC05Publisher` requires you to specify the relays to which you want to publish events for each `publish` or `publishWrapped` call:

```typescript
import { NCC05Publisher } from 'ncc-05';

const publisher = new NCC05Publisher();
const relaysToPublishTo = ['wss://relay.example.com'];
// ... then call publisher.publish(relaysToPublishTo, ...)
```

### Shared SimplePool

Both `NCC05Resolver` and `NCC05Publisher` can optionally share a `nostr-tools` `SimplePool` instance. This is useful for managing relay connections more efficiently across your application.

```typescript
import { SimplePool } from 'nostr-tools';
import { NCC05Resolver, NCC05Publisher } from 'ncc-05';

const pool = new SimplePool();

const resolver = new NCC05Resolver({ pool });
const publisher = new NCC05Publisher({ pool });

// Remember to close the pool when done if you created it externally
// pool.close(); 
```

## Usage

This library is designed for both resolving and publishing identity-bound service locators.

### 1. Resolving a Service Locator

You can resolve a service locator for a user's identity using the `NCC05Resolver`. This involves specifying the target user's public key, your (optional) secret key for decryption, and a service identifier.

```typescript
import { NCC05Resolver, NCC05Payload, NCC05TimeoutError } from 'ncc-05';
import { SimplePool } from 'nostr-tools';

// Optional: Share an existing connection pool to manage relay connections
const pool = new SimplePool(); 
const resolver = new NCC05Resolver({ 
    pool,
    timeout: 10000 // Custom timeout in milliseconds (default is 10000)
});

// The target user's public key (can be 'npub1...' (bech32 encoded) or a hex string)
const targetPubkey = 'npub1w9...'; 

// Your secret key (hex string or Uint8Array) is required if the record is encrypted for you.
// If the record is public or encrypted for the targetPubkey itself, your secretKey is not strictly needed.
const mySecretKey = "your_hex_secret_key"; 

// The 'd' tag identifier for the service (default is 'addr')
const serviceIdentifier = 'chat.example.com'; 

try {
    const payload: NCC05Payload | null = await resolver.resolve(targetPubkey, mySecretKey, serviceIdentifier, { 
        gossip: true,   // Attempt NIP-65 relay discovery
        strict: false   // If true, expired records return null; otherwise, a warning is logged.
    });

    if (payload) {
        console.log('Resolved Service Locator Payload:', payload);
        // Example output structure:
        // {
        //   v: 1,
        //   ttl: 3600,
        //   updated_at: 1678886400,
        //   endpoints: [
        //     { type: 'tcp', uri: '192.168.1.100:8080', priority: 10, family: 'ipv4' },
        //     { type: 'onion', uri: 'vww6y4qj7y3t45b5.onion:443', priority: 20, family: 'onion' }
        //   ],
        //   caps: ['auth', 'upload'],
        //   notes: 'Main chat service instance'
        // }
    } else {
        console.log('Service locator not found or could not be resolved.');
    }
} catch (e) {
    if (e instanceof NCC05TimeoutError) {
        console.error('Resolution timed out:', e.message);
    } else {
        console.error('An error occurred during resolution:', e);
    }
} finally {
    // It's good practice to close the resolver when you're done if it created its own pool.
    // If you passed an external pool, you manage its lifecycle.
    resolver.close(); 
}

// Close the external pool if you instantiated it.
// pool.close();
```

### 2. Publishing a Service Locator

You can publish a service locator using the `NCC05Publisher`. This allows you to broadcast your service's endpoints to the Nostr network, either publicly, encrypted for yourself, or encrypted for a specific recipient.

```typescript
import { NCC05Publisher, NCC05Payload } from 'ncc-05';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

const publisher = new NCC05Publisher();
const relaysToPublishTo = ['wss://relay.damus.io', 'wss://relay.nostr.band'];

// Your secret key (should be a hex string or Uint8Array)
const publisherSecretKey = 'your_publisher_secret_key_hex'; 

const servicePayload: NCC05Payload = {
    v: 1, // Payload version
    ttl: 3600, // Time-to-live in seconds
    updated_at: Math.floor(Date.now() / 1000), // Current timestamp
    endpoints: [
        { type: 'tcp', uri: '1.2.3.4:8080', priority: 10, family: 'ipv4' },
        { type: 'http', uri: 'https://myservice.com', priority: 5, family: 'ipv4' }
    ],
    caps: ['login', 'status'], // Optional capabilities
    notes: 'My primary service instance' // Optional notes
};

// --- Publish a public record (not encrypted) ---
try {
    const publicEvent = await publisher.publish(relaysToPublishTo, publisherSecretKey, servicePayload, {
        identifier: 'my-public-service',
        public: true // Set to true for public, unencrypted records
    });
    console.log('Public record published:', publicEvent.id);
} catch (e) {
    console.error('Failed to publish public record:', e);
}

// --- Publish a record encrypted for yourself (self-encrypted) ---
try {
    // This record can only be decrypted by the publisherSecretKey
    const selfEncryptedEvent = await publisher.publish(relaysToPublishTo, publisherSecretKey, servicePayload, {
        identifier: 'my-private-service',
        // public: false is default, recipientPubkey also defaults to publisher's pubkey
    });
    console.log('Self-encrypted record published:', selfEncryptedEvent.id);
} catch (e) {
    console.error('Failed to publish self-encrypted record:', e);
}

// --- Publish a record encrypted for a specific recipient ---
try {
    const recipientPubkey = getPublicKey(generateSecretKey()); // Example recipient
    const recipientEncryptedEvent = await publisher.publish(relaysToPublishTo, publisherSecretKey, servicePayload, {
        identifier: 'service-for-friend',
        recipientPubkey: recipientPubkey // Encrypts content for this recipient
    });
    console.log('Recipient-encrypted record published:', recipientEncryptedEvent.id);
} catch (e) {
    console.error('Failed to publish recipient-encrypted record:', e);
}

// --- Publish a record wrapped for multiple recipients ---
try {
    const groupMembers = [
        getPublicKey(generateSecretKey()), // Member 1
        getPublicKey(generateSecretKey()), // Member 2
    ];
    const wrappedEvent = await publisher.publishWrapped(relaysToPublishTo, publisherSecretKey, groupMembers, servicePayload, 'shared-service');
    console.log('Wrapped record published for multiple recipients:', wrappedEvent.id);
} catch (e) {
    console.error('Failed to publish wrapped record:', e);
} finally {
    publisher.close(relaysToPublishTo); // Close connections used by this publisher instance
}
```

## Error Handling

The library exports specific error classes for granular handling:
- `NCC05Error`: Base class for all NCC-05 specific errors.
- `NCC05RelayError`: Communication failure with Nostr relays.
- `NCC05TimeoutError`: Operation exceeded the specified timeout.
- `NCC05DecryptionError`: Failed to decrypt the record (invalid keys or content).
- `NCC05ArgumentError`: Invalid arguments provided (e.g., malformed keys).

## Description

This library implements Nostr Community Convention 05 (NCC-05) for identity-bound service locator resolution. NCC-05 defines a standard way for Nostr identities to publish and discover dynamic service endpoints (like IP addresses, ports, or Tor .onion addresses) using Nostr kind `30058` events. This allows applications to resolve a standardized service locator for a given user's Nostr public key and a specified service identifier.

It integrates with [NIP-05 (Nostr Identity)](https://github.com/nostr-protocol/nips/blob/master/05.md) by allowing resolution based on NIP-05 verified identities and leveraging NIP-65 for relay discovery.

## How it works

NCC-05 leverages Nostr to store and retrieve service locator records. When `resolve` is called, the library performs the following steps:

1.  **Identity Resolution**: Converts `npub` formatted public keys to their hexadecimal representation.
2.  **Relay Discovery (Optional NIP-65)**: If enabled, attempts to discover additional relays from the target user's NIP-65 (kind `10002`) event, ensuring a broader search for their records.
3.  **Querying for `kind:30058` records**: It queries known Nostr relays (bootstrap and potentially NIP-65 discovered) for `kind:30058` events authored by the target public key and matching the provided 'd' tag identifier.
4.  **Filtering and Validation**: Discovered records are filtered for valid signatures and the correct author. The latest valid record is selected.
5.  **Decryption**: If the content is encrypted (using NIP-44), it attempts to decrypt it using the provided secret key. It supports both single-recipient (self-encrypted or targeted) and multi-recipient "wrapped" encryption patterns.
6.  **Payload Parsing and Validation**: The decrypted content is parsed as an `NCC05Payload` and validated for structural integrity and freshness (checking `ttl` against `updated_at`).
7.  **Resolution**: The most appropriate and valid `NCC05Payload` is returned.

## Tor & Privacy (Onion Services)
...
## API Reference

### `NCC05Resolver`
- `new NCC05Resolver(options?: ResolverOptions)`: Constructor.
- `resolve(targetPubkey: string, secretKey?: string | Uint8Array, identifier: string = 'addr', options?: { strict?: boolean, gossip?: boolean }): Promise<NCC05Payload | null>`: Finds and decrypts a locator record.
- `close(): void`: Closes pool connections.

### `NCC05Publisher`
- `new NCC05Publisher(options?: PublisherOptions)`: Constructor.
- `publish(relays: string[], secretKey: string | Uint8Array, payload: NCC05Payload, options?: { identifier?: string, recipientPubkey?: string, public?: boolean }): Promise<Event>`: Publishes a standard or targeted record.
- `publishWrapped(relays: string[], secretKey: string | Uint8Array, recipients: string[], payload: NCC05Payload, identifier: string = 'addr'): Promise<Event>`: Publishes a multi-recipient record.
- `close(relays: string[]): void`: Closes connections to specified relays.

### `NCC05Group`
- `createGroupIdentity()`: Generates a shared group keypair.
- `resolveAsGroup(...)`: Helper for shared-nsec resolution.

### Interfaces

#### `NCC05Payload`

The structure of the resolved service locator data:

```typescript
export interface NCC05Payload {
    v: number;                 // Payload version (currently 1)
    ttl: number;               // Time-to-live in seconds
    updated_at: number;        // Unix timestamp of the last update
    endpoints: NCC05Endpoint[];// List of available endpoints
    caps?: string[];           // Optional capability identifiers supported by the service
    notes?: string;            // Optional human-readable notes
}

export interface NCC05Endpoint {
    type: 'tcp' | 'udp' | string; // Protocol type, e.g., 'tcp', 'udp', 'http'
    uri: string;                  // The URI string, e.g., '1.2.3.4:8080' or '[2001:db8::1]:9000'
    priority: number;             // Priority for selection (lower is higher priority)
    family: 'ipv4' | 'ipv6' | 'onion' | string; // Network family for routing hints
}
```

## License
