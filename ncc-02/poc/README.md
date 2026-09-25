# NCC-02 Proof of Concept (Python)

This is a minimal implementation of the **NCC-02: Pubkey-Owned Service Discovery and Trust** convention.

## Overview

The PoC demonstrates the lifecycle of a pubkey-owned service:
1. **Discovery**: A service owner publishes a signed "Service Record" to a relay.
2. **Verification**: A client fetches the record, verifies the signature, and checks the expiry.
3. **Binding**: The client connects to the endpoint and verifies that the endpoint's cryptographic identity matches the fingerprint in the signed record.

## Components

- `models.py`: Basic Nostr event structure with signing and verification support (using `pynostr`).
- `mock_relay.py`: An in-memory Nostr relay mock that handles parameterized replaceable events (Kind 30059).
- `publisher.py`: Helper for service owners to create and sign NCC-02 records.
- `resolver.py`: Implementation of the client-side resolution and verification algorithm.
- `main.py`: A script demonstrating the successful flow and an expiry failure case.

## Running the PoC

```bash
export PYTHONPATH=$PYTHONPATH:.
python3 poc/main.py
```

## Key NCC-02 Features Implemented

- [x] **Signed Service Records**: Cryptographic proof of ownership.
- [x] **Endpoint Binding**: Mapping a URI to a specific key fingerprint (`k` tag).
- [x] **Short-lived Trust**: Expiry checks via the `exp` tag.
- [x] **Replaceable Events**: Uses NIP-01/NIP-33 style replacement to ensure only the latest record is valid.
