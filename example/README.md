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
### 5. Automated Testing
You can run a full functional test (Publish -> Wait -> Resolve) using:
```bash
python3 test_ncc05.py
```
This test uses unique keys and a public relay to verify the entire flow.

## Flags
...
- `--onion`: Add a Tor `.onion` address to your record.
- `--proxy`: Route relay traffic through a SOCKS5 proxy (e.g., `127.0.0.1:9050`).- `--gossip` (Resolver only): Enable NIP-65 discovery.
- `--pubkey` (Resolver only): The hex public key to resolve.