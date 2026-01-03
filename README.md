# Election and Voting Convention

**Convention Type:** Nostr Community Convention (NCC)  
**Convention ID:** NCC-03
**Status:** Draft  
**Category:** Governance  
**Version:** 0.2 (thin core)  
**License:** CC0-1.0  
**Related:** NCC-00, NIP-01, NIP-10, NIP-23, NIP-25, NIP-33

---

## 1. Overview

This Nostr Community Convention defines a minimal, interoperable model for
declaring elections and casting votes on Nostr using existing protocol
primitives.

This convention supports **open, attributable voting** only.

---

## 2. Goals

- Standardise how elections are declared
- Standardise how votes are expressed
- Enable reproducible counting from public data
- Avoid protocol or relay changes
- Remain safely ignorable by non-participating clients

---

## 3. Non-Goals

This convention does not define or enforce:
- Voter eligibility
- Vote weighting
- Sybil resistance
- Governance rules
- Secret or blind ballots
- Cryptographic voting systems

---

## 4. Minimal Compliance

A client is compliant with this convention if it:
1. Can render Election Definition events
2. Can publish Vote events
3. Counts at most one valid vote per pubkey per election within the voting window

---

## 5. Event Model

### 5.1 Election Definition Event

Declares the existence and parameters of an election.

**Properties**
- Non-replaceable
- Public
- Canonical anchor for votes

**Required fields**
- Title or description
- One or more options
- Closing time

**Recommended tags**
- `d` — election identifier
- `option` — available choices
- `startsAt` — unix timestamp (optional)
- `endsAt` — unix timestamp (required)
- `rules` — human-readable summary (optional)
- `ref` — contextual reference (optional)

The Election Definition Event is the authoritative reference for all votes.

---

### 5.2 Vote Event

Represents a voter’s selection in an election.

**Properties**
- Signed by the voter’s pubkey
- References exactly one election
- Expresses one selected option

**Required tags**
- `e` — reference to Election Definition Event
- `d` — election identifier
- `choice` — selected option identifier

**Optional**
- Vote events MAY be parameterised replaceable events (NIP-33),
  using the election identifier as the parameter.

---

## 6. Voting Window and Validity

A vote is valid if and only if:
1. It references a valid Election Definition Event
2. Its `created_at` timestamp is:
   - Greater than or equal to `startsAt` (if present)
   - Strictly less than `endsAt`
3. The selected option exists in the election definition

Votes outside the voting window MUST be ignored.

---

## 7. One Vote per Pubkey

For each election, only one vote per pubkey is counted.

If multiple valid votes from the same pubkey exist:
- The vote with the greatest `created_at` timestamp before `endsAt` is counted
- All earlier votes from that pubkey are ignored

If parameterised replaceable events (NIP-33) are used, the latest event
implicitly supersedes earlier ones.

---

## 8. Result Derivation (Non-Normative)

This convention does not mandate a counting algorithm.

Clients derive results by:
1. Collecting valid votes
2. Deduplicating by pubkey
3. Counting selections per option

Counting assumptions MUST be disclosed by the client or publisher.

---

## 9. Security Properties

This convention provides:
- Integrity via signatures
- Transparency via public events
- Auditability via replayable data

This convention does **not** provide:
- Vote secrecy
- Anonymity
- Coercion resistance
- Sybil resistance

---

## 10. Compatibility

This convention is compatible with:
- NIP-25 reactions (informal signalling)
- NIP-23 governance documents
- NIP-33 replaceable events
- Trust or eligibility conventions defined elsewhere

---

## 11. Extensions

Eligibility rules, relay enforcement, result publication,
auditing, and secret-voting coordination are defined in
non-normative appendices or companion conventions.

---
