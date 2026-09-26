# NCC-11: Portable Trust Policy

Status: Draft
Category: Client / Trust Policy
Author(s): lostcause
Supersedes: None

Related NCCs

* NCC-00: Publication, revision, and discovery of NCC documents.
* NCC-02: Pubkey-owned service identity, trust, endpoint binding, attestations, and revocation.
* NCC-05: Identity-bound service locator resolution.
* NCC-06: Service participation profile composing NCC-02 and NCC-05.
* NCC-07: Service capability advertisement.
* NCC-08: Service identity rotation and handover.
* NCC-09: Scoped operator authority.
* NCC-10: Service operational state.

## Abstract

This Nostr Community Convention defines a portable, signed trust-policy format that clients and runtimes may use when evaluating Nostr-identified services.

NCC-11 separates:

```
facts and assertions
        from
consumer trust policy
```

Existing NCCs may state:

* who a service is
* where it can be reached
* what trust material it presents
* who may operate it
* what state it reports

NCC-11 defines how a user or application may express rules for deciding what to accept.

Trust policies are published as addressable events and may contain public or privately encrypted rules.

NCC-11 does not create trust, certify services, enforce policy at relays, or replace the validation rules of other NCCs or NIPs.

## 1. Purpose

Nostr clients can receive the same signed service information while applying different local security decisions.

For example, one client may:

* require transport-key pinning
* accept only specific certifiers
* reject stale locators
* allow onion endpoints
* accept authorised operator-published service state

while another client may apply different rules.

Without a portable policy format, those decisions are typically stored independently inside each application.

NCC-11 addresses the question:

"What trust rules does this identity want supporting clients and runtimes to apply?"

The same policy may then be used across:

* desktop clients
* mobile clients
* browser extensions
* automation systems
* nscript runtimes
* NostrHost installations
* agents
* other supporting applications

## 2. Conceptual Model

NCC-11 separates observed information from decision policy.

```
NCC-02
NCC-05
NCC-07
NCC-09
NCC-10
   |
   | provide facts/assertions
   v
NCC-11
trust policy
   |
   v
client decision
```

For example:

```
NCC-02:
endpoint key = X

NCC-11:
key pinning = require

Observed connection:
endpoint key = Y

Client:
reject
```

The policy does not alter NCC-02.

It tells the consuming client how the user wishes NCC-02 information to be evaluated.

## 3. Design Goals

NCC-11 aims to provide:

* portable trust preferences
* signed policy state
* named policy profiles
* interoperability across clients and runtimes
* extensible policy namespaces
* optional private policy rules
* safe handling of unknown rules
* separation of policy from service assertions
* local client control over final decisions

The convention deliberately avoids becoming a general application-settings format.

## 4. Non-Goals

NCC-11 does not define:

* service identity
* service certification
* reputation scoring
* moderation policy
* content filtering
* social trust graphs
* relay enforcement
* authentication
* authorisation
* operator authority
* service availability
* endpoint discovery
* general application preferences
* legal identity
* mandatory global security policy

NCC-11 also does not override mandatory security requirements defined by another specification.

## 5. Event Definition

### 5.1 Event Kind

Portable trust policies use:

* kind `30067`

Kind `30067` is an addressable event under the NIP-01 addressable-event range.

Trust policy represents mutable current state, so addressable-event replacement semantics are appropriate.

### 5.2 Policy Identifier

The `d` tag identifies a named policy profile.

Examples:

```
["d", "default"]
["d", "strict"]
["d", "travel"]
["d", "automation"]
```

The recommended general-purpose policy identifier is:

```
default
```

Clients MAY support multiple named policies.

NCC-11 does not define how a client chooses which named policy is active.

That remains a local user or application decision.

### 5.3 Required Tags

Every NCC-11 policy MUST contain:

```
["d", "<policy-id>"]
```

A policy MUST contain at least one recognised or extension rule, either:

* publicly in event tags, or
* privately in encrypted `content`

## 6. Policy Rules

A policy rule uses:

```
["rule", "<policy-key>", "<value>"]
```

Example:

```
["rule", "ncc:02:key-pinning", "require"]
```

Policy keys are namespaced.

The general format is:

```
<namespace>:<subject>
```

or:

```
<namespace>:<subject>:<subsubject>
```

NCC-defined policy keys use:

```
ncc:<number>:<name>
```

Application-defined keys SHOULD use:

```
pubkey:<hex-pubkey>:<name>
```

Clients MUST treat unknown policy keys as opaque.

Unknown rules MUST NOT invalidate the policy.

## 7. Rule Ownership

The namespace determines who defines the meaning of a rule.

For example:

```
ncc:05:stale-fallback
```

may only have normative meaning defined by NCC-05 or a convention explicitly extending NCC-05.

Likewise:

```
pubkey:<A>:custom-trust-mode
```

is defined by the controller of pubkey A's namespace.

A policy author cannot redefine another namespace merely by publishing a rule using its identifier.

## 8. Policy Values

Policy values are opaque strings unless defined by the relevant rule specification.

Common policy values SHOULD use simple lowercase values such as:

```
allow
deny
require
prefer
optional
```

Specifications MAY define numeric or structured string values where necessary.

Clients MUST NOT guess the meaning of an unknown value.

## 9. Core NCC-11 Rules

NCC-11 defines a small set of interoperable rules for the current NCC service stack.

These rules are intentionally limited.

### 9.1 NCC-02 Transport-Key Pinning

Policy key:

```
ncc:02:key-pinning
```

Defined values:

```
require
prefer
```

`require`

Where NCC-02 provides transport-key material applicable to the selected endpoint, the client MUST verify it before treating the connection as acceptable under this policy.

A mismatch MUST be rejected.

`prefer`

The client SHOULD verify transport-key material when available.

Absence of pinning material alone does not require rejection unless another applicable rule requires it.

This rule does not weaken any mandatory NCC-02 validation requirement.

## 10. Trusted NCC-02 Certifiers

Trusted certifiers are expressed using:

```
["trust", "certifier", "<pubkey-hex>"]
```

Example:

```
["trust", "certifier", "abcdef012345..."]
```

The presence of this tag means:

"This policy permits this pubkey to be considered as an NCC-02 certifier."

It does not mean:

* every attestation from that certifier must be accepted
* the certifier is globally trustworthy
* services certified by it are automatically trusted

The consuming client MUST still validate the referenced NCC-02 attestation normally.

### 10.1 Attestation Requirement

Policy key:

```
ncc:02:attestation
```

Defined values:

```
require
optional
```

`require`

A service requiring NCC-02 trust evaluation under this policy MUST have at least one currently valid attestation from a trusted certifier.

`optional`

Valid trusted attestations MAY influence client decisions but are not required for acceptance.

## 11. NCC-05 Stale Fallback

Policy key:

```
ncc:05:stale-fallback
```

Defined values:

```
allow
deny
```

`deny`

Expired NCC-05 locator information MUST NOT be used under normal resolution.

`allow`

A client MAY use previously valid locator information when no fresh valid locator can be obtained, subject to any maximum stale age.

### 11.1 Maximum Stale Age

Policy key:

```
ncc:05:max-stale-age
```

The value is an integer number of seconds.

Example:

```
["rule", "ncc:05:max-stale-age", "3600"]
```

This means a stale NCC-05 locator may be used for no more than 3600 seconds beyond its normal expiry, where stale fallback is otherwise permitted.

A value of:

```
0
```

means no stale fallback is permitted.

If both rules are present and conflict:

```
ncc:05:stale-fallback = deny
```

takes precedence.

## 12. Transport Policy

NCC-11 defines transport policy using:

```
ncc:05:transport:<scheme>
```

with values:

```
allow
deny
```

Examples:

```
["rule", "ncc:05:transport:https", "allow"]
["rule", "ncc:05:transport:wss", "allow"]
["rule", "ncc:05:transport:onion", "allow"]
["rule", "ncc:05:transport:http", "deny"]
```

Transport identifiers are interpreted according to the applicable service and NCC-05 endpoint semantics.

A client MUST NOT infer permission for an unlisted transport from the presence of unrelated transport rules.

If the client has local security requirements stricter than the published policy, it MAY apply the stricter local policy.

## 13. NCC-09 Operator Actions

Policy key:

```
ncc:09:operator-actions
```

Defined values:

```
allow
deny
```

`allow`

The client MAY recognise actions validly authorised through NCC-09 where the underlying specification explicitly supports NCC-09 operators.

`deny`

The client SHOULD require direct principal-signed behaviour instead of relying on NCC-09 operator authority where such direct behaviour is available.

This rule does not invalidate NCC-09 grants themselves.

It governs whether this consumer chooses to rely on them.

## 14. NCC-10 Operator-Published State

Policy key:

```
ncc:10:operator-state
```

Defined values:

```
allow
deny
```

`allow`

The client MAY use NCC-09-authorised operator-published NCC-10 state when no suitable direct service state is available.

`deny`

The client MUST NOT use operator-published NCC-10 state as authoritative service state.

Direct service-signed NCC-10 state remains unaffected.

## 15. Example Public Policy

```json
{
  "kind": 30067,
  "pubkey": "<policy-owner-pubkey>",
  "created_at": 1790380000,
  "tags": [
    ["d", "default"],
    ["rule", "ncc:02:key-pinning", "require"],
    ["rule", "ncc:02:attestation", "require"],
    ["trust", "certifier", "<certifier-A>"],
    ["trust", "certifier", "<certifier-B>"],
    ["rule", "ncc:05:stale-fallback", "allow"],
    ["rule", "ncc:05:max-stale-age", "3600"],
    ["rule", "ncc:05:transport:https", "allow"],
    ["rule", "ncc:05:transport:wss", "allow"],
    ["rule", "ncc:05:transport:onion", "allow"],
    ["rule", "ncc:05:transport:http", "deny"],
    ["rule", "ncc:09:operator-actions", "allow"],
    ["rule", "ncc:10:operator-state", "allow"]
  ],
  "content": ""
}
```

## 16. Private Policy Rules

Trust policy may reveal sensitive information about:

* trusted entities
* blocked infrastructure
* security requirements
* transport preferences
* operational relationships

NCC-11 therefore supports private policy entries.

Private rules are stored in the event `content` as a JSON array containing tag-shaped arrays, encrypted using NIP-44 to the policy author's own pubkey.

This follows the general private-list pattern used by NIP-51.

Before encryption:

```json
[
  ["trust", "certifier", "<certifier-A>"],
  ["rule", "ncc:05:transport:onion", "allow"],
  ["rule", "ncc:09:operator-actions", "deny"]
]
```

The JSON array is then stringified and encrypted using NIP-44 with the policy author as both policy owner and intended decrypting identity.

Clients supporting private NCC-11 policy MUST decrypt the content before interpreting those rules.

## 17. Mixed Public and Private Policy

A policy MAY contain both:

* public rules in `tags`
* private rules in encrypted `content`

For example:

```
public:
  require key pinning

private:
  trusted certifier list
```

Clients combine both sets after successful decryption.

If the same policy key appears in both public and private portions, the private rule SHOULD take precedence for the policy owner.

Clients unable to decrypt private content may still apply public rules but MUST NOT assume those public rules represent the complete policy.

## 18. Policy Replacement

A new NCC-11 event replaces the previous event for the same:

```
kind + pubkey + d
```

Example:

```
30067:<user-pubkey>:default
```

The current valid addressable event contains the complete current policy for that profile.

Rules MUST NOT be implicitly inherited from older versions.

## 19. Named Policies

An identity MAY maintain multiple policies.

For example:

```
default
strict
automation
public-wifi
```

These represent separate addressable events.

NCC-11 does not define:

* automatic profile switching
* location-based switching
* application-specific activation
* policy inheritance
* profile priority

The client or user chooses which policy to apply.

This keeps policy storage portable without making NCC-11 an application configuration system.

## 20. No Policy Inheritance

One NCC-11 policy MUST NOT implicitly inherit another.

For example:

```
strict extends default
```

is not defined by NCC-11.

A policy event represents a complete standalone policy profile.

This avoids ambiguous policy resolution across clients.

## 21. Missing Rules

Absence of a policy rule does not mean:

```
allow
```

and does not mean:

```
deny
```

It means:

NCC-11 expresses no preference for this rule.

The consuming client then applies:

* the relevant protocol requirement
* its local default
* user interaction
* another applicable local policy

as appropriate.

## 22. Mandatory Protocol Requirements

NCC-11 policy cannot weaken mandatory validation or security requirements defined by another specification.

For example, if another specification requires signature validation, this policy:

```
["rule", "example:signature-check", "deny"]
```

cannot make invalid signatures acceptable.

The order of authority is:

```
mandatory protocol requirement
        |
        v
NCC-11 policy preference
        |
        v
client local policy
```

A client MAY always apply a stricter local security rule.

## 23. Policy Conflicts

A single policy SHOULD NOT contain contradictory rules for the same policy key.

If multiple public rules for the same key conflict, clients SHOULD treat that key as unresolved rather than selecting one by tag order.

Where a private rule and public rule conflict, the successfully decrypted private rule takes precedence for the policy owner.

Rules from unrelated namespaces MUST NOT be merged merely because they appear semantically similar.

## 24. Unknown Rules

Clients MUST safely ignore policy keys they do not understand.

For example:

```
["rule", "ncc:27:future-behaviour", "require"]
```

MUST NOT cause the entire policy to fail on a client that does not support NCC-27.

This allows policies to evolve independently of client versions.

## 25. Relationship to NIP-51

NIP-51 defines interoperable lists of references and includes a pattern for storing public list items in tags and private items as NIP-44-encrypted tag arrays in `content`.

NCC-11 adopts the same general public/private representation pattern.

It does not create new NIP-51 list kinds.

Where an existing NIP-51 list already represents a concept correctly, NCC-11 SHOULD reference or coexist with that mechanism rather than duplicate it.

For example, NCC-11 does not redefine NIP-51 blocked-relay lists.

## 26. Relationship to NIP-78

NIP-78 defines arbitrary application-specific storage for data that does not require interoperability.

It explicitly states that data intended for interchange between applications should use dedicated kinds instead.

NCC-11 therefore uses its own event kind rather than `30078`.

A client MAY store purely local UI or application settings in NIP-78, but interoperable trust policy belongs in NCC-11.

## 27. Relationship to NCC-02

NCC-02 provides service trust material and optional attestations.

NCC-11 defines consumer policy for evaluating some of those signals.

For example:

```
NCC-02:
certifier C attests service S

NCC-11:
C is trusted
attestation is required

Client:
validate C's attestation
```

NCC-11 does not make C trustworthy for any user who has not chosen such a policy.

## 28. Relationship to NCC-05

NCC-05 defines service endpoint resolution, freshness, and optional stale fallback behaviour.

NCC-11 may narrow a client's permitted fallback and transport behaviour.

It does not alter the locator itself.

## 29. Relationship to NCC-09

NCC-09 defines whether an operator has authority from a principal.

NCC-11 defines whether a particular consumer chooses to rely on operator-authorised actions.

Therefore:

```
NCC-09
"is B authorised by A?"

NCC-11
"will this client rely on that authority?"
```

These are independent questions.

## 30. Relationship to NCC-10

NCC-10 gives direct service state priority over operator-published state and allows authorised operator state when appropriate.

NCC-11 may further restrict that consumer behaviour with:

```
ncc:10:operator-state
```

NCC-11 cannot make an invalid or unauthorised NCC-10 event valid.

## 31. Client Evaluation

A client applying NCC-11 SHOULD:

1. identify the policy owner
2. determine the locally selected policy identifier
3. retrieve kind `30067` for that pubkey and `d`
4. verify the policy signature
5. resolve the current addressable event
6. read public rules
7. decrypt private policy content where possible
8. combine public and private rules according to Section 17
9. ignore unknown rule keys
10. apply recognised policy rules when evaluating relevant service data
11. continue enforcing mandatory underlying protocol requirements
12. apply stricter local security policy where necessary

## 32. Runtime and Automation Use

NCC-11 is intended to be usable by non-interactive systems as well as conventional clients.

For example, an nscript runtime may evaluate:

```
resolve service
      |
      v
retrieve NCC facts
      |
      v
apply NCC-11 policy
      |
      v
allow / reject / request intervention
```

This allows scripts and agents to reuse the same trust rules as other applications instead of embedding independent trust decisions in each script.

NCC-11 does not require automation runtimes to operate without user confirmation.

## 33. Security Considerations

### 33.1 Policy Key Compromise

An attacker controlling the policy owner's private key may publish a weaker or malicious trust policy.

NCC-11 cannot protect against compromise of the policy identity.

### 33.2 Policy Downgrade

Clients SHOULD be cautious when a newly observed policy materially weakens previously applied security requirements.

Applications MAY warn the user or require confirmation before adopting a significantly weaker policy.

NCC-11 does not define a universal downgrade-detection algorithm.

### 33.3 Private Policy Leakage

Public policy tags are visible to relays and observers.

Sensitive rules SHOULD be stored in encrypted `content`.

Encryption does not hide:

* the existence of the NCC-11 event
* the author's pubkey
* event timing
* public tags

### 33.4 Malicious Rules

A signed policy proves only that the policy owner published it.

Clients MUST NOT execute arbitrary code or unsafe behaviour merely because a policy contains an unknown rule.

Unknown rules are data, not executable instructions.

### 33.5 Weak Policy

NCC-11 permits users to express preferences that may be less strict than a client's own security baseline.

Clients MAY refuse to weaken mandatory or locally enforced protections.

## 34. Privacy Considerations

Trust policy can reveal significant information about user behaviour.

Potentially sensitive information includes:

* trusted certifiers
* accepted transports
* infrastructure preferences
* operator relationships
* security posture

Policy authors SHOULD consider which rules need to be public.

Clients SHOULD make the distinction between public and private policy clear to users.

## 35. Minimal Conformance

A policy publisher conforms to NCC-11 if it:

1. publishes a valid kind `30067` event
2. includes a `d` policy identifier
3. uses valid `rule` or defined trust tags
4. signs the event using the policy-owner identity
5. encrypts private policy content using the defined NIP-44 format when private rules are used

A client conforms to NCC-11 if it:

1. resolves the current policy event
2. verifies its signature
3. recognises supported NCC-11 rules
4. safely ignores unknown rules
5. does not weaken mandatory protocol requirements
6. distinguishes absence of policy from explicit allow or deny
7. supports public policy rules

Support for private encrypted policy is RECOMMENDED but not required for minimal read-only conformance.

## 36. Why This Is an NCC

NCC-11 introduces no new cryptographic primitive, transport behaviour, or relay enforcement requirement.

It defines a shared application-layer policy format using existing Nostr events.

Relays do not need to:

* interpret trust policy
* evaluate services
* enforce transport choices
* validate certifiers
* decide whether operators are acceptable

The final decision remains with the client or runtime applying the policy.

## 37. Design Rationale

The existing NCC service stack intentionally separates independent concerns:

```
NCC-02  identity and trust material
NCC-05  location
NCC-07  capability
NCC-08  identity continuity
NCC-09  authority
NCC-10  operational state
```

NCC-11 adds the missing consumer-side layer:

```
NCC-11  policy
```

This preserves an important architectural distinction:

```
what the network says
        !=
what the consumer accepts
```

The rule namespace is deliberately extensible so future NCCs and applications may define their own policy controls without expanding NCC-11 into a catalogue of every possible trust decision.

Named policies are independent rather than inherited to ensure deterministic behaviour across clients.

The core design principle is:

NCC-11 describes how a consumer wants trust signals evaluated. It does not create those signals or make them true.

## 38. Status

NCC-11 is experimental.

Implementers are encouraged to:

* keep policies small
* use explicit rule namespaces
* store sensitive rules privately
* avoid using NCC-11 for unrelated application settings
* prefer existing NIPs where they already represent a concept
* treat missing rules as unspecified
* preserve mandatory underlying security requirements
* allow users to inspect the effective policy applied by a client

If NCC-11 is not implemented, clients continue using their existing local trust policy.
