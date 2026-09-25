# NCC-08: Service Identity Rotation and Handover

**Status:** Draft  
**Category:** Identity / Lifecycle  
**Author(s):** lostcause  
**Supersedes:** None

**Related NCCs**

- NCC-00: Publication, revision, and discovery of NCC documents.
- NCC-02: Pubkey-owned service identity, trust, endpoint binding, attestations, and revocation.
- NCC-05: Identity-bound service locator resolution.
- NCC-06: Service participation profile composing NCC-02 and NCC-05.
- NCC-07: Service capability advertisement.

## Abstract

This Nostr Community Convention defines a minimal method for transferring the identity of a Nostr-identified service from one pubkey to another while preserving a signed record of continuity.

A handover consists of two signed events:

1. a Handover Proposal published by the current service identity
2. a Handover Acceptance published by the proposed successor identity

A handover is complete only when both events form a valid matching pair.

NCC-08 defines service identity continuity only.

It does not delegate signing authority, transfer private keys, recover lost keys, copy service state, or automatically transfer permissions associated with the previous identity.

## 1. Purpose

Nostr services may use a pubkey as a durable identity.

Over time, that identity may need to change because of:

- planned key rotation
- hardware replacement
- operational restructuring
- transfer of service ownership
- migration between custodians
- security policy
- retirement of an old signing key

Without an explicit continuity mechanism, changing the service pubkey creates a new cryptographic identity with no standard way for clients to determine whether it represents the same service.

NCC-08 addresses the question:

> "Has service identity A intentionally transferred this service to identity B, and has B accepted that role?"

## 2. Design Goals

NCC-08 aims to provide:

- explicit service identity continuity
- mutual acknowledgement by predecessor and successor
- immutable evidence of completed handovers
- deterministic validation of a handover pair
- support for planned future transitions
- compatibility with existing Nostr event semantics
- safe composition with other NCCs
- no dependence on a central identity authority

The convention deliberately separates identity continuity from service state and operational authority.

## 3. Non-Goals

NCC-08 does not define:

- private-key transfer
- delegated signing
- account recovery
- recovery from a compromised predecessor key
- social recovery
- key escrow
- automatic transfer of service data
- automatic transfer of operator authority
- endpoint migration
- capability migration
- service-state migration
- relay enforcement
- legal ownership
- real-world identity transfer

Those concerns belong to separate protocols, conventions, or operational procedures.

## 4. Conceptual Model

A normal NCC-08 handover involves two service identities:

```
Predecessor A
      |
      | proposes handover
      v
Successor B
      |
      | accepts handover
      v
Completed continuity
```

The predecessor states:

> "This service is moving from A to B."

The successor states:

> "B accepts succession from A for this service."

Neither statement alone completes the handover.

## 5. Service Scope

NCC-08 transfers continuity for a specific service, not necessarily every service associated with a pubkey.

Each handover therefore identifies a stable service identifier.

When used with NCC-02, this SHOULD be the same service identifier used by the NCC-02 Service Record `d` tag.

For example:

```
relay
media
wallet
nsite
api
```

If the predecessor identity operates multiple independently identified services, each service SHOULD be handed over separately.

This prevents a handover for one service from implicitly transferring unrelated services associated with the same pubkey.

## 6. Event Kind

NCC-08 handover events use:

- kind `1070`

Kind `1070` is a regular event under the NIP-01 regular event range.

Handover events are intentionally non-replaceable.

A completed identity handover represents historical evidence and SHOULD remain independently verifiable after the transition has occurred.

Both the proposal and acceptance use kind `1070`. Their role is distinguished by the `role` tag.

## 7. Handover Identifier

Every handover MUST have a unique handover identifier.

The identifier is carried in:

```
["handover", "<handover-id>"]
```

The handover identifier SHOULD be a randomly generated 32-byte value encoded as lowercase hexadecimal.

Example:

```
["handover", "8a1f...32-byte-hex...c91e"]
```

The same identifier MUST appear in both the proposal and acceptance events.

The identifier exists to bind the two events into one transition.

It does not represent the service identity itself.

## 8. Handover Proposal

A Handover Proposal is published and signed by the current service identity.

It states that the identified service is intended to move to a specified successor pubkey.

### 8.1 Required Tags

A proposal MUST contain:

```
["role", "predecessor"]
["handover", "<handover-id>"]
["service", "<service-id>"]
["p", "<successor-pubkey-hex>"]
```

There MUST be exactly one successor `p` tag for the handover.

### 8.2 Optional Tags

A proposal MAY contain:

```
["effective", "<unix-seconds>"]
["expires", "<unix-seconds>"]
["reason", "<short-text>"]
```

`effective`
Specifies when the completed handover should become effective.
If omitted, the handover becomes effective when a valid Acceptance Event is created.

`expires`
Specifies the latest time at which the proposal may be accepted.
An acceptance created after this timestamp is invalid.

`reason`
Provides short human-readable context for the transition.
Clients MUST NOT depend on `reason` for validation.

### 8.3 Example Proposal

```json
{
  "kind": 1070,
  "pubkey": "<predecessor-pubkey>",
  "created_at": 1790380000,
  "tags": [
    ["role", "predecessor"],
    ["handover", "8a1f...c91e"],
    ["service", "relay"],
    ["p", "<successor-pubkey>"],
    ["effective", "1790466400"],
    ["expires", "1790552800"],
    ["reason", "planned service key rotation"]
  ],
  "content": ""
}
```

## 9. Handover Acceptance

A Handover Acceptance is published and signed by the successor identity named in the proposal.

It explicitly acknowledges the predecessor and references the exact proposal being accepted.

### 9.1 Required Tags

An acceptance MUST contain:

```
["role", "successor"]
["handover", "<handover-id>"]
["service", "<service-id>"]
["p", "<predecessor-pubkey-hex>"]
["e", "<proposal-event-id>"]
```

There MUST be exactly one predecessor `p` tag.
There MUST be exactly one proposal `e` tag.

### 9.2 Example Acceptance

```json
{
  "kind": 1070,
  "pubkey": "<successor-pubkey>",
  "created_at": 1790383600,
  "tags": [
    ["role", "successor"],
    ["handover", "8a1f...c91e"],
    ["service", "relay"],
    ["p", "<predecessor-pubkey>"],
    ["e", "<proposal-event-id>"]
  ],
  "content": ""
}
```

## 10. Valid Handover Pair

A handover is valid only when a matching proposal and acceptance exist.

Clients MUST verify all of the following:

1. Both events are valid kind `1070` events.
2. Both event signatures are valid.
3. The proposal has `role=predecessor`.
4. The acceptance has `role=successor`.
5. Both events contain the same `handover` identifier.
6. Both events contain the same `service` identifier.
7. The proposal names the acceptance author's pubkey as its successor.
8. The acceptance names the proposal author's pubkey as its predecessor.
9. The acceptance `e` tag references the exact proposal event.
10. The acceptance was not created before the proposal.
11. If the proposal contains `expires`, the acceptance was created no later than that timestamp.

If any of these conditions fail, the events MUST NOT be treated as a completed NCC-08 handover.

## 11. Effective Time

A valid handover pair may become effective immediately or at a future time.

### 11.1 No Explicit Effective Time

If the proposal does not contain an `effective` tag, the effective time is:

```
acceptance.created_at
```

### 11.2 Explicit Effective Time

If the proposal contains:

```
["effective", "<timestamp>"]
```

the handover becomes effective at that timestamp.

The effective timestamp MUST NOT be earlier than:

```
proposal.created_at
```

Clients SHOULD reject a proposal containing an earlier effective timestamp.

The successor MAY publish its acceptance before the effective time.

Until the effective time is reached, the predecessor remains the current service identity.

## 12. Handover States

A handover can be understood as having three states.

### Proposed

A valid predecessor proposal exists, but no matching acceptance exists.

```
A -> B
```

This expresses intent only.

Clients MUST NOT treat B as the successor.

### Accepted

A valid matching proposal and acceptance exist, but the effective time has not yet been reached.

```
A -> B
     accepted
```

The transition is committed but not yet active.

### Effective

A valid matching pair exists and the effective time has been reached.

```
A -> B
     current
```

Clients supporting NCC-08 SHOULD treat B as the successor identity for that service.

## 13. Immutability

NCC-08 uses regular events because identity transitions are historical facts rather than latest-state records.

A completed handover MUST NOT be considered revoked merely because:

- a newer proposal is published
- one of the events later becomes unavailable from a particular relay
- a deletion request is published
- the predecessor later publishes different service metadata

Once a valid handover becomes effective, supporting clients SHOULD preserve the predecessor-to-successor relationship in their local continuity history.

NCC-08 does not define unilateral reversal of an effective handover.

A later transition SHOULD occur as another handover from the current successor to a new identity.

For example:

```
A -> B -> C
```

rather than:

```
A -> B
A -> C
```

## 14. Handover Chains

NCC-08 supports service identity continuity across multiple rotations.

Example:

```
A
|
| NCC-08
v
B
|
| NCC-08
v
C
```

A client resolving historical identity A MAY follow valid effective handovers until it reaches the current known service identity.

Each link MUST independently satisfy NCC-08 validation requirements.

Clients MUST detect loops.

For example:

```
A -> B -> A
```

MUST NOT be followed indefinitely.

A client encountering a loop SHOULD treat the continuity chain as invalid or conflicted.

## 15. Conflicting Handovers

A predecessor may publish more than one handover proposal for the same service.

Unaccepted proposals do not conflict.

For example:

```
A -> B   proposed
A -> C   proposed
```

Neither transition is effective unless accepted.

However, more than one completed handover from the same predecessor for the same service creates an ambiguous continuity claim.

Example:

```
A -> B   accepted
A -> C   accepted
```

NCC-08 does not define a global winner for such conflicts.

Clients encountering multiple incompatible completed handovers for the same predecessor and service:

- MUST NOT silently merge the chains
- SHOULD surface or internally record the conflict
- MAY apply local trust policy
- MAY use previously observed continuity state
- MUST NOT assume that event timestamp alone resolves the conflict

This avoids presenting equivocation as deterministic identity continuity.

## 16. Relationship to NCC-02

NCC-02 defines service identity and trust records.

NCC-08 defines continuity when the pubkey anchoring that service changes.

After an NCC-08 handover becomes effective, the successor SHOULD publish its own NCC-02 Service Record for the transferred service.

For example:

```
Before:

A
└── NCC-02 service: relay

Handover:

A -> B

After:

B
└── NCC-02 service: relay
```

The successor's NCC-02 records are newly signed assertions.

NCC-08 does not copy, transform, or automatically re-sign NCC-02 records from the predecessor.

## 17. Relationship to NCC-05

NCC-05 locator records are bound to the publishing service identity.

After a handover becomes effective, the successor SHOULD publish fresh NCC-05 locator records under the successor pubkey where NCC-05 is used.

Clients MUST NOT automatically reinterpret locator records signed by the predecessor as if they were signed by the successor.

Historical predecessor records MAY remain useful for audit or transition diagnostics.

## 18. Relationship to NCC-07

NCC-07 capability manifests are assertions made by a service identity.

After a handover becomes effective, the successor SHOULD publish a fresh NCC-07 capability manifest.

Capabilities MUST NOT automatically transfer from the predecessor.

For example:

```
A advertises:
  ncc:02
  ncc:05
  pubkey:<x>:media-upload

A -> B

B MUST publish its own capability manifest
if those capabilities remain supported.
```

This prevents clients from assuming that a new operator or implementation supports all capabilities of the previous service identity.

## 19. Authority Does Not Automatically Transfer

NCC-08 transfers service identity continuity only.

It does not automatically transfer:

- delegated authority
- operator permissions
- signer permissions
- access-control decisions
- trusted-agent relationships
- external credentials

Any such authority SHOULD be explicitly re-established under the successor identity.

This preserves the distinction between:

> "This is the successor to the service."

and:

> "This third party is authorised to act for the service."

## 20. Relationship to Delegated Signing

NCC-08 is not a delegated-signing mechanism.

The successor does not sign events on behalf of the predecessor.

After the handover:

```
A remains A
B remains B
```

The continuity relationship is:

```
A was the previous service identity.
B is its acknowledged successor.
```

Historical events signed by A remain attributable to A.

New events published by B remain attributable to B.

NCC-08 therefore does not require clients to reinterpret event authorship.

## 21. Historical Identity

A handover does not erase or replace the predecessor's historical identity.

Clients MAY display continuity such as:

```
Current service: B
Previously: A
```

Historical events SHOULD continue to display their actual signing pubkey.

A client MUST NOT rewrite or present an event originally signed by A as though it were signed by B.

Identity continuity and event authorship are separate concepts.

## 22. Planned Migration Example

A service currently operates under pubkey A.

The operator creates pubkey B and prepares the replacement service.

A publishes:

```
role: predecessor
handover: H
service: relay
successor: B
effective: T
```

B publishes:

```
role: successor
handover: H
service: relay
predecessor: A
proposal: <A's proposal event>
```

Before `T`:

```
current identity = A
successor = B, pending
```

At or after `T`:

```
current identity = B
previous identity = A
```

B then publishes fresh NCC-02, NCC-05, and NCC-07 records as required.

## 23. Transfer of Service Ownership

NCC-08 may also represent a service moving between independent operators.

For example:

```
Operator 1 controls A

A -> B

Operator 2 controls B
```

The cryptographic continuity is the same as for ordinary key rotation.

NCC-08 does not determine:

- legal ownership
- contractual transfer
- organisational authority
- payment or consideration

It records only the signed service-identity transition.

## 24. Lost or Compromised Predecessor Keys

NCC-08's normal handover model requires a valid proposal signed by the predecessor identity.

If the predecessor private key has been permanently lost, it cannot publish such a proposal.

If the predecessor key has been compromised, a proposal signed by that key cannot by itself distinguish the legitimate operator from the attacker.

NCC-08 therefore does not claim to solve recovery from:

- lost predecessor keys
- stolen predecessor keys
- disputed control of a predecessor key

Pre-authorised recovery identities, social recovery, multi-party recovery, or other recovery mechanisms MAY be defined separately.

Clients MUST NOT weaken normal NCC-08 validation rules in an attempt to infer an emergency recovery.

## 25. Security Considerations

### 25.1 Predecessor Key Compromise

An attacker controlling the predecessor key can create handover proposals.

NCC-08 reduces unilateral transfer risk by requiring acceptance from the named successor, but this does not prevent a compromised predecessor from collaborating with another attacker-controlled key.

The security of a normal handover therefore depends on control of both participating keys.

### 25.2 Successor Key Compromise

If the successor key is compromised before the handover becomes effective, the successor acceptance may still be valid cryptographically.

Operators SHOULD secure the successor key before publishing or accepting a transition.

### 25.3 Stale Proposals

Old proposals could otherwise be accepted long after the operator intended them to remain valid.

Predecessors SHOULD include an `expires` timestamp for planned handovers.

Clients MUST reject acceptance events created after the proposal expires.

### 25.4 Equivocation

A predecessor can sign multiple conflicting proposals.

Nostr signatures prove authorship, not consistency.

Clients MUST therefore treat multiple incompatible completed handovers as a conflict rather than manufacturing a deterministic winner from timestamps alone.

### 25.5 Relay Availability

A handover pair may be distributed across different relays.

Clients SHOULD query multiple appropriate relays before concluding that a proposal or acceptance does not exist.

Operators SHOULD publish both handover events to multiple relays where practical.

### 25.6 Historical Preservation

Because handover events establish continuity history, clients and archival services MAY retain them indefinitely.

Operators SHOULD assume completed handover events are public and persistent.

## 26. Privacy Considerations

NCC-08 handovers are public.

They reveal:

- predecessor service pubkey
- successor service pubkey
- service identifier
- approximate transition timing
- optional transition reason

This creates a public link between the old and new service identities.

NCC-08 is therefore unsuitable where unlinkability between predecessor and successor is required.

## 27. Client Resolution

To determine whether service identity A has a valid successor, a client SHOULD:

1. identify the relevant service identifier
2. retrieve kind `1070` proposal events authored by A for that service
3. verify each proposal signature
4. retrieve candidate acceptance events referencing those proposals
5. verify each acceptance signature
6. validate the complete handover pair under Section 10
7. determine whether the effective time has been reached
8. follow the successor identity where appropriate
9. repeat the process if the successor itself has a later valid handover
10. stop on:

- no effective successor
- conflict
- loop
- local policy limit

Clients MAY cache verified handover chains.

## 28. Minimal Conformance

A predecessor conforms to NCC-08 if it:

1. publishes a valid kind `1070` Handover Proposal
2. identifies exactly one successor
3. identifies the transferred service
4. includes a unique handover identifier
5. signs the proposal using the current service identity

A successor conforms to NCC-08 if it:

1. publishes a valid kind `1070` Handover Acceptance
2. references the exact proposal event
3. identifies the predecessor
4. uses the same service identifier
5. uses the same handover identifier
6. signs the acceptance using the successor identity

A client conforms to NCC-08 if it:

1. validates both signatures
2. validates both sides of the relationship
3. does not treat proposals alone as completed handovers
4. respects effective and expiry timestamps
5. preserves actual historical authorship
6. detects conflicting or looping handover chains
7. does not infer transfer of unrelated authority or state

## 29. Why This Is an NCC

NCC-08 does not alter Nostr signing, transport, relay behaviour, or event verification.

It defines an application-layer interpretation of two ordinary signed events:

```
predecessor proposal
        +
successor acceptance
        =
service identity continuity
```

Relays do not need to:

- validate handovers
- resolve successors
- enforce effective times
- understand service identifiers
- determine identity authority

All continuity resolution remains client-side.

## 30. Design Rationale

The convention deliberately requires mutual acknowledgement.

A predecessor-only declaration would allow a service to assign responsibility to an unrelated pubkey without consent.

A successor-only declaration would allow any pubkey to claim succession from an existing service.

Requiring both sides provides a simple cryptographic handshake:

```
A says B succeeds A
        +
B says B accepts from A
        =
mutually acknowledged continuity
```

Regular, non-replaceable events are used because a completed handover is historical evidence rather than mutable current state.

The convention also deliberately avoids automatic migration of NCC-02 records, NCC-05 locators, NCC-07 capabilities, or future authority relationships.

The core design principle is:

> NCC-08 preserves continuity between service identities. It does not make two pubkeys the same identity.

## 31. Status

NCC-08 is experimental.

Implementers are encouraged to:

- use fresh successor keys
- publish proposals with bounded expiry
- distribute handover events across multiple relays
- publish successor service records before or near the effective transition
- preserve completed handovers as continuity history
- treat conflicting completed handovers as explicit ambiguity
- avoid assuming that service state or authority transfers automatically

If NCC-08 is not implemented, the predecessor and successor remain ordinary independent Nostr identities.
