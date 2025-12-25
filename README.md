# NCC-05: Identity-Bound Service Locator Resolution

**Status:** Draft  
**Category:** Discovery / Resolution  
**Author(s):** lostcause  
**Supersedes:** None

---

## Abstract

This Nostr Community Convention defines a client-agnostic method for resolving **dynamic `ip:port` service endpoints** bound to a cryptographic identity, using existing Nostr primitives.

The primary goal of this convention is to enable **cost-effective, private resolution of dynamic `ip:port` endpoints** without relying on domain names, registrars, Dynamic DNS providers, or publicly observable infrastructure.

Clients publish signed, TTL-bound, **encrypted** service locator records as parameterised replaceable events (`kind:30058`). IP address and port information is distributed via Nostr relays without exposing network topology to relays or third parties.

Alternative locator types such as tunnels, overlays, or onion services MAY be included for resilience, but are secondary to the core `ip:port` resolution use case.

This convention does not modify the Nostr protocol or require relay enforcement. It standardises client behaviour for publishing, resolving, caching, and expiring locator records.

---

## 1. Purpose

NCC-05 primarily addresses the problem of **privately resolving dynamic `ip:port` endpoints** in environments where traditional DNS or Dynamic DNS introduces unnecessary cost, public metadata exposure, or operational dependency.

The convention defines shared expectations for:

- publishing encrypted `ip:port` reachability information bound to a pubkey

- resolving that information deterministically

- supporting frequently changing network addresses

- minimising relay load and metadata leakage

- avoiding dependence on registrars, domains, or central services

---

## 2. Scope

This convention applies to:

- client behaviour for publishing encrypted locator records

- deterministic resolution and caching logic

- TTL and refresh semantics

- privacy and abuse mitigation expectations

This convention does **not** define:

- new cryptographic primitives

- relay enforcement rules

- domain name integration

- protocol-level changes

---

## 2.1 Leveraged NIPs

NCC-05 relies entirely on existing Nostr Improvement Proposals and does not introduce new protocol primitives.

### NIP-01: Basic protocol flow

Used for:

- event structure and encoding

- event signing and verification

- relay publish and subscription semantics

- `created_at` ordering

- tag-based filtering, including the `d` tag

All `kind:30058` locator records are valid NIP-01 events.

---

### NIP-16: Replaceable and parameterised replaceable events

Used for:

- parameterised replaceable semantics

- replacement based on `pubkey + kind + d`

- deterministic latest-state resolution

---

### NIP-33: Parameterised replaceable kind ranges

Defines the `30000–39999` range.

This convention assigns **`kind:30058`** for identity-bound service locator records.

---

### NIP-04 and NIP-44: Encrypted event content

Used to encrypt `ip:port` locator payloads.

This convention:

- mandates encryption by default

- does not require a specific encryption NIP

- allows clients to support one or more schemes

---

### NIP-65: Relay List Metadata (Gossip)

NCC-05 MAY leverage relay hints published via NIP-65 to improve resolution efficiency and reliability.

When resolving locator records, clients:

- MAY query relays listed in the target pubkey’s NIP-65 relay list

- SHOULD prefer relays marked for read or both read/write access

- MAY fall back to locally configured or default relays if no NIP-65 data is available

NIP-65 is used strictly as a **hint mechanism** and does not alter NCC-05 resolution semantics or trust assumptions.

---

### Explicit non-dependencies

NCC-05 deliberately does **not** rely on:

- DNS or naming-related NIPs

- relay moderation or enforcement NIPs

- payment, zap, or wallet NIPs

- profile or alias NIPs

---

## 3. Conceptual Model

NCC-05 provides **DNS-like resolution semantics for encrypted `ip:port` reachability**, using Nostr events as the distribution mechanism.

| DNS concept          | NCC-05 analogue           |
| -------------------- | ------------------------- |
| Domain name          | Pubkey                    |
| Record name          | `d` tag                   |
| A / SRV record       | Encrypted `ip:port` entry |
| TTL                  | Payload TTL               |
| Authoritative server | Signature + freshness     |
| Resolver cache       | Client cache              |

Resolution is identity-centric and private by default.

---

## 4. Event Model

### 4.1 Event kind

Locator records **MUST** be published as **parameterised replaceable events** of:

- `kind:30058`

Replaceability is determined by:

- `pubkey`

- `kind = 30058`

- `d` tag value

Clients **MUST** treat locator records as latest-state only.

---

### 4.2 Required tags

| Tag | Description                      |
| --- | -------------------------------- |
| `d` | Stable locator record identifier |

The `d` tag **MUST** remain stable.

Recommended values:

- `addr`

- `addr:v1`

- `addr:<device-id>`

---

### 4.3 Optional tags

No additional tags are required.

Clients **SHOULD** minimise tag usage to reduce metadata leakage.

---

## 5. Payload Format and Encryption

### 5.1 Mandatory encryption

Service locator records **MUST NOT expose `ip:port` data in plaintext by default**.

Event content:

- **MUST** be encrypted when publishing `ip:port` data

- **MUST NOT** include address data in tags

- **MUST** assume relays are not trusted

---

### 5.2 Plaintext exception

A plaintext record MAY be published only if:

- the endpoint is intentionally public

- metadata disclosure is acceptable

- the publisher explicitly opts out of privacy

Clients **MUST NOT** treat plaintext records as private.

---

### 5.3 Payload structure (encrypted)

Logical structure:

- `v`: payload version

- `ttl`: time-to-live in seconds

- `updated_at`: unix timestamp

- `endpoints`: ordered list of endpoint objects

- `caps`: optional capability identifiers

- `notes`: optional text

Direct `ip:port` endpoints are the **primary and expected** use case.

---

## 6. Publishing Behaviour

Clients publishing locator records:

- **MUST** encrypt `ip:port` data by default

- **MUST** sign records with the resolved pubkey

- **MUST** publish only current reachability state

- **SHOULD** publish on change or bounded refresh

- **SHOULD** jitter refresh timing

- **MUST NOT** publish redundant updates

---

## 7. Resolution Algorithm

### Input

- target `pubkey`

- locator name (`d` tag), default `addr`

### Relay selection

Clients SHOULD determine an initial relay set using the following order:

1. Relays advertised by the target pubkey via NIP-65, if available

2. Client-configured default relays

3. Additional relays as required to complete resolution

Relay selection does not affect record validity.

### Query

Clients query selected relays for:

- author = target pubkey

- kind = 30058

- matching `d` tag

### Event selection

Clients:

1. discard invalid signatures

2. discard undecryptable payloads

3. select the event with the highest `created_at`

### Freshness validation

Records are valid only if:

- `now <= updated_at + ttl`

Expired records **MUST NOT** be used.

### Endpoint selection

Clients:

1. prioritise endpoints by ascending `priority`

2. attempt direct `ip:port` endpoints first where present

3. stop after first successful connection

Endpoint failure does not invalidate the record.

---

## 8. Caching and Expiry

- Valid records **SHOULD** be cached until expiry

- TTL **MUST NOT** be extended

- One expired fallback record **MAY** be retained briefly

---

## 9. Privacy Considerations

Encryption protects:

- IP address and port

- network topology

Encryption does not protect:

- pubkey identity

- existence of a locator record

- publish timing

Using NIP-65 relay hints can reduce unnecessary broadcast queries and limit metadata exposure during resolution.

Relays are assumed honest-but-curious.

---

## 10. Abuse and Relay Load

- Records **SHOULD** be small and replaceable

- Publish frequency **SHOULD** align with TTL

- Relays **MAY** apply rate limits or policy

---

## 11. Comparison to Dynamic DNS

Dynamic DNS publishes **public, domain-bound `ip:port` mappings**.

NCC-05 publishes **encrypted, identity-bound `ip:port` mappings** without domains, registrars, or subscriptions.

---

## 12. Non-Goals

This convention is not intended for:

- public website discovery

- human-readable naming

- anonymous global resolution

---

## 13. Why This Is an NCC

NCC-05 standardises **client usage patterns**, not protocol rules.

It uses existing primitives and avoids relay mandates.

---

## 14. Summary

NCC-05 defines **encrypted, identity-bound resolution of dynamic `ip:port` endpoints** using Nostr.

It provides a private, low-cost alternative to Dynamic DNS while remaining fully compatible with the existing protocol.

---

## Appendix A: Example Locator Record and Resolution Flow

### A.1 Example scenario

A user operates a self-hosted service reachable at a dynamic endpoint that may change networks, addresses, or ports.

The user wants authorised clients to discover the current endpoint privately, without exposing it publicly or relying on Dynamic DNS.

---

### A.2 Publishing the locator record

The service publishes a parameterised replaceable event with:

- `kind:30058`

- `d=addr`

- encrypted `content`

#### Example logical content (inside encryption)

- `v`: 1

- `ttl`: 600

- `updated_at`: 1766726400

- `endpoints`:
  
  - type: tcp  
    uri: `[2001:db8:abcd:42::10]:9735`  
    priority: 5  
    family: ipv6
  
  - type: tcp  
    uri: `203.0.113.42:9735`  
    priority: 10  
    family: ipv4

- `caps`:
  
  - nostr-connect

---

### A.2.1 IPv6 considerations

- IPv6 endpoints MAY be included alongside IPv4 endpoints.

- Clients SHOULD attempt endpoints strictly by priority.

- IPv6 literals MUST use standard bracket notation with ports.

- Publishers MAY omit IPv4 endpoints entirely in IPv6-only environments.

---

### A.3 Replaceability and updates

When the service address changes, the publisher emits a new `kind:30058` event using the same `d` tag and a newer `created_at`.

Clients automatically treat the latest event as authoritative.

---

### A.4 Client resolution process

A resolving client:

1. Determines relay set, preferring NIP-65 hints if available.

2. Queries for `kind=30058` events with matching `d` tag.

3. Verifies signature and decrypts payload.

4. Selects the latest valid event.

5. Attempts endpoints by priority.

---

### A.5 Failure handling

If an endpoint connection attempt fails:

- the client MAY attempt the next endpoint

- the locator record remains valid until expiry

---

### A.6 Privacy properties demonstrated

This example demonstrates that:

- `ip:port` data is never visible to relays

- observers cannot infer network topology

- resolution requires prior knowledge of the pubkey

- historical addresses are not exposed

---

### A.7 Relationship to application or browser resolution

Browser extensions, proxies, or custom URI handlers MAY build on NCC-05, but are outside the scope of this convention.

---

### A.8 Summary

Appendix A illustrates how NCC-05 enables encrypted, identity-bound resolution of dynamic `ip:port` endpoints using only existing Nostr primitives.
