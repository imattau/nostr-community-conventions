# NCC-05 Proof of Concept

This example demonstrates the implementation of **NCC-05: Identity-Bound Service Locator Resolution**.

## Features

- **Privacy-First IP Discovery**: 
  - Automatically detects global IPv6 addresses locally (no leakage).
  - Optional `--ip` flag for manual entry.
  - Optional `ipify` fallback with warning.
- **Tor Support**:
  - Include `.onion` addresses in your locator records.
  - Route Nostr traffic through Tor (SOCKS5) to hide your IP from relays.
- **NIP-65 Gossip Support**: 
...
### 4. Tor & Privacy
**Publish an Onion service anonymously:**
```bash
python3 publisher.py --nsec --onion xyz.onion --proxy 127.0.0.1:9050 --live
```

**Resolve anonymously:**
```bash
python3 resolver.py --nsec --pubkey <hex> --proxy 127.0.0.1:9050 --live
```

## Flags
...
- `--onion`: Add a Tor `.onion` address to your record.
- `--proxy`: Route relay traffic through a SOCKS5 proxy (e.g., `127.0.0.1:9050`).- `--gossip` (Resolver only): Enable NIP-65 discovery.
- `--pubkey` (Resolver only): The hex public key to resolve.