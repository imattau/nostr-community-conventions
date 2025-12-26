# ncc-05

**Nostr Community Convention 05 - Identity-Bound Service Locator Resolution.**

A TypeScript library for publishing and resolving dynamic, encrypted service endpoints (IP, Port, Onion) bound to cryptographic identities using Nostr `kind:30058` events.

## Features

- **Identity-Centric**: Endpoints are bound to a Nostr Pubkey.
- **Privacy-First**: NIP-44 encryption is mandatory by default.
- **Multi-Recipient Support**: Implement "Wrapping" patterns to share endpoints with groups without sharing private keys.
- **NIP-65 Gossip**: Built-in support for discovering a publisher's preferred relays.
- **Tor Ready**: Easy integration with SOCKS5 proxies for anonymous resolution.
- **Type Safe**: Fully typed with TypeScript.

## Installation

```bash
npm install ncc-05
```

## Usage

### 1. Basic Resolution (Self or Public)

Resolve an identity-bound service locator for a given pubkey.

```typescript
import { NCC05Resolver } from 'ncc-05';
import { nip19 } from 'nostr-tools';

const resolver = new NCC05Resolver();

// Resolve using an npub (or hex pubkey)
const target = 'npub1...';
const mySecretKey = ...; // Uint8Array needed for encrypted records

const payload = await resolver.resolve(target, mySecretKey, 'addr', { 
    gossip: true, // Follow NIP-65 hints
    strict: true  // Reject expired records
});

if (payload) {
    console.log('Resolved Endpoints:', payload.endpoints);
}
```

### 2. Targeted Encryption (Friend-to-Friend)

Alice publishes a record that only Bob can decrypt.

```typescript
import { NCC05Publisher } from 'ncc-05';

const publisher = new NCC05Publisher();
const AliceSK = ...;
const BobPK = "..."; // Bob's hex pubkey

await publisher.publish(relays, AliceSK, payload, {
    identifier: 'for-bob',
    recipientPubkey: BobPK // Encrypts specifically for Bob
});
```

### 3. Group Wrapping (One Event, Many Recipients)

Alice shares her endpoint with a list of authorized friends in a single event.

```typescript
await publisher.publishWrapped(
    relays, 
    AliceSK, 
    [BobPK, CharliePK, DavePK], 
    payload, 
    'private-group'
);

// Bob resolves it using his own key:
const payload = await resolver.resolve(AlicePK, BobSK, 'private-group');
```

### 4. Tor & Privacy (Node.js)

Route all Nostr relay traffic through a local Tor proxy (`127.0.0.1:9050`).

```typescript
import { SocksProxyAgent } from 'socks-proxy-agent';
import { WebSocket } from 'ws';

class TorWebSocket extends WebSocket {
    constructor(address: string, protocols?: string | string[]) {
        const agent = new SocksProxyAgent('socks5h://127.0.0.1:9050');
        super(address, protocols, { agent });
    }
}

const resolver = new NCC05Resolver({
    websocketImplementation: TorWebSocket
});
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

MIT