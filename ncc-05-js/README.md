# ncc-05

**Nostr Community Convention 05 - Identity-Bound Service Locator Resolution.**

A TypeScript library for publishing and resolving dynamic, encrypted service endpoints (IP, Port, Onion) bound to cryptographic identities using Nostr `kind:30058` events.

## Features

- **Identity-Centric**: Endpoints are bound to a Nostr Pubkey.
- **Privacy-First**: NIP-44 encryption is mandatory by default.
- **Multi-Recipient Support**: Implement "Wrapping" patterns to share endpoints with groups without sharing private keys.
- **NIP-65 Gossip**: Built-in support for discovering a publisher's preferred relays.
- **Robust & Flexible**: Handles relay failures gracefully, supports configurable timeouts, and accepts Hex strings or Uint8Array for keys.
- **Shared Resources**: Supports external `SimplePool` instances for efficient connection management.
- **Type Safe**: Fully typed with TypeScript.

## Installation
...
### 1. Basic Resolution (Self or Public)

Resolve an identity-bound service locator for a given pubkey.

```typescript
import { NCC05Resolver } from 'ncc-05';
import { SimplePool } from 'nostr-tools';

// Optional: Share an existing connection pool
const pool = new SimplePool();
const resolver = new NCC05Resolver({ 
    pool,
    timeout: 5000 // Custom timeout
});

// Resolve using an npub or HEX pubkey
const target = 'npub1...';
const mySecretKey = "hex_or_uint8array_key"; 

try {
    const payload = await resolver.resolve(target, mySecretKey, 'addr', { 
        gossip: true, 
        strict: true  
    });
    if (payload) console.log('Resolved:', payload.endpoints);
} catch (e) {
    if (e.name === 'NCC05TimeoutError') console.error('Resolution timed out');
}
```
...
#
...
```typescript

```

## Error Handling

The library exports specific error classes for granular handling:
- `NCC05RelayError`: Communication failure with Nostr relays.
- `NCC05TimeoutError`: Operation exceeded the specified timeout.
- `NCC05DecryptionError`: Failed to decrypt the record (invalid keys).
- `NCC05ArgumentError`: Invalid arguments provided (e.g. malformed keys).

## 5. Custom WebSocket Implementation

If you need to use a custom WebSocket implementation (e.g., for Node.js environments with the `ws` package, or for connecting via Tor/SOCKS5 proxies), you should configure it globally using `nostr-tools`'s `useWebSocketImplementation` function *before* instantiating any `NCC05Resolver` or `NCC05Publisher` objects.

```typescript
import { useWebSocketImplementation } from 'nostr-tools/pool';
import WebSocket from 'ws'; // Example: using the 'ws' package in Node.js

// Set your custom WebSocket implementation globally
useWebSocketImplementation(WebSocket);

// Now you can instantiate NCC05Resolver or NCC05Publisher, and they will use your custom WebSocket
// const resolver = new NCC05Resolver();
```

## API Reference

### `NCC05Resolver`
- `resolve(targetPubkey, secretKey?, identifier?, options?)`: Finds and decrypts a locator record.
- `close()`: Closes pool connections.

### `NCC05Publisher`
- `publish(relays, secretKey, payload, options?)`: Publishes a standard or targeted record.
- `publishWrapped(relays, secretKey, recipients, payload, identifier?)`: Publishes a multi-recipient record.

### `NCC05Group`
- `createGroupIdentity()`: Generates a shared group keypair.
- `resolveAsGroup(...)`: Helper for shared-nsec resolution.

## License



CC0 1.0 Universal
