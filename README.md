# NCC-06: NCC-02 / NCC-05 Service Profile

## Type

Convention

## Layer

Application

## Related NCCs (Informative)

- NCC-00: Publication, revision, and discovery of NCC documents on Nostr.
- NCC-02: Pubkey-owned service discovery, endpoint identity binding, trust material (`k`), attestations, and revocations.
- NCC-05: Dynamic endpoint location and rotation for Nostr-identified services.

NCC-06 defines a service participation profile that composes NCC-02 and NCC-05 for identity-first, DNS-optional service discovery.

---

## Summary

This Nostr Community Convention defines an opt-in service participation profile for any Nostr-identified service that supports identity-first service discovery using NCC-02 (Service Discovery and Trust) and NCC-05 (Dynamic Locators).

Services conforming to this profile are discovered and addressed via Nostr identity rather than DNS, while remaining fully compatible with their respective protocols (e.g. NIP-01 for relays, HTTP for APIs).

This convention does not modify underlying protocols, introduce new message types, or require services to perform client-side resolution or trust evaluation.

---

## Purpose

This NCC defines what a service must publish and serve in order to participate in an NCC-02 / NCC-05-based discovery model, enabling:

- Identity-anchored service addressing
- DNS-optional endpoint resolution
- Dynamic endpoint rotation
- First-class support for Tor and onion services
- Deterministic, client-side resolution and trust decisions
- Robust behaviour under partial failure and inconsistent data

---

## Scope

This convention specifies:

- A service participation profile for NCC-02 and NCC-05
- Required and recommended behaviours for services, sidecars, and clients under this profile
- Deterministic conflict handling and caching rules for clients (without moving logic into services)
- Publication redundancy expectations for sidecars to reduce single points of failure

### Identity-First Addressing

Services conforming to this profile are addressed by **Nostr identity**, not by DNS hostnames.

Clients are expected to refer to such services using identity-based URIs (for example `wss://<npub>` for relays or `https://<npub>` for APIs), which function as **identity references**, not concrete network endpoints.

These identity-based URIs MUST NOT be dereferenced directly. Clients MUST resolve them via NCC-02 and NCC-05 before establishing a network connection.

Services MUST NOT accept, interpret, or resolve identity-based URIs.

This convention does not specify:

- New service-client protocol behaviour
- Service-side trust enforcement or validation
- DNS-based discovery or identifiers
- Browser or WebView integration
- Internal service architecture or storage design

---

## Dependencies

Services conforming to this profile MUST support:

- NCC-00 (NCC publication and discovery)
- NCC-02 (Service discovery and trust)
- NCC-05 (Dynamic locators)

---

## Definitions

### NCC-02 / NCC-05 Service

A service (e.g. a relay, API, or media server) that opts into this convention by publishing and serving NCC-02 and NCC-05 records describing itself, and by making those records available to querying clients.

### Service Identity

The Nostr public key (`npub`) that uniquely identifies the service.

### Sidecar Publisher

A dedicated companion component operated alongside the service. It is the primary actor responsible for enabling NCC-06 compliance by publishing and maintaining NCC-02 and NCC-05 records for the service's identity.

### Publication Relay Set

A set of relays used to publish and retrieve NCC-02/NCC-05 records, including (ideally) the target relay itself plus additional relays to avoid a single point of failure.

### Freshness

A record is **fresh** if it is within its declared validity window:
- NCC-02 Service Record: within its `exp`
- NCC-05 Locator: within its TTL (or equivalent freshness tags defined by NCC-05)

---

## Service Requirements (e.g. Relays)

A service (such as a relay) claiming conformance to this profile MUST:

### 1. Protocol Compliance

- Support its base protocol (e.g. NIP-01 for relays, HTTP for APIs)
- For relays: Support standard `EVENT`, `REQ`, `CLOSE`, and `EOSE` semantics

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

The service MUST:

- Accept, store, and serve NCC-02-related events, including:
  - Service Records (kind 30059)
  - Certificate Attestations (kind 30060)
  - Revocations (kind 30061)
- Treat all NCC-02-related events as opaque data
- MUST NOT evaluate trust, validate keys, or apply revocations

The service MUST publish at least one Service Record (30059) describing itself.

Publishing attestations or revocations is OPTIONAL.

### 4. NCC-05 Locator Records

- Accept, store, and serve NCC-05 Locator events (kind 30058)
- Publish at least one locator describing current reachable endpoints
- Locator records MAY include multiple endpoints, including onion services

### 5. Self-Describing Behaviour

- The service MUST return its own NCC-02 and NCC-05 records when queried via standard Nostr filters
- Self-publication MAY be performed by a sidecar resolver or equivalent process

### 6. Client Resolution Neutrality

The service:

- MUST NOT perform NCC-02 or NCC-05 resolution on behalf of clients
- MUST NOT validate endpoint keys or compare `k` values
- MUST NOT evaluate attestations or revocations
- MUST NOT redirect, proxy, or influence endpoint selection
- MUST remain protocol-dumb with respect to resolution and trust

---

## Robustness Requirements

This section defines required or recommended behaviours to handle real-world failure modes without adding service-side intelligence.

### A. Conflicting Records (Normative Client Handling)

Clients MUST assume they may receive multiple candidate records for the same `(service pubkey, kind, d)` due to:
- service divergence
- propagation delays
- sidecar misconfiguration
- malicious publication

Clients MUST apply a deterministic selection rule per record type:

#### A.1 Selecting NCC-02 Service Records (kind 30059)

Given a set of candidate Service Records matching `(pubkey, d)`:
1. Discard records with invalid signatures.
2. Discard records that are expired (`now > exp`) unless operating in **stale fallback** mode (see Section D).
3. Prefer the record with the greatest `created_at`.
4. If tied on `created_at`, prefer the record with the lexicographically greatest event id.

If the chosen record’s `u` points to an endpoint that is unreachable, clients SHOULD try alternate valid candidates in descending order before failing (see Section B).

#### A.2 Selecting NCC-05 Locators (kind 30058)

Given a set of candidate Locator records matching `(pubkey, d)`:
1. Discard records with invalid signatures.
2. Discard records that are stale by TTL unless operating in **stale fallback** mode (see Section D).
3. Prefer the record with the greatest freshness marker as defined by NCC-05 (for example `updated_at`), otherwise `created_at`.
4. If tied, prefer lexicographically greatest event id.

Clients SHOULD treat Locator endpoints as an ordered candidate set, not a single truth, and apply reachability and policy selection (see Sections B and E).

### B. Partial Availability (Normative Client Behaviour)

Clients MUST NOT assume that a “correct” record implies a reachable endpoint.

When resolving to endpoints, clients SHOULD:
- try endpoints in a policy-defined preference order (see Section E)
- stop on first successful connection
- record per-endpoint health with exponential backoff on failures
- avoid retry storms by applying jitter and minimum retry intervals
- maintain a “last known good endpoint” cache keyed by `(pubkey, d)`

Sidecars SHOULD publish multiple endpoints when available (for example multiple PoPs, clearnet plus onion, alternate ports) to increase survivability.

### C. Service Unavailability (Normative Publication and Retrieval)

A core failure mode is: the service storing its own NCC-02/NCC-05 records is unreachable.

#### C.1 Sidecar Publication Redundancy (Normative)

Sidecars operating under NCC-06 MUST publish NCC-02 and NCC-05 records to:
- the service itself (local-first bootstrap) when reachable, AND
- at least one additional relay in a configured Publication Relay Set

Sidecars SHOULD publish to multiple additional relays to reduce correlated failure.

#### C.2 Client Retrieval Redundancy (Normative)

Clients MUST query for NCC-02 and NCC-05 records across a Publication Relay Set, not only the target service endpoint(s).

If the client has no configured Publication Relay Set, it SHOULD use a small default set (implementation-defined).

If all publication relays are unreachable or return no valid records:
- clients MAY fall back to a user-supplied concrete endpoint, or a previously cached endpoint,
- otherwise resolution fails.

### D. Caching, Staleness, and Fallback (Normative)

Clients will cache NCC-02 and NCC-05 records for performance and reliability. Caching creates staleness risk.

#### D.1 Cache Keys

Clients SHOULD cache by:
- NCC-02 Service Record: `(pubkey, d, kind=30059)`
- NCC-05 Locator: `(pubkey, d, kind=30058)`

Clients SHOULD store:
- selected event id
- record `created_at`
- retrieval time (`fetched_at`)
- record validity window (`exp` or TTL metadata)
- derived endpoint list

#### D.2 Freshness Enforcement

Clients MUST treat records as non-fresh when:
- NCC-02: `now > exp`
- NCC-05: TTL window has elapsed per NCC-05 definition

#### D.3 Stale Fallback Mode

To avoid hard failure during propagation delays or temporary publication relay outages, clients MAY enter stale fallback mode when:
- no fresh valid record is obtainable, AND
- the client has at least one previously cached valid record

In stale fallback mode:
- clients MAY use the newest previously cached record even if stale
- clients SHOULD apply a maximum staleness window (implementation-defined)
- clients MUST surface (internally or to the user) that a stale record was used
- clients SHOULD aggressively refresh in the background on subsequent attempts (without retry storms)

### E. Multiple Valid Paths and Trust (Normative Client Policy)

When multiple endpoints are available, clients must choose based on both reachability and trust.

#### E.1 Transport Preference

Unless the user explicitly overrides, clients SHOULD apply:
1. Prefer secure endpoints (`wss://`, `https://`, `tls://`) with verifiable `k`
2. Then secure endpoints without `k` (lower trust)
3. Then onion endpoints when Tor-capable and allowed by user policy
4. Avoid insecure clearnet endpoints (`ws://`, `http://`, `tcp://`) unless explicitly configured

#### E.2 `k` Verification Requirements

- For secure endpoints, clients SHOULD verify the endpoint key material against NCC-02 `k` where defined by NCC-02.
- If `k` is present and does not match, clients MUST treat that endpoint as failing trust and MUST NOT connect to it unless the user explicitly overrides.
- If `k` is absent, clients MAY connect according to local policy, but SHOULD treat it as lower trust.

#### E.3 Conflicts Between Trust Paths

If multiple fresh records exist and imply different trust bindings (different `k` values or materially different endpoint sets), clients SHOULD:
- prefer the candidate record whose `k` matches the observed endpoint key on successful connection
- otherwise fall back to the deterministic conflict rules in Section A and treat the result as untrusted until verified

Services MUST remain neutral and MUST NOT enforce these rules.

---

## Sidecar Trust and Publication Responsibilities

A sidecar resolver or publisher operating under this profile MUST, when publishing NCC-02 Service Records:

- Publish a valid `k` tag identifying the service endpoint’s cryptographic key where applicable
- Ensure the published `k` corresponds to the key actually presented by the endpoint
- Update or rotate Service Records when:
  - endpoint keys change
  - endpoint locations change
  - records approach expiry

In addition, sidecars operating under NCC-06:

- MUST publish to a Publication Relay Set (see Section C.1)
- SHOULD publish multiple endpoints where possible to improve survivability (see Section B)
- SHOULD avoid publishing short expiries or TTLs that cannot be reliably refreshed under normal operation

The sidecar MAY publish Certificate Attestations or Revocations.

The sidecar MUST NOT assume service-side or client-side trust acceptance.

---

## Transport Selection and `k` Semantics

### Transport Recommendations

- Sidecars SHOULD publish at least one secure clearnet endpoint (e.g. `wss://` or `https://`)
- Sidecars MAY publish onion endpoints using:
  - `ws://<onion>`
  - `wss://<onion>`
- Clients SHOULD prefer secure protocols over insecure ones when both are available
- Clients MAY accept `ws://<onion>` where Tor provides the underlying security context
- Clients SHOULD NOT select insecure clearnet endpoints unless explicitly configured

### `k` Tag Semantics

- For secure endpoints, the NCC-02 `k` tag SHOULD be a public key fingerprint (e.g. TLS SPKI) suitable for pinning
- For insecure endpoints, the `k` tag MAY be omitted unless a verifiable non-TLS key identity is defined and supported by the client
- Clients MUST treat `k` as an assertion and verify it independently

---

## Onion Endpoints (Informative)

NCC-06 supports onion endpoints as a first-class deployment option to enable DNS-optional and location-hiding service access.

### Publishing onion endpoints

A service MAY publish one or more onion endpoints in its NCC-05 Locator (kind 30058) endpoints list.

Typical forms include:

- `ws://<onion>.onion:<port>` (common)
- `wss://<onion>.onion:<port>` (optional defence-in-depth)

Onion endpoints SHOULD be published via NCC-05 (dynamic locator) rather than being assumed stable or discoverable elsewhere.

### Transport and trust considerations

- Onion endpoints using `ws://` rely on Tor’s security properties for confidentiality and endpoint authentication.
- The NCC-02 `k` tag binds the service identity to the key presented by the transport endpoint and therefore applies to secure endpoints only.
- Clients SHOULD NOT require `k` verification for `ws://` onion endpoints.
- Clients MAY apply additional local policy, such as preferring onion endpoints when Tor is available.

### Operational model

An onion endpoint MAY be:
- managed by the service operator externally, or
- managed by an administrative sidecar that creates and maintains the hidden service and republishes NCC-05 when endpoints change.

Services remain protocol-dumb and do not participate in endpoint discovery or onion service management.

---

## Client Interaction Model (Informative)

Clients interacting with services conforming to this profile are expected to:

1. Identify the service by Nostr identity (for example via an identity-based URI such as `wss://<npub>` or `https://<npub>`), not by hostname
2. Resolve NCC-02 Service Records and trust material
3. Apply attestation and revocation policy locally
4. Resolve NCC-05 Locators for current endpoints
5. Apply conflict handling, caching, and fallback rules (Sections A–D)
6. Select endpoints based on transport and trust policy (Section E)
7. Connect using the service's base protocol (e.g. NIP-01 for relays)
8. Verify endpoint key against NCC-02 `k` when using secure transports

Identity-based URIs are not dereferenced directly and are always resolved through NCC-02 and NCC-05 prior to connection.

Services do not participate in this logic.

---

## Security Considerations

- All NCC-02 and NCC-05 records are signed using standard Nostr keys
- Trust, pinning, and revocation are client-side responsibilities
- Services act solely as neutral event stores
- Publication relay redundancy reduces availability risks but does not remove the need for client-side trust evaluation

---

## Non-Goals

This convention does not attempt to:

- Implement or rely on DNS or NIP-05
- Guarantee service availability
- Prevent Sybil attacks
- Define moderation, certification, or access control policy

---

## Conformance Tests (Non-Normative)

A service conforms to NCC-06 if:

- It serves kinds 30058, 30059, 30060, and 30061
- It serves NCC documents per NCC-00
- It responds with correct `EOSE` semantics
- It is protocol-compatible with its base protocol when accessed via a concrete endpoint
- It does not resolve identity references for clients, and remains protocol-dumb

A sidecar conforms to NCC-06 publication robustness expectations if it:
- publishes NCC-02 and NCC-05 records to a Publication Relay Set (not only the target service)

A client conforms to NCC-06 robustness expectations if it:
- applies deterministic conflict selection (Section A)
- handles partial endpoint availability with ordered attempts and backoff (Section B)
- queries multiple publication relays for records (Section C.2)
- enforces freshness and uses bounded stale fallback (Section D)
- applies transport and `k` trust policy (Section E)

---

## Relationship to Other NCCs

- Builds on NCC-00, NCC-02, and NCC-05
- Defines a service participation profile without protocol changes
- Remains orthogonal to DNS-based and gossip-based discovery

---

## Conclusion

NCC-06 defines a minimal, identity-first service profile that composes service discovery, trust assertion, and dynamic location using existing Nostr primitives, while preserving strict separation between storage, assertion, and enforcement.

It additionally specifies deterministic and robust client and sidecar behaviours to handle conflicting records, partial availability, service unavailability, and caching staleness, without moving resolution or trust enforcement into services.

---

## Appendix A: Minimal Reference Implementation (Informative)

This appendix describes a minimal, working-shaped system that conforms to NCC-06. It illustrates **component roles and responsibilities**, not a production deployment or complete failure handling logic.

The reference implementation consists of three logical components:

1. A protocol-dumb service (e.g. a NIP-01 relay)
2. A sidecar publisher for NCC-02 and NCC-05 records
3. A policy-aware client

Each component is intentionally simple and narrowly scoped.

---

### A.1 Protocol-Dumb Service

The service is a standard event store (like a NIP-01 relay) with no NCC-specific logic.

The service:

- Accepts and serves Nostr events using standard semantics
- Stores and serves NCC documents (NCC-00, NCC-02, NCC-05, NCC-06) as ordinary events
- Stores and serves NCC-02 Service Records, attestations, and revocations
- Stores and serves NCC-05 Locator records
- Does not interpret event content, tags, or semantics
- Does not resolve identities, select endpoints, or evaluate trust

The service may be unreachable, partially reachable, or out of sync with other relays. It is not assumed to be authoritative.

The service MAY store its own NCC-02 and NCC-05 records, but MUST NOT be treated as the sole source of those records.

---

### A.2 Sidecar Publisher

The sidecar is an out-of-band process operated alongside the service. It is responsible for **asserting service state**, not enforcing it.

The sidecar:

- Publishes NCC-02 Service Records (kind 30059) for the service identity
- Publishes NCC-05 Locator records (kind 30058) describing current reachable endpoints
- Optionally publishes NCC-02 attestations or revocations
- Maintains the correspondence between published records and actual service state

To conform with NCC-06 robustness expectations, the sidecar:

- Publishes records to a **Publication Relay Set**, not to a single relay
- Attempts publication to the target service when reachable
- Publishes to at least one additional relay to avoid single points of failure
- Republishes records when:
  - endpoints change
  - endpoint keys change
  - records approach expiry
- May publish multiple endpoints (for example multiple PoPs, clearnet and onion) to improve availability

The sidecar does not assume that any single relay will always be reachable or consistent.

The sidecar does not perform client resolution, endpoint selection, or trust enforcement.

---

### A.3 Policy-Aware Client

The client is responsible for **resolution, selection, caching, and trust decisions**.

The client:

1. Identifies the service by Nostr public key (service identity)
2. Queries a Publication Relay Set for NCC-02 Service Records and related trust material
3. Applies deterministic conflict resolution to select candidate records
4. Enforces freshness rules and caches records with validity metadata
5. Falls back to bounded stale records when fresh records are unavailable
6. Queries for NCC-05 Locator records and derives an ordered endpoint set
7. Attempts endpoints in policy-defined order with backoff and retry control
8. Verifies endpoint key material against NCC-02 `k` where applicable
9. Establishes a connection to the selected endpoint using the service's base protocol

The client:

- Does not assume global consistency
- Does not assume immediate propagation
- Does not assume a single valid path
- Treats all records as assertions, not guarantees

All trust, caching, and selection logic is strictly client-side.

---

### A.4 Failure and Degradation Model

This reference implementation assumes:

- Conflicting records may exist across relays
- Some relays may be unreachable
- Some endpoints may be temporarily unavailable
- Cached data may become stale

Correct operation is achieved through:

- Redundant publication by the sidecar
- Redundant retrieval by the client
- Deterministic client-side conflict handling
- Bounded stale fallback
- Ordered endpoint attempts

No component relies on service-side enforcement or consensus.

---

### A.5 Summary

This reference implementation demonstrates that:

- Services remain protocol-dumb and interchangeable
- Sidecars assert service state redundantly
- Clients resolve identity, trust, and location deterministically

NCC-06 achieves robustness through **composition and policy**, not through additional protocol features or service intelligence.

## Companion `ncc-06-js` package

To make the NCC-06 resolver, selector, and NCC-02/NCC-05 helpers reusable outside of this specific example harness, there's a dedicated `ncc-06-js` npm package in the repository. It provides:

- **Service-Agnostic Helpers:** Full support for `serviceUrl`, `serviceMode`, and custom `allowedProtocols` (e.g. `https`, `tcp`), allowing discovery for any Nostr-identified service.
- **Deterministic NCC-06 resolution:** Resolver orchestration that fetches service records, locators, and enforces `k` fingerprints for any secure protocol (`wss`, `https`, `tls`, etc).
- **NCC-02/NCC-05 builders & validators:** Logic to parse and manage the `d`, `u`, `k`, and `exp` tags a service record must expose.
- **External endpoint helpers:** Helpers to declare onion/IPv6/IPv4 reachability in a reproducible order.
- **Key and trust utilities:** SPKI fingerprint calculation (`k`), keypair management, and certificate generation.

The `ncc06-relay` example now installs this package via a `file:` dependency and reuses the selector helpers so that the resolver logic is consistent, testable, and easier to consume in other projects.
