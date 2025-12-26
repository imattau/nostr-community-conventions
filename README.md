# NCC-06: NCC-02 / NCC-05 Relay Profile

## Type
Convention

## Layer
Application

## Related NCCs (Informative)

- NCC-00: Publication, revision, and discovery of NCC documents on Nostr.
- NCC-02: Pubkey-owned service discovery, endpoint identity binding, trust material (`k`), attestations, and revocations.
- NCC-05: Dynamic endpoint location and rotation for Nostr-identified services.

NCC-06 defines a relay participation profile that composes NCC-02 and NCC-05 for identity-first, DNS-optional relay discovery.

---

## Summary

This Nostr Community Convention defines an opt-in relay participation profile for relays that support identity-first service discovery using NCC-02 (Service Discovery and Trust) and NCC-05 (Dynamic Locators).

Relays conforming to this profile are discovered and addressed via Nostr identity rather than DNS, while remaining fully compatible with NIP-01 clients at the protocol level.

This convention does not modify the Nostr protocol, introduce new message types, or require relays to perform client-side resolution or trust evaluation.

---

## Purpose

This NCC defines what a relay must publish and serve in order to participate in an NCC-02 / NCC-05-based discovery model, enabling:

- Identity-anchored relay addressing  
- DNS-optional endpoint resolution  
- Dynamic endpoint rotation  
- First-class support for Tor and onion services  
- Deterministic, client-side resolution and trust decisions  

---

## Scope

This convention specifies:

- A relay participation profile for NCC-02 and NCC-05
- Required and recommended relay behaviours using existing Nostr primitives
- Clear responsibility boundaries between relays, sidecars, and clients

This convention does not specify:

- New relay-client protocol behaviour
- Relay-side trust enforcement or validation
- DNS-based discovery or identifiers
- Browser or WebView integration
- Internal relay architecture or storage design

---

## Dependencies

Relays conforming to this profile MUST implement:

- NIP-01 (Basic Nostr protocol)

Relays conforming to this profile MUST support:

- NCC-00 (NCC publication and discovery)
- NCC-02 (Service discovery and trust)
- NCC-05 (Dynamic locators)

No other NIPs are required for conformance.

---

## Definitions

### NCC-02 / NCC-05 Relay

A relay that opts into this convention by publishing and serving NCC-02 and NCC-05 records describing itself, and by making those records available to querying clients.

### Service Identity

The Nostr public key (`npub`) that identifies the relay as a service.

### Sidecar Resolver / Publisher

An out-of-band component operated alongside the relay, responsible for publishing and maintaining NCC-02 and NCC-05 records for the relay’s own service identity.

---

## Relay Requirements

A relay claiming conformance to this profile MUST:

### 1. NIP-01 Compliance

- Support standard `EVENT`, `REQ`, `CLOSE`, and `EOSE` semantics
- Accept and serve events using standard subscription filters

### 2. NCC Document Support (NCC-00)

- Accept, store, and serve NCC documents as defined by NCC-00
- At minimum, support publication and retrieval of:
  - NCC-00  
  - NCC-02  
  - NCC-05  
  - NCC-06  
- Treat NCC documents as ordinary Nostr events
- MUST NOT interpret or enforce NCC semantics

### 3. NCC-02 Service and Trust Records

The relay MUST:

- Accept, store, and serve NCC-02-related events, including:
  - Service Records (kind 30059)
  - Certificate Attestations (kind 30060)
  - Revocations (kind 30061)
- Treat all NCC-02-related events as opaque data
- MUST NOT evaluate trust, validate keys, or apply revocations

The relay MUST publish at least one Service Record (30059) describing the relay service itself.

Publishing attestations or revocations is OPTIONAL.

### 4. NCC-05 Locator Records

- Accept, store, and serve NCC-05 Locator events (kind 30058)
- Publish at least one locator describing current reachable endpoints
- Locator records MAY include multiple endpoints, including onion services

### 5. Self-Describing Behaviour

- The relay MUST return its own NCC-02 and NCC-05 records when queried via standard `REQ` filters
- Self-publication MAY be performed by a sidecar resolver or equivalent process

### 6. Client Resolution Neutrality

The relay:

- MUST NOT perform NCC-02 or NCC-05 resolution on behalf of clients
- MUST NOT validate endpoint keys or compare `k` values
- MUST NOT evaluate attestations or revocations
- MUST NOT redirect, proxy, or influence endpoint selection
- MUST remain protocol-dumb with respect to resolution and trust

---

## Sidecar Trust and Publication Responsibilities

A sidecar resolver or publisher operating under this profile MUST, when publishing NCC-02 Service Records:

- Publish a valid `k` tag identifying the service endpoint’s cryptographic key where applicable
- Ensure the published `k` corresponds to the key actually presented by the endpoint
- Update or rotate Service Records when:
  - endpoint keys change
  - endpoint locations change
  - records approach expiry

The sidecar MAY publish Certificate Attestations or Revocations.

The sidecar MUST NOT assume relay-side or client-side trust acceptance.

---

## Transport Selection and `k` Semantics

### Transport Recommendations

- Sidecars SHOULD publish at least one `wss://` clearnet endpoint
- Sidecars MAY publish onion endpoints using:
  - `ws://<onion>`
  - `wss://<onion>`
- Clients SHOULD prefer `wss://` over `ws://` when both are available
- Clients MAY accept `ws://<onion>` where Tor provides the underlying security context
- Clients SHOULD NOT select `ws://` clearnet endpoints unless explicitly configured

### `k` Tag Semantics

- For `wss://` endpoints, the NCC-02 `k` tag SHOULD be a TLS public key fingerprint suitable for pinning
- For `ws://` endpoints, the `k` tag MAY be omitted unless a verifiable non-TLS key identity is defined and supported by the client
- Clients MUST treat `k` as an assertion and verify it independently

---

## Client Interaction Model (Informative)

Clients interacting with relays conforming to this profile are expected to:

1. Identify the relay by Nostr identity
2. Resolve NCC-02 Service Records and trust material
3. Apply attestation and revocation policy locally
4. Resolve NCC-05 Locators for current endpoints
5. Select endpoints based on transport and privacy policy
6. Connect using standard NIP-01 semantics

Relays do not participate in this logic.

---

## Security Considerations

- All NCC-02 and NCC-05 records are signed using standard Nostr keys
- Trust, pinning, and revocation are client-side responsibilities
- Relays act solely as neutral event stores

---

## Non-Goals

This convention does not attempt to:

- Implement or rely on DNS or NIP-05
- Guarantee relay availability
- Prevent Sybil attacks
- Define moderation, certification, or access control policy

---

## Conformance Tests (Non-Normative)

A relay conforms to NCC-06 if:

- It serves kinds 30058, 30059, 30060, and 30061
- It serves NCC documents per NCC-00
- It responds with correct `EOSE` semantics
- It is protocol-compatible with NIP-01 when accessed via a concrete endpoint

---

## Relationship to Other NCCs

- Builds on NCC-00, NCC-02, and NCC-05
- Defines a relay participation profile without protocol changes
- Remains orthogonal to DNS-based and gossip-based discovery

---

## Conclusion

NCC-06 defines a minimal, identity-first relay profile that composes service discovery, trust assertion, and dynamic location using existing Nostr primitives, while preserving strict separation between storage, assertion, and enforcement.

---

## Appendix A: Minimal Reference Implementation (Informative)

This appendix sketches a minimal, working-shaped system that conforms to NCC-06:

- A protocol-dumb NIP-01 relay (WebSocket)
- A sidecar publisher for NCC-02 and NCC-05 records
- A simple client that resolves NCC-02 then NCC-05 and connects

This appendix is informative only. It does not add new requirements beyond NCC-06.

---

### A.1 Components

#### A.1.1 Relay (NIP-01 only)
Responsibilities:
- Accept WebSocket connections
- Handle `EVENT`, `REQ`, `CLOSE`
- Emit `EVENT` messages that match filters
- Emit `EOSE` per subscription
- Store events and retrieve by filter
- No NCC resolution, no trust evaluation, no redirect/proxy

Suggested stack:
- Node.js
- `ws` for WebSocket server
- Any storage: in-memory for tests, SQLite/Postgres/LMDB for real use

#### A.1.2 Sidecar Publisher (out of band)
Responsibilities:
- Maintain the relay’s self-description as a service identity (npub)
- Publish:
  - NCC-02 Service Record (kind 30059) with `d`, `u`, `k`, `exp`
  - NCC-05 Locator (kind 30058) with `d`, TTL, `updated_at`, endpoint list
- Optionally publish:
  - NCC-02 Attestations (30060)
  - NCC-02 Revocations (30061)
- Publish to the relay itself first (local-first bootstrap)

Suggested stack:
- Node.js
- `nostr-tools` for key handling and event signing
- Optional: TLS tooling to compute SPKI fingerprint for `k`

#### A.1.3 Simple Client (resolver + connector)
Responsibilities:
- Input: relay identity (npub) and service id (for example `relay`)
- Fetch NCC-02 Service Record for `(npub, d)`
- Validate:
  - signature
  - `exp` freshness
- Fetch NCC-05 Locator for `(npub, locator d)`
- Apply TTL freshness
- Select endpoint by policy:
  - prefer onion if Tor-capable and policy permits
  - prefer `wss://` over `ws://` when both exist
- Connect to selected endpoint using NIP-01
- Verify endpoint key against NCC-02 `k` when using `wss://`

---

### A.2 Minimal Event Shapes

These examples show representative payloads and tags. Exact tag names and JSON fields should follow your NCC-02 and NCC-05 definitions.

#### A.2.1 NCC-02 Service Record (kind 30059)

Tags:
- `d`: service identifier, for example `relay`
- `u`: fallback endpoint URI
- `k`: endpoint key fingerprint (recommended for `wss://`)
- `exp`: expiry (unix seconds)

Example:
```json
{
  "kind": 30059,
  "pubkey": "<SERVICE_PUBKEY_HEX>",
  "created_at": 1760000000,
  "tags": [
    ["d", "relay"],
    ["u", "wss://203.0.113.10:443"],
    ["k", "spki:sha256:BASE64_OR_HEX"],
    ["exp", "1762592000"]
  ],
  "content": ""
}

