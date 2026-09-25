# NCC-07: Service Capability Manifest

**Status:** Draft  
**Category:** Discovery / Capabilities  
**Author(s):** lostcause  
**Supersedes:** None

**Related NCCs**

- NCC-00: Publication, revision, and discovery of NCC documents.
- NCC-02: Pubkey-owned service identity, trust, endpoint binding, attestations, and revocation.
- NCC-05: Identity-bound service locator resolution.
- NCC-06: Service participation profile composing NCC-02 and NCC-05.

## Abstract

This Nostr Community Convention defines a minimal, machine-readable method for a Nostr-identified service to advertise the capabilities it claims to support.

A capability manifest is published as a signed addressable event associated with the service identity. Each capability is represented by a simple identifier.

NCC-07 defines capability advertisement only. It does not define the behaviour of advertised capabilities, negotiate between capabilities, prove that a capability functions, authorise its use, or replace protocol-specific discovery mechanisms.

## 1. Purpose

Nostr applications increasingly interact with services identified by public keys rather than only by hostnames or fixed endpoints.

NCC-02 can establish:

> "This pubkey identifies this service."

NCC-05 can establish:

> "This service is currently reachable here."

NCC-07 addresses a separate question:

> "What does this service claim to support?"

Examples include:

- support for an NCC
- support for a Nostr protocol feature
- application-specific functionality
- service extensions
- optional interfaces
- experimental capabilities

The convention provides a common discovery mechanism without attempting to define those capabilities.

## 2. Design Goals

NCC-07 aims to provide:

- simple machine-readable capability discovery
- signed capability assertions bound to a service identity
- deterministic latest-state behaviour
- extensibility without a central capability registry
- compatibility with existing Nostr primitives
- safe handling of unknown capabilities
- composition with protocol-specific discovery mechanisms

The convention deliberately favours a small interoperable core over a complete service-description language.

## 3. Non-Goals

NCC-07 does not define:

- service identity
- service endpoint discovery
- service trust
- access control
- authorisation
- protocol negotiation
- API schemas
- capability parameters
- health or availability
- software versions
- service limits
- pricing
- capability verification
- relay enforcement
- transport behaviour

Those concerns belong to the relevant protocol, NCC, NIP, or application.

## 4. Conceptual Model

NCC-07 separates service identity, reachability, and capability.

```
NCC-02
Who or what is this service?

NCC-05
Where can it currently be reached?

NCC-07
What does it claim to support?
```

NCC-07 MAY be used independently. When used with NCC-02 and NCC-05, the same service pubkey SHOULD be used as the identity anchor.

## 5. Capability Assertions

A capability is a signed assertion by a service identity that the service intends to support a named behaviour, interface, convention, or feature.

For example:

```
ncc:05
```

means: the service claims to support NCC-05. It does not mean the service has been independently verified as correctly implementing NCC-05.

Capability advertisement is therefore declarative rather than evidentiary. Clients MUST NOT treat the presence of a capability as proof that the capability is functional, secure, reachable, or correctly implemented.

## 6. Event Definition

### 6.1 Event Kind

Capability manifests use:

- kind `30062`

Kind `30062` is an addressable event under the NIP-01 addressable event range.

The stable `d` tag for the default service capability manifest is:

```
capabilities
```

The manifest is therefore identified by:

```
kind + pubkey + d
```

For the default manifest:

```
30062:<service-pubkey>:capabilities
```

### 6.2 Required Tags

A capability manifest MUST contain:

```
["d", "capabilities"]
```

It MUST contain at least one:

```
["cap", "<capability-identifier>"]
```

Example:

```json
[
  ["d", "capabilities"],
  ["cap", "ncc:02"],
  ["cap", "ncc:05"]
]
```

Each `cap` tag represents one capability assertion.

### 6.3 Content

The `content` field SHOULD be empty. Clients MUST NOT require capability information to be duplicated in `content`.

Future conventions MAY define additional content structures, but NCC-07 capability discovery depends only on `cap` tags.

### 6.4 Example Event

```json
{
  "kind": 30062,
  "pubkey": "<service-pubkey-hex>",
  "created_at": 1790380000,
  "tags": [
    ["d", "capabilities"],
    ["cap", "ncc:02"],
    ["cap", "ncc:05"],
    ["cap", "pubkey:<publisher-pubkey-hex>:media-upload"]
  ],
  "content": "",
  "sig": "<signature>"
}
```

This service asserts support for:

- NCC-02
- NCC-05
- an application-defined `media-upload` capability

## 7. Capability Identifiers

Capability identifiers MUST be treated as opaque strings except where their namespace is understood by the client. Capability identifiers SHOULD be lowercase.

Three namespaces are defined by this convention.

### 7.1 NIP Capabilities

A Nostr Improvement Proposal MAY be referenced using:

```
nip:<number>
```

Examples:

```
nip:44
nip:46
nip:47
```

The identifier asserts support for behaviour defined by that NIP. NCC-07 does not alter or reinterpret the referenced NIP. A client MUST use the referenced NIP itself to determine what support means.

### 7.2 NCC Capabilities

A Nostr Community Convention MAY be referenced using:

```
ncc:<number>
```

Examples:

```
ncc:02
ncc:05
ncc:06
```

The identifier asserts support for behaviour described by that NCC. NCC-07 does not define the implementation requirements of another NCC.

### 7.3 Pubkey-Namespace Capabilities

Application-specific capabilities SHOULD use a pubkey-controlled namespace:

```
pubkey:<hex-pubkey>:<capability-name>
```

Example:

```
pubkey:abcdef0123456789...:media-upload
```

The pubkey component identifies the namespace authority. The namespace authority is responsible for documenting the meaning of that capability.

Capability names SHOULD:

- use lowercase ASCII characters
- be concise
- remain stable once published
- use hyphens where word separation is required

Examples:

```
pubkey:<hex>:media-upload
pubkey:<hex>:thumbnail-generation
pubkey:<hex>:remote-backup
```

No global registry is required. Two different pubkeys MAY define capabilities with the same capability name without collision because the complete identifiers remain different.

## 8. Capability Ownership

The publisher of a capability manifest does not automatically control the meaning of every capability it advertises.

For example:

```
["cap", "ncc:05"]
```

references NCC-05. The service publisher cannot redefine NCC-05 by using that identifier.

Likewise:

```
["cap", "pubkey:<A>:media-upload"]
```

refers to a capability whose namespace is controlled by pubkey A, regardless of which service publishes the manifest.

This allows multiple independent services to advertise support for the same application-defined capability.

## 9. Client Resolution

To resolve a service capability manifest, a client SHOULD:

1. Identify the target service pubkey.
2. Query appropriate relays for:
   - `kind = 30062`
   - author = target service pubkey
   - `d = capabilities`
3. Verify the event signature.
4. Apply normal NIP-01 addressable event replacement semantics.
5. Read all valid `cap` tags.
6. Interpret capabilities it understands.
7. Ignore capabilities it does not understand.

Unknown capability identifiers MUST NOT cause manifest rejection.

### 9.1 Replacement

A new capability manifest replaces the previous manifest for the same:

```
kind + pubkey + d
```

A service therefore publishes its complete current capability set each time the manifest changes.

For example, an update from:

```
ncc:02
ncc:05
```

to:

```
ncc:02
ncc:05
ncc:07
```

requires publishing a new manifest containing all three capability tags.

The absence of a capability from the latest manifest indicates that the service is no longer advertising that capability through NCC-07.

## 10. Capability Removal

Capability removal occurs by publishing a replacement manifest without the relevant `cap` tag. No separate revocation event is required.

Clients SHOULD treat the latest valid manifest as the current capability assertion. Cached capability information SHOULD NOT override a newer manifest.

## 11. Protocol-Specific Discovery

NCC-07 is a generic capability discovery mechanism. It does not replace more specific discovery mechanisms defined by individual protocols.

Where a protocol defines its own authoritative capability advertisement mechanism, clients SHOULD use that mechanism for protocol-specific decisions. NCC-07 MAY provide additional generic discovery information but SHOULD NOT be used to contradict or override the protocol-specific mechanism.

### 11.1 Nostr Relays and NIP-11

NIP-11 remains the established mechanism by which a Nostr relay advertises relay information, including supported NIPs.

A relay SHOULD NOT use NCC-07 as a replacement for NIP-11. For example, a relay that supports NIP-42 should advertise that support using NIP-11 as required or expected by the relay ecosystem.

The same relay MAY use NCC-07 to advertise capabilities outside the scope of NIP-11. Example:

```
ncc:02
ncc:05
pubkey:<hex>:nostrhost-management
```

### 11.2 Protocols with Existing Capability Events

Some Nostr protocols define dedicated capability or information events. Where such a mechanism exists, it remains authoritative for that protocol.

NCC-07 MAY advertise that the broader protocol is supported, but clients MUST use the protocol-defined mechanism where that mechanism is required to determine specific methods, extensions, parameters, or behaviour.

## 12. No Capability Negotiation

NCC-07 does not define capability negotiation.

If a service advertises:

```
pubkey:<hex>:example-v1
pubkey:<hex>:example-v2
```

NCC-07 does not determine:

- which capability the client should prefer
- whether one supersedes the other
- whether both may be used simultaneously
- whether compatibility exists between them

Those rules belong to the capability specification itself.

## 13. No Capability Parameters

The `cap` tag identifies a capability. NCC-07 deliberately does not define arbitrary capability parameters such as:

```
version
limits
configuration
methods
permissions
pricing
```

A capability requiring structured parameters SHOULD define those parameters in its own specification or use an existing protocol-specific mechanism.

This keeps capability discovery independent from capability implementation.

## 14. Security Considerations

### 14.1 Self-Assertion

A capability manifest is signed by the service identity. This proves only that the holder of the corresponding private key published the assertion.

It does not prove:

- correct implementation
- availability
- security
- interoperability
- conformance
- trustworthiness

Clients SHOULD validate important capabilities during actual protocol interaction.

### 14.2 Malicious Capability Claims

A malicious or compromised service MAY advertise capabilities it does not support. Clients MUST NOT make security-sensitive trust decisions solely from an NCC-07 capability declaration.

Where capability use requires authentication, authorisation, key verification, attestation, or another trust mechanism, the relevant mechanism remains required.

### 14.3 Stale Manifests

Relays may retain obsolete events or return inconsistent results. Clients SHOULD apply standard NIP-01 addressable event resolution semantics and query multiple relays where appropriate.

A cached older manifest SHOULD NOT supersede a newer valid manifest.

### 14.4 Namespace Impersonation

Application-defined capabilities use the controlling pubkey as part of their identifier. A publisher cannot claim ownership of:

```
pubkey:<A>:example
```

merely by advertising it.

Clients that need to retrieve documentation or metadata for an application-defined capability SHOULD treat `<A>` as the capability namespace authority.

## 15. Privacy Considerations

Capability manifests are public by default. Publishing a capability may reveal information about:

- installed software
- enabled features
- infrastructure roles
- optional interfaces
- experimental functionality

Operators SHOULD avoid advertising capabilities that would disclose sensitive configuration or increase unnecessary attack surface.

NCC-07 does not provide private capability discovery. Private capability negotiation or disclosure MAY be defined separately where required.

## 16. Relationship to NCC-02, NCC-05, and NCC-06

NCC-07 is intended to compose naturally with the existing service conventions.

**NCC-02**

NCC-02 identifies the service and establishes service trust information. NCC-07 does not replace NCC-02 identity or trust semantics.

**NCC-05**

NCC-05 provides current service reachability information. NCC-07 does not contain endpoints or locator data.

**NCC-06**

A service using the NCC-02/NCC-05 profile defined by NCC-06 MAY publish an NCC-07 capability manifest. Such a service could advertise:

```
["cap", "ncc:02"]
["cap", "ncc:05"]
["cap", "ncc:06"]
```

This makes participation discoverable without changing NCC-06 resolution behaviour.

## 17. Example: Generic Service

A service supports NCC-02 identity discovery, NCC-05 dynamic location, and an application-defined backup interface.

```json
{
  "kind": 30062,
  "pubkey": "<service-pubkey>",
  "created_at": 1790380000,
  "tags": [
    ["d", "capabilities"],
    ["cap", "ncc:02"],
    ["cap", "ncc:05"],
    ["cap", "pubkey:<capability-author-pubkey>:remote-backup"]
  ],
  "content": ""
}
```

A client that understands `remote-backup` may use its defining specification. A client that does not understand it simply ignores that capability.

## 18. Example: Relay

A Nostr relay uses NIP-11 for normal relay capability discovery. The same relay participates in NCC-based service discovery and publishes:

```json
{
  "kind": 30062,
  "pubkey": "<relay-service-pubkey>",
  "created_at": 1790380000,
  "tags": [
    ["d", "capabilities"],
    ["cap", "ncc:02"],
    ["cap", "ncc:05"],
    ["cap", "ncc:06"]
  ],
  "content": ""
}
```

NIP support remains advertised through NIP-11. The NCC-07 manifest advertises capabilities outside that protocol-specific mechanism.

## 19. Example: Custom Capability Shared Across Services

Pubkey A defines:

```
pubkey:<A>:media-upload
```

Services B, C, and D may independently advertise:

```
["cap", "pubkey:<A>:media-upload"]
```

This indicates that each service claims compatibility with the capability defined by A. No central registration or allocation is required.

## 20. Minimal Conformance

A service conforms to NCC-07 if it:

1. publishes a valid kind `30062` event
2. uses `d=capabilities`
3. includes at least one valid `cap` tag
4. publishes the manifest under the service identity
5. publishes the complete current capability set when replacing the manifest

A client conforms to NCC-07 if it:

1. can resolve the latest valid manifest
2. recognises `cap` tags
3. interprets capability identifiers it supports
4. safely ignores unknown capability identifiers
5. does not treat capability advertisement as proof of implementation

## 21. Why This Is an NCC

NCC-07 does not introduce a new Nostr transport primitive or require relay behaviour changes. It defines a shared application-layer convention for using existing Nostr events to advertise service capabilities.

Relays store and serve capability manifests as ordinary Nostr events. Interpretation remains entirely client-side.

## 22. Design Rationale

The convention deliberately defines only:

```
service identity
      +
signed capability identifiers
```

It does not attempt to become:

- an API description language
- a package manifest
- a service registry
- a negotiation protocol
- an authorisation system
- a conformance framework

Keeping these concerns separate allows independent conventions and protocols to compose without coupling their implementation details to NCC-07.

The core design principle is:

> NCC-07 tells a client what a service claims to support. It does not define, negotiate, verify, or authorise that capability.

## 23. Status

NCC-07 is experimental.

Implementers are encouraged to:

- keep capability identifiers stable
- use existing NIP or NCC identifiers where appropriate
- define custom capabilities under pubkey-controlled namespaces
- avoid duplicating established protocol-specific capability mechanisms
- treat capability declarations as assertions rather than proofs

Unknown capabilities are safely ignorable. If NCC-07 is not implemented, existing Nostr behaviour remains unchanged.
