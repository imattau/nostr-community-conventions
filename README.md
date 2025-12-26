# Pubkey-Owned Service Discovery and Trust

**Status:** Informal / Experimental  
**Type:** Convention  
**Layer:** Application  
**Author:** lostcause  
**License:** CC0-1.0

---

**Related NCCs (Informative)**

- NCC-05: NCC-02 can reference service operator pubkeys; authorised clients may resolve endpoints via NCC-05.

- NCC-00: Publication and revision conventions.

**Private Endpoint Resolution (Informative)**

NCC-02 service records include public endpoint references and may disclose network location. Clients MAY use NCC-05 to privately resolve an endpoint for the same service identity when access-controlled resolution is desired. Where NCC-05 resolution succeeds, clients MAY prefer the NCC-05 resolved endpoint while continuing to apply NCC-02 trust semantics.

---

## Abstract

This convention defines a Nostr-native mechanism for discovering and verifying pubkey-owned services inside the Nostr ecosystem, without relying on DNS or public certificate authorities.

It provides signed service discovery, endpoint identity binding, optional third-party attestation, and short-lived, revocable trust.

This is an application-layer trust system for Nostr clients and services. It is not intended to replace HTTPS, DNS, or browser security models.

---

## Motivation

Many Nostr applications need to connect to user-controlled services such as:

- Personal APIs  
- Media servers  
- Wallet backends  
- Agents, bots, or bridges  

Today this typically requires:

- Hard-coded URLs  
- Blind trust in DNS and HTTPS  
- Manual configuration  
- Poor support for dynamic or non-DNS endpoints  

Nostr already provides strong cryptographic identity. What is missing is a standard way to assert:

> “This pubkey owns that service, reachable here, using this key.”

---

## Design Goals

- Pubkey-first authority model  
- Works with dynamic IPs and non-DNS endpoints  
- Minimal protocol surface  
- Explicit, user-visible trust decisions  
- No global roots or hidden authorities  
- Optional third-party attestation only  

---

## Non-goals

- Replacing DNS  
- Supporting browsers or legacy tooling  
- General internet certificate infrastructure  
- Legal or real-world identity verification  

---

## Overview

This convention defines three event roles:

1. **Service Records**, published by a service owner  
2. **Certificate Attestations**, optionally published by third parties  
3. **Revocations**, published by certifiers  

Clients resolve service endpoints by querying Nostr relays, verifying signatures and expiry, optionally validating attestations, and then cryptographically verifying the endpoint itself.

---

## Core Objects

### 1. Service Record

A Service Record is a parameterised replaceable event published by the service owner. It represents the current location and cryptographic identity of a service.

#### Purpose

Bind a pubkey to a reachable endpoint and its transport-level key.

#### Required tags

- `d` – service identifier (for example `api`, `media`, `wallet`)  
- `u` – endpoint URI (`https://`, `wss://`, `tcp://`, `onion://`)  
- `k` – endpoint public key fingerprint (for example SPKI hash)  
- `exp` – expiry timestamp (Unix seconds)  

#### Conventions

- The latest valid, unexpired record is preferred  
- Multiple services per pubkey are distinguished by `d`  
- Short expiries are recommended (7–30 days)  

---

### 2. Certificate Attestation (Optional)

A Certificate Attestation is a signed statement by a certifier pubkey asserting that a specific service record meets a defined standard.

#### Purpose

Provide assurance beyond self-assertion.

#### Required tags

- `subj` – subject pubkey  
- `srv` – service identifier  
- `e` – referenced Service Record event id  
- `std` – standard identifier (for example `nostr-service-trust-v0.1`)  
- `lvl` – trust level (`self`, `verified`, `hardened`)  
- `nbf` – not-before timestamp  
- `exp` – expiry timestamp  

#### Client policy

Clients decide:

- Which certifier pubkeys they trust  
- Which trust levels they accept  
- Whether attestations are required  

---

### 3. Revocation

A Revocation is a signed event published by a certifier revoking a previously issued Certificate Attestation.

#### Required tags

- `e` – certificate event id being revoked  
- Optional human-readable reason  

Revocation overrides expiry.

---

## Client Resolution Algorithm

A client resolving a service SHOULD follow these steps:

1. Query multiple relays for the current Service Record for `(pubkey, service-id)`  
2. Verify signature and expiry  
3. Fetch Certificate Attestations referencing that record  
4. Filter attestations by trusted certifier pubkeys and validity  
5. Apply local policy requirements  
6. Connect to the endpoint  
7. Verify the endpoint key matches fingerprint `k`  
8. Fail closed on mismatch unless explicitly overridden by the user  

---

## Trust Model

- Primary authority is the service owner’s pubkey  
- Certificates are optional and additive  
- Trust stores are explicit and visible to the user or application  
- No implicit global trust is assumed  

This model is intentionally closer to SSH `known_hosts` than to web PKI.

---

## Threat Model

### In scope

- **Endpoint impersonation**  
  Mitigated by binding endpoints to pubkeys and verifying key fingerprints  

- **Man-in-the-middle attacks**  
  Mitigated through key pinning and explicit trust decisions  

- **Stale or hijacked endpoints**  
  Limited via short-lived records, expiry, and revocation  

- **CA misissuance or DNS compromise**  
  Avoided by not relying on DNS or public certificate authorities  

- **Relay inconsistency or partial censorship**  
  Mitigated by querying multiple relays  

### Out of scope

- Endpoint compromise after certification  
- Traffic analysis or metadata leakage  
- User key compromise  
- Global availability guarantees  

---

## Security Properties

This convention provides:

- Endpoint authenticity  
- MITM resistance via key pinning  
- Controlled key rotation  
- Revocation with bounded blast radius  

It does not claim:

- Legal identity  
- Data confidentiality guarantees  
- Browser-level security  

---

## Intended Use Cases

- Nostr apps connecting to user-run backends  
- Wallets and agents bound to pubkeys  
- Self-hosted or onion services  
- “Bring your own infrastructure” architectures  

---

## Related Work

- **NIP-05**  
  Identity discovery via DNS, without endpoint trust, expiry, or revocation  

- **NIP-65**  
  Relay discovery without trust semantics  

- **NIP-89**  
  Application capability discovery rather than service ownership  

This convention intentionally composes existing primitives into a narrow, implementable trust layer focused on endpoint verification.

---

## Novelty

The novelty lies in the composition of existing Nostr patterns to provide:

- Pubkey-authoritative service discovery  
- Cryptographic binding between endpoint and transport key  
- Explicit expiry and revocation  
- Optional third-party attestations  

This functions as an internal alternative to DNS and public CAs for Nostr applications.

---

## Status

Draft v0.1  
Experimental and subject to change. Clients are free to adopt partially or not at all.

---

## Appendix A: Minimal Reference Implementation

### A.1 Service Publisher

```text
service_id = "api"
endpoint_uri = "https://example.net:8443"
endpoint_key_fp = spki_hash(endpoint_tls_cert)
expiry = now + 14 days

### A.1 Service Publisher

Publish a signed, parameterised replaceable event containing the required tags.

---

### A.2 Resolver / Verifier

A resolver or client verifier SHOULD perform the following steps:

- Query relays for service records  
- Select the latest valid, unexpired record  
- Apply local attestation and trust policy  
- Connect to the resolved endpoint  
- Verify the endpoint key fingerprint matches the declared value  

---

### A.3 Certificate Issuer (Optional)

Publish a signed attestation event that references the relevant Service Record and includes a defined validity window.

---

### A.4 Notes

- SQLite is sufficient for local caching  
- No global registry is required  
- Trust stores are application-defined  
- Fail-closed defaults are recommended  

