# Publishing Nostr Community Conventions on Nostr

## Summary

This convention defines how **Nostr Community Conventions (NCCs)** are published, discovered, revised, and evolved **using Nostr itself**.

NCC-00 establishes Nostr as the primary medium for documenting and coordinating community conventions that describe ecosystem and client behaviour, without altering the Nostr protocol.

---

## Purpose

Nostr Community Conventions exist to document **shared usage patterns** of existing Nostr primitives where protocol-level standardisation is unnecessary or undesirable.

NCCs aim to:

- Improve interoperability between clients
- Reduce duplicated design work
- Make emerging norms visible and copyable
- Allow decentralised evolution without gatekeeping

---

## Scope

NCCs MAY describe:

- Event usage patterns
- Kind selection semantics
- Tag conventions
- Content lifecycle and revision models
- Client behaviour expectations
- Social or coordination norms

NCCs DO NOT define:

- Relay enforcement rules
- Cryptography, signing, or transport
- Mandatory behaviour
- Protocol-level requirements

---

## Relationship to NIPs

- **NIPs** define protocol and wire behaviour.
- **NCCs** define convention and ecosystem behaviour.

NCCs are:

- Optional
- Backwards-compatible
- Non-enforcing
- Composable

An NCC may inform a future NIP, but this is neither required nor implied.

---

## Publication Model

NCCs are published directly on Nostr as long-form, parameterised replaceable events.

There is:

- No central registry
- No approval process
- No authoritative host

Discovery, relevance, and authority emerge through usage.

---

## Relay Support and Publishing Guidance

NCCs rely only on existing Nostr relay behaviour.  
No relay changes are required to support NCC events.

### Relay Capability Signalling

Relays may advertise supported features and limitations via their NIP-11 relay information document.

Clients and tools MAY:

- Inspect NIP-11 metadata before publishing NCC events
- Warn users if a relay advertises size limits or restricted capabilities
- Treat missing or incomplete relay metadata as non-fatal

Lack of explicit relay signalling does not imply incompatibility.

### Relay Selection for NCC Events

Clients and tools SHOULD:

- Publish NCC-related events to the author’s configured write relays
- Prefer relays listed in the author’s NIP-65 relay list metadata when available
- Use multiple write relays to improve availability

Relay rejection of NCC events SHOULD be treated as an operational condition, not a protocol error.

### Relay Behaviour Expectations

Relays are not expected to:

- Validate NCC semantics
- Enforce NCC authority
- Distinguish NCC events from other long-form content

Relays store and forward NCC events as opaque data, consistent with Nostr norms.

### Design Rationale

This approach:

- Preserves relay neutrality
- Avoids special-case infrastructure
- Aligns with existing relay discovery and publishing practices
- Keeps NCC adoption client-driven rather than relay-driven

---

## Numbering and Authority

There is no central authority responsible for assigning NCC numbers.

For any NCC identifier (for example `ncc-01`):

- The **earliest published NCC event by timestamp** establishes the identifier
- That author is considered the **initial steward**

Numbers reflect publication order, not permission.

---

## Supersession and Succession

NCC evolution occurs through two distinct mechanisms.

### Supersession (proposal)

Any author MAY publish an NCC that declares it supersedes an existing NCC.

- Supersession represents a proposed improvement or alternative
- It does not transfer authority by itself
- Superseding NCCs compete through adoption

Supersession is expressed using a `supersedes` tag.

---

### Succession (steward acknowledgement)

Succession is the explicit transfer of stewardship from the current steward to a superseding NCC.

- A succession event is authored by the current steward
- It references the superseding NCC
- It signals recognition, not enforcement

Succession provides a clear, signed record of handover.

---

### Succession is declarative, not mandatory

Succession cannot be forced.  
However, authority in practice may still shift through community adoption.

Succession events:

- Improve clarity
- Reduce ambiguity
- Are not required for progress

If the network moves on, the network moves on.

---

## Authority in Practice

Authority over an NCC identifier emerges from a combination of:

- First publication timestamp
- Signed authorship
- Client support
- Community adoption

Clients SHOULD:

- Prefer NCCs referenced by a valid succession event when one exists
- Otherwise allow de-facto authority based on trust and adoption signals
- Avoid treating succession as a hard requirement

---

## Governance Model

NCCs are maintained through:

- Open publication
- Signed authorship
- Public discussion
- Adoption by clients

There is no central authority.  
Forking is valid and expected.

---

## Design Principles

- Minimalism over abstraction
- Behaviour over theory
- Interoperability over purity
- Evolution through practice

If a convention is useful, it will be adopted.

---

## Status

NCCs are community conventions.  
They are living documents, not standards.

---

## Recommended Convention Structure (Non-Normative)

NCCs are intentionally lightweight and flexible.  
There is no mandatory template for authoring a convention.

However, authors are encouraged to follow a broadly consistent structure to improve clarity, comparability, and client implementability.

A typical NCC document may include:

- **Title and status**
  - For example: Informal, Draft, In Use
- **Scope**
  - What the convention applies to, and what it does not
- **Standards or NIPs referenced**
  - Explicitly list any existing NIPs relied upon
- **Overview**
  - A short description of the problem and intent
- **Design principles**
  - Constraints or values guiding the convention
- **Core approach**
  - The behavioural or structural model being proposed
- **Event schema**
  - Required and optional fields or tags
- **Examples**
  - Representative event examples where useful
- **Client behaviour guidance**
  - Expected handling by supporting clients
- **Privacy and security considerations**
  - What metadata remains visible and what does not
- **Non-goals**
  - Explicit exclusions to prevent scope creep
- **FAQ or rationale**
  - Optional clarifications for common questions
- **Status and next steps**
  - Adoption expectations and future formalisation notes

This structure is illustrative only.  
Authors may omit, reorder, or adapt sections as appropriate.

Conventions that are clear, scoped, and ignorable by default are preferred over exhaustive or prescriptive specifications.

---

## Appendix A – Event Definitions (Normative)

### Reserved kinds

- **NCC Document:** `kind:30050`
- **NCC Succession Record:** `kind:30051`
- **NCC Endorsement Record:** `kind:30052`
- **NCC Supporting Document:** `kind:30053`

These kinds are reserved by convention for NCC use and may be reassigned if conflicts emerge.

---

### A.1 NCC Document Event (`kind:30050`)

#### Required tags

- `["d","ncc-XX"]`
- `["title","<title>"]`
- `["published_at","<unix-seconds>"]`
- `["status","<status>"]`

#### Optional tags

- `["summary","<text>"]`
- `["t","<topic>"]` (repeatable)
- `["lang","<bcp47>"]`
- `["version","<string>"]`
- `["supersedes","ncc-YY"]` (repeatable)
- `["license","<identifier-or-url>"]`
- `["authors","<npub-or-pubkey>"]` (repeatable, editorial credit only)

#### Content

- MUST be human-readable Markdown
- MUST contain the full convention text

#### Replaceable semantics

For a given author pubkey and `d`, later events replace earlier ones.

---

### A.2 NCC Succession Record (`kind:30051`)

#### Required tags

- `["d","ncc-XX"]`
- `["authoritative","event:<event_id>"]`

#### Optional tags

- `["steward","pubkey:<hex>"]` or `["steward","npub:<bech32>"]`
- `["previous","event:<event_id>"]`
- `["reason","<short-text>"]`
- `["effective_at","<unix-seconds>"]`

#### Content

- SHOULD be short and plain language
- Describes the handover intent

Succession records are coordination signals, not enforcement mechanisms.

---

### A.3 NCC Endorsement Record (`kind:30052`)

#### Required tags

- `["d","ncc-XX"]`
- `["endorses","event:<event_id>"]`
- `["status","<status>"]`

Endorsements are adoption signals only and confer no authority.

---

### A.4 NCC Supporting Document (`kind:30053`)

Supporting Document Events (SDEs) are specified in Appendix E.

---

### A.5 Status Values

The status tag MUST be one of the following lowercase values:

- `draft`
- `published`
- `superseded`
- `withdrawn`

---

## Appendix B – Client Resolution Guidance (Non-Normative)

1. Identify origin NCC by earliest timestamp.
2. If a recognised succession record exists, follow it.
3. Otherwise allow de-facto authority based on adoption and trust.
4. Label authority clearly:
   - “Steward-acknowledged”
   - “De-facto (adopted)”

---

## Appendix C – State Model (Non-Normative)

This appendix describes a practical mental model for how NCC identifiers evolve over time. It is guidance only.

### States

```text
NCC-ID (e.g. ncc-01)

[ORIGIN]
  Earliest published NCC for d=ncc-01 establishes the identifier and initial steward (npub).

      |
      | anyone publishes a superseding NCC (proposal)
      v

[PROPOSED]
  One or more superseding NCCs exist (alternative candidates).

      |                               | steward publishes         \ community adoption
      | succession record          \ (clients/users choose)
      v                             v

[STEWARD-ACKNOWLEDGED]          [DE-FACTO]
  Current steward explicitly     A superseding NCC becomes
  recognises a new authoritative dominant through adoption,
  NCC document.                  even without succession.

      \                         /
       \ further succession     / continued adoption shift
        \ or adoption shift    /
         v
[CURRENT]
  The NCC document treated as authoritative at this time.
```

### Interpretation

- **Supersession** is permissionless and produces candidates.
- **Succession** is a signed coordination record produced by the current steward.
- **De-facto adoption** may still select a current document without succession.
- Clients should label outcomes clearly so users can distinguish:
  - Steward-acknowledged authority
  - De-facto (adopted) authority

### Implementation note

Clients should avoid treating any single signal as absolute. Where succession is absent, clients should default to user trust signals (follows, curated lists) and visible adoption indicators.

---

## Appendix D – Endorsement Signals (Non-Normative)

This appendix defines an optional, explicit signal for expressing support, adoption, or implementation of an NCC.

Endorsement events make **community adoption legible**, without creating authority, approval, or enforcement.

---

## Purpose

Endorsement events allow authors, client developers, and users to publicly state support for a specific NCC document.

They are intended to:

- Make adoption visible and queryable
- Distinguish interest from implementation
- Support de-facto authority resolution when succession is absent
- Improve transparency around ecosystem behaviour

Endorsement does **not** imply authority, approval, or correctness.

---

## Event Kind

- **NCC Endorsement Record:** `kind:30052`

This kind is reserved by convention for NCC endorsement signalling and may be reassigned if conflicts emerge.

---

## Required Tags

- `["d","ncc-XX"]`
  - The NCC identifier being endorsed.
- `["endorses","event:<event_id>"]`
  - References the specific NCC document event (kind:30050) being endorsed.

Endorsements SHOULD reference a concrete NCC document, not just an identifier.

---

## Optional Tags

- `["role","author"]`
- `["role","client"]`
- `["role","user"]`
  - Indicates the perspective of the endorser.
- `["implementation","<client-name-or-url>"]`
  - Indicates an implementation or planned implementation.
- `["note","<short-text>"]`
  - Brief rationale or context.
- `["t","<topic>"]` (repeatable)

These tags are informational only and carry no inherent weight.

---

## Content

- Content SHOULD be short and human-readable.
- Examples:
  - “Implemented in Client X”
  - “Endorsed for personal journaling use”
  - “Using this convention internally”

Clients MAY ignore content entirely.

---

## Semantics

An endorsement event represents a **signed statement of support**.

It:

- Does not supersede any NCC
- Does not establish stewardship
- Does not override succession
- Does not bind other clients or users

Multiple endorsements may coexist, including endorsements of competing NCCs.

---

## Client Guidance

Clients MAY:

- Surface endorsement counts or summaries
- Weight endorsements using local trust graphs
- Distinguish endorsements by role (author, client, user)
- Use endorsements as adoption signals in de-facto authority resolution

Clients MUST NOT:

- Treat endorsements as approval or certification
- Require endorsements for visibility or usage
- Block or suppress unendorsed NCCs

Endorsements are signals, not votes.

---

## Interaction with Succession and Adoption

- Succession records remain the clearest signal of steward acknowledgement.
- Endorsements provide evidence of adoption when succession is absent or contested.
- High adoption via endorsements MAY inform de-facto authority, but does not mandate it.

Endorsements improve clarity; they do not confer control.

---

## Design Rationale

This approach:

- Avoids introducing governance or voting systems
- Leverages existing Nostr trust and follow graphs
- Makes ecosystem behaviour observable
- Preserves permissionless participation

If endorsements are ignored, nothing breaks.

---

## Status

Endorsement signalling is optional and experimental.

Clients and users are encouraged to treat endorsements as **context**, not authority.

---

## Appendix E – Supporting Document Events (Non-Normative)

This appendix defines an optional event type for publishing supporting material related to an NCC, without expanding or revising the NCC itself.

Supporting documents include guides, implementation notes, FAQs, migration notes, examples, and rationale documents.

---

## Purpose

Supporting Document Events (SDEs) allow additional material to be published alongside an NCC while keeping the NCC document focused, stable, and concise.

They are intended to:

- Provide practical guidance for implementers
- Document client-specific behaviour or examples
- Capture rationale, trade-offs, or migration notes
- Allow iterative documentation without revising the NCC

Supporting documents are informational only and carry no authority.

---

## Event Kind

- **NCC Supporting Document:** `kind:30053`

This kind is reserved by convention for NCC-related supporting documentation and may be reassigned if conflicts emerge.

---

## Required Tags

- `["d","<doc-id>"]`
- `["for","ncc-XX"]`
- `["title","<title>"]`
- `["published_at","<unix-seconds>"]`
- `["status","<status>"]`

---

## Optional Tags

- `["for_event","event:<event_id>"]`
  - Pins the document to a specific NCC document revision.
- `["type","guide"|"implementation"|"faq"|"migration"|"examples"|"rationale"]`
- `["lang","<bcp47>"]`
- `["t","<topic>"]` (repeatable)
- `["authors","<npub-or-pubkey>"]` (editorial credit only)
- `["license","<identifier-or-url>"]`

---

## Content

- Content SHOULD be human-readable Markdown.
- Content SHOULD clearly state its intended audience (authors, clients, users).
- Content MAY reference external resources.

---

## Semantics

Supporting Document Events:

- Do not supersede NCCs
- Do not establish authority or stewardship
- Do not affect succession or endorsement
- May exist in multiple, competing forms

If SDEs are ignored, nothing breaks.

---

## Example Supporting Document Event (Simplified)

```json
{
  "kind": 30053,
  "pubkey": "<author-pubkey>",
  "created_at": 1766012345,
  "tags": [
    ["d", "journal-client-guide"],
    ["for", "ncc-01"],
    ["title", "Client Implementation Guide for Personal Journals"],
    ["type", "implementation"],
    ["published_at", "1766012345"],
    ["lang", "en"],
    ["t", "journaling"],
    ["t", "encryption"]
  ],
  "content": "# Client Implementation Guide\n\nThis document describes how a client may implement NCC-01 personal journals, including encryption, storage, and UI considerations."
}
```

---

## Design Rationale

This approach:

- Keeps NCC documents concise
- Encourages practical documentation
- Avoids authority creep
- Preserves permissionless experimentation

Supporting documents add context, not control.

---
