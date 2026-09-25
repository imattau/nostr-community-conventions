# NCC-09: Scoped Operator Authority

**Status:** Draft  
**Category:** Identity / Authority  
**Author(s):** lostcause  
**Supersedes:** None

**Related NCCs**

- NCC-00: Publication, revision, and discovery of NCC documents.
- NCC-02: Pubkey-owned service identity, trust, endpoint binding, attestations, and revocation.
- NCC-05: Identity-bound service locator resolution.
- NCC-06: Service participation profile composing NCC-02 and NCC-05.
- NCC-07: Service capability advertisement.
- NCC-08: Service identity rotation and handover.

## Abstract

This Nostr Community Convention defines a minimal method for a Nostr-identified service to authorise another pubkey to perform explicitly scoped actions for that service.

An authority grant is a signed addressable event published by the service identity. It identifies:

- the authorised operator
- the service to which the authority applies
- one or more permitted scopes
- optional validity limits

The operator remains a distinct Nostr identity and signs its own events.

NCC-09 does not allow the operator to impersonate the service identity, does not delegate the service private key, and does not alter the authorship of operator-signed events.

A protocol, NIP, NCC, or application MUST explicitly define how an NCC-09 scope applies to its actions before that scope can authorise behaviour under that specification.

## 1. Purpose

Nostr services increasingly rely on automation, sidecars, deployment systems, agents, and other components that require limited operational authority.

Giving those systems control of the service identity private key creates unnecessary risk.

NCC-09 addresses the question:

> "Has service identity A authorised pubkey B to perform action X for service S?"

For example, a service may wish to allow:

- a sidecar to update service location
- a deployment key to publish site content
- a monitoring agent to publish operational status
- a CI system to publish release information
- an automation agent to perform a defined maintenance action

without giving those systems control of the service identity itself.

## 2. Design Goals

NCC-09 aims to provide:

- scoped rather than unrestricted authority
- explicit service-bound grants
- independently signed operator actions
- replaceable current authority state
- simple authority expiry and revocation
- support for automated systems and agents
- extensible scope identifiers without a central registry
- compatibility with existing Nostr identities
- no delegated-signature semantics

The convention deliberately separates:

```
identity
authority
action
```

into independent signed statements.

## 3. Non-Goals

NCC-09 does not define:

- delegated event signing
- remote signing
- private-key sharing
- identity transfer
- service identity rotation
- authentication protocols
- capability discovery
- access-control enforcement by relays
- service-specific operations
- arbitrary impersonation
- legal authority
- employment or organisational roles
- automatic inheritance of authority
- recovery from key compromise

Those concerns belong to the relevant NIP, NCC, application, or operational policy.

## 4. Conceptual Model

NCC-09 defines three roles:

```
Principal
   |
   | grants scope
   v
Operator
   |
   | performs action
   v
Operator-signed event
```

The principal is the service identity granting authority.

The operator is the pubkey receiving authority.

The scope defines what the principal claims the operator may do.

For example:

```
Service A
   |
   | authorises
   v
Operator B

scope:
  example:status-publish
```

B remains B.

B does not become A and does not sign events as A.

## 5. Service Scope

Authority MUST apply to a specific service identifier.

When used with NCC-02, the service identifier SHOULD be the same value used by the relevant NCC-02 Service Record `d` tag.

Examples:

```
relay
media
wallet
nsite
api
```

Authority granted for one service MUST NOT automatically apply to another service controlled by the same pubkey.

For example:

```
A controls:
  relay
  nsite

B authorised for:
  relay

B is NOT thereby authorised for:
  nsite
```

## 6. Authority Grant Event

### 6.1 Event Kind

Authority grants use:

- kind `30064`

Kind `30064` is an addressable event under the NIP-01 addressable event range.

Authority is current state rather than immutable history, so addressable-event replacement semantics are appropriate.

### 6.2 Address Identifier

The `d` tag MUST uniquely identify the combination of:

- service
- operator

The recommended format is:

```
<service-id>:<operator-pubkey-hex>
```

Example:

```
relay:abcdef012345...
```

This allows a principal to maintain independent authority state for different operators and services.

### 6.3 Required Tags

An authority grant MUST contain:

```
["d", "<service-id>:<operator-pubkey-hex>"]
["service", "<service-id>"]
["p", "<operator-pubkey-hex>"]
["status", "active"]
```

An active grant MUST contain at least one:

```
["scope", "<scope-identifier>"]
```

There MUST be exactly one operator `p` tag.

### 6.4 Optional Tags

An authority grant MAY contain:

```
["expiration", "<unix-seconds>"]
["valid_from", "<unix-seconds>"]
["note", "<short-text>"]
```

`expiration`

Specifies when the grant ceases to be valid.

Clients MUST treat the grant as invalid when:

```
now > expiration
```

The tag may also be interpreted according to NIP-40 by supporting relays, but NCC-09 clients MUST enforce authority expiry independently of relay behaviour.

`valid_from`

Specifies a future time at which the grant becomes valid.

If omitted, authority begins at the event's `created_at`.

`note`

Provides optional human-readable context.

Clients MUST NOT depend on `note` for authority validation.

## 7. Example Authority Grant

```json
{
  "kind": 30064,
  "pubkey": "<service-pubkey>",
  "created_at": 1790380000,
  "tags": [
    ["d", "relay:<operator-pubkey>"],
    ["service", "relay"],
    ["p", "<operator-pubkey>"],
    ["status", "active"],
    ["scope", "ncc:10:publish"],
    ["scope", "pubkey:<scope-author>:maintenance-report"],
    ["expiration", "1792972000"]
  ],
  "content": ""
}
```

This states that the service identity authorises the named operator for the listed scopes until the stated expiration time.

The exact meaning of each scope is defined by the specification that owns that scope.

## 8. Scope Identifiers

A scope identifies an action or class of actions that may be authorised.

Scope identifiers MUST be treated as opaque strings unless their defining specification is understood.

Scope identifiers SHOULD be lowercase.

NCC-09 defines two namespace forms.

### 8.1 NCC Scope Identifiers

An NCC MAY define an operator-authority scope using:

```
ncc:<number>:<action>
```

For example:

```
ncc:10:publish
```

This identifier is valid only if the referenced NCC explicitly defines the meaning and validation rules for that action.

The existence of the identifier alone does not modify another NCC.

### 8.2 Pubkey-Namespace Scope Identifiers

Application-specific scopes SHOULD use:

```
pubkey:<hex-pubkey>:<scope-name>
```

Examples:

```
pubkey:<hex>:site-publish
pubkey:<hex>:backup-run
pubkey:<hex>:maintenance-report
```

The pubkey identifies the namespace authority responsible for defining the scope.

No central scope registry is required.

## 9. Scope Ownership

A service publishing an authority grant does not automatically control the meaning of every scope it lists.

For example:

```
["scope", "ncc:10:publish"]
```

references a scope defined by NCC-10.

The service publisher cannot redefine that scope.

Likewise:

```
["scope", "pubkey:<A>:site-publish"]
```

refers to a scope whose meaning is controlled by pubkey A.

NCC-09 defines the authority container, not the semantics of every authorised action.

## 10. Explicit Opt-In by Other Specifications

NCC-09 MUST NOT retroactively weaken or replace signature requirements defined by another specification.

A NIP, NCC, protocol, or application MUST explicitly define:

1. that NCC-09 operators are permitted for a particular action
2. which NCC-09 scope authorises that action
3. how the principal service is identified in the operator-signed event
4. any additional validation requirements

For example, the existence of:

```
["scope", "ncc:05:publish"]
```

does not by itself permit an operator to publish an NCC-05 locator if NCC-05 requires the service identity itself to sign that locator.

NCC-05 would first need to define support for NCC-09 operator publication.

This rule preserves the security assumptions of existing specifications.

## 11. Operator Event Attribution

Where a specification supports NCC-09 operators, the operator MUST sign the action using the operator's own key.

The resulting event author remains the operator.

The integrating specification MUST define a method for identifying the principal service.

A recommended form, where compatible with that event type, is:

```
["operator_for", "<service-pubkey-hex>", "<service-id>"]
```

Example:

```json
{
  "pubkey": "<operator-pubkey>",
  "tags": [
    ["operator_for", "<service-pubkey>", "relay"]
  ]
}
```

The `operator_for` tag does not grant authority.

It only identifies the principal under which the operator claims to act.

Clients MUST independently resolve and validate the corresponding NCC-09 authority grant.

## 12. Authority Validation

When processing an operator-signed action, a supporting client SHOULD:

1. verify the operator-signed event normally
2. identify the claimed principal service
3. identify the required NCC-09 scope from the action's defining specification
4. retrieve kind `30064` authority state from the principal
5. locate the grant for:
   - the relevant service
   - the operator pubkey
6. verify the authority event signature
7. apply normal NIP-01 addressable-event replacement semantics
8. verify `status=active`
9. verify the required scope is present
10. verify the grant is currently within its validity period
11. apply any additional rules from the action's defining specification

If any required validation fails, the client MUST NOT treat the action as authorised under NCC-09.

## 13. Grant Validity

An authority grant is valid only if:

- the event signature is valid
- it is the current addressable event for its `kind + pubkey + d`
- `status` is `active`
- the operator matches the `p` tag
- the service matches the requested service
- the required scope is present
- the current time is not before `valid_from`, if present
- the current time is not after `expiration`, if present

Unknown scopes MUST NOT invalidate an otherwise valid grant.

They simply provide no recognised authority to clients that do not understand them.

## 14. Updating Authority

The principal updates authority by publishing a new kind `30064` event using the same `d` value.

For example:

```
Version 1:

scope A
scope B
scope C
```

may be replaced with:

```
Version 2:

scope A
scope C
```

After Version 2 becomes current, scope B is no longer granted.

The latest valid grant represents the complete current authority state for that service/operator pair.

Scopes MUST NOT be implicitly carried forward from older grants.

## 15. Revocation

Authority is revoked by publishing a replacement event with:

```
["status", "revoked"]
```

A revoked grant SHOULD contain no `scope` tags.

Example:

```json
{
  "kind": 30064,
  "pubkey": "<service-pubkey>",
  "created_at": 1790385000,
  "tags": [
    ["d", "relay:<operator-pubkey>"],
    ["service", "relay"],
    ["p", "<operator-pubkey>"],
    ["status", "revoked"]
  ],
  "content": ""
}
```

Clients MUST treat a current `status=revoked` record as granting no authority.

Revocation does not invalidate historical actions that were validly authorised when performed.

## 16. Expiry

Authority SHOULD be time-bounded where practical, particularly for:

- automation agents
- CI/CD systems
- temporary operators
- deployment keys
- maintenance access
- third-party services

Example:

```
Service A
   |
   | grant valid for 30 days
   v
Agent B
```

Expiry limits the duration of authority if an operator key is lost or compromised.

Long-lived grants remain permitted where appropriate.

## 17. Historical Actions

Authority is evaluated relative to the time of the operator action.

An action MAY remain historically valid even if the authority is later revoked.

For historical validation, a client may need to determine which authority grant was current when the action was created.

Implementations performing historical or audit validation SHOULD preserve previous authority events where available.

A later revocation means:

> "The operator is no longer authorised."

It does not necessarily mean:

> "The operator was never authorised."

## 18. Relationship to NCC-08

NCC-08 transfers service identity continuity.

NCC-09 authority does not automatically transfer across an NCC-08 handover.

For example:

```
A
|
| authorises
v
Operator X

A -> B
via NCC-08
```

does not imply:

```
B
|
| authorises
v
Operator X
```

After an NCC-08 handover becomes effective, the successor MUST publish new NCC-09 grants for any operator authority it wishes to preserve.

This prevents old operational permissions from silently carrying into a new service identity.

## 19. Relationship to NCC-02

NCC-02 establishes service identity and trust information.

When NCC-09 is used with NCC-02:

- the NCC-09 principal SHOULD be the relevant NCC-02 service identity
- the NCC-09 `service` identifier SHOULD match the NCC-02 Service Record identifier

NCC-09 does not modify NCC-02 trust semantics.

A client that does not trust the principal service SHOULD NOT gain trust merely because that principal has issued operator grants.

## 20. Relationship to NCC-05

NCC-05 currently defines its own publisher and locator validation requirements.

NCC-09 does not change those requirements.

If NCC-05 later explicitly defines an operator-publication scope, such as:

```
ncc:05:publish
```

then an NCC-05 client MAY recognise appropriately authorised operator-signed locator events according to those additional rules.

Until such integration is defined, NCC-05's existing signing requirements remain authoritative.

## 21. Relationship to NCC-07

NCC-07 describes what a service claims to support.

NCC-09 describes who may perform defined actions for a service.

These statements are independent.

For example:

```
NCC-07:
Service A supports feature X.

NCC-09:
Service A authorises B to administer feature X.
```

A capability declaration does not imply operator authority.

An authority grant does not imply that the service supports the underlying capability.

## 22. Relationship to Remote Signing

NCC-09 does not define remote signing.

A remote signer may hold the service private key and produce events whose author is the service identity.

Under NCC-09, the operator instead uses its own key.

Conceptually:

```
Remote signing:

Client
   |
   v
Signer holding A
   |
   v
Event authored by A
```

versus:

```
NCC-09:

A authorises B
   |
   v
B signs action
   |
   v
Event authored by B
```

These models may coexist but solve different problems.

## 23. Relationship to Delegated Signing

NCC-09 does not define delegated event signing.

The operator does not produce an event that cryptographically claims to have been authored by the principal.

Instead:

```
A says:
"B may perform X."

B says:
"I am performing X for A."
```

The consumer verifies both statements.

Historical event authorship remains unchanged.

## 24. Multiple Operators

A principal MAY authorise multiple operators for the same service and scope.

For example:

```
Service A

Operator B:
  status-publish

Operator C:
  status-publish

Operator D:
  site-publish
```

Each service/operator pair uses an independent authority grant.

NCC-09 does not impose exclusivity or priority between operators.

If an application requires:

- exclusive operators
- quorum
- priority
- approval chains
- multi-party authorisation

those rules MUST be defined separately.

## 25. Scope Granularity

Scope authors SHOULD prefer narrowly defined authority.

For example:

```
site:publish
```

is preferable to:

```
admin
```

where the underlying application can define a meaningful narrower action.

Broad scopes MAY be defined where required, but clients and operators should assume that broader authority increases the impact of key compromise.

NCC-09 does not define wildcard scopes.

## 26. Example: Nsite Deployment Key

A site's durable service identity is:

```
A
```

A deployment system uses:

```
B
```

A publishes an authority grant containing:

```
service: nsite
scope: pubkey:<namespace>:site-publish
operator: B
```

The Nsite specification or profile defines how an operator-signed site publication references A and what `site-publish` permits.

B can then publish site updates without holding A's private key.

If B is compromised, A replaces the authority grant with:

```
status: revoked
```

and creates a new deployment key if required.

## 27. Example: NostrHost Automation

A NostrHost service identity may keep its root key separate from routine automation.

It could authorise a sidecar for specific supported scopes:

```
pubkey:<namespace>:service-status
pubkey:<namespace>:backup-report
```

while a separate deployment operator receives:

```
pubkey:<namespace>:site-publish
```

The sidecar and deployment system remain independently identifiable.

Neither receives unrestricted control of the service identity.

## 28. Example: nscript Agent

An nscript automation agent may operate under its own pubkey.

The service grants:

```
pubkey:<namespace>:maintenance-report
```

The script can resolve its authority before performing the action:

```
service
   |
   | NCC-09
   v
agent key
   |
   | authorised scope
   v
maintenance action
```

The nscript runtime MAY refuse to perform an NCC-09-aware privileged action when it cannot verify a suitable current grant.

This behaviour is application policy and is not required by NCC-09 itself.

## 29. Security Considerations

### 29.1 Principle of Least Authority

Principals SHOULD grant only the scopes required by an operator.

Operators SHOULD use separate keys for materially different operational roles where practical.

### 29.2 Operator Key Compromise

An attacker controlling an operator key may perform any action accepted under that operator's active scopes.

Time-bounded grants and prompt revocation reduce this exposure.

NCC-09 does not provide automatic compromise detection.

### 29.3 Principal Key Compromise

An attacker controlling the principal key can create, modify, or revoke authority grants.

NCC-09 cannot protect against compromise of the root service identity.

### 29.4 Scope Confusion

Clients MUST interpret scopes only according to the specification that defines them.

A similarly named custom scope MUST NOT be treated as equivalent to an NCC or other externally defined scope.

For example:

```
pubkey:<x>:publish
```

is not equivalent to:

```
ncc:10:publish
```

unless a separate specification explicitly establishes such equivalence.

### 29.5 Stale Grants

Relays may retain older authority events.

Clients MUST apply normal addressable-event replacement semantics and SHOULD query multiple relays where appropriate.

A cached older grant MUST NOT override a newer valid grant or revocation.

### 29.6 Expiration

Clients MUST enforce `expiration` locally.

They MUST NOT assume that an expired grant has been removed by relays.

### 29.7 Conflicting Relay State

Different relays may temporarily expose different versions of an authority record.

Clients SHOULD resolve the current addressable event according to NIP-01 semantics before acting on a grant.

### 29.8 Self-Claimed Authority

An operator cannot grant itself authority merely by publishing an event that claims to act for a service.

Authority MUST resolve to a valid NCC-09 grant signed by the principal.

## 30. Privacy Considerations

NCC-09 grants are public by default.

They reveal relationships between:

- a service identity
- an operator identity
- a service role
- authorised functions
- validity periods

This may expose operational topology or automation roles.

Operators SHOULD avoid publishing unnecessary descriptive information in authority grants.

NCC-09 does not define private authority grants.

Private or encrypted authority relationships MAY be defined separately where required.

## 31. Minimal Conformance

A principal conforms to NCC-09 if it:

1. publishes a valid kind `30064` authority event
2. identifies exactly one operator
3. identifies the relevant service
4. uses a stable service/operator `d` value
5. identifies the grant status
6. includes at least one scope when active
7. signs the grant using the service identity

An operator action conforms to NCC-09 only where its defining specification explicitly supports NCC-09 and if it:

1. is signed by the operator's own key
2. identifies the principal service as required by that specification
3. uses an action covered by a current valid scope

A client conforms to NCC-09 if it:

1. verifies the operator action signature
2. resolves the claimed principal
3. resolves the current NCC-09 grant
4. validates service, operator, scope, status, and validity period
5. does not treat unsupported scopes as authority
6. does not treat the operator as the principal identity
7. respects the underlying specification's own NCC-09 integration rules

## 32. Why This Is an NCC

NCC-09 does not change Nostr event signatures or relay behaviour.

It defines an application-layer relationship between two ordinary Nostr identities:

```
Principal
   |
   | signed authority
   v
Operator
```

The operator continues to publish ordinary events under its own pubkey.

Relays do not need to:

- understand authority scopes
- validate operator permissions
- impersonate principals
- enforce grant expiry
- modify event authorship

Authority interpretation remains with the consuming application.

## 33. Design Rationale

The convention deliberately avoids delegated signatures.

Allowing an operator to produce events that appear to originate from the principal obscures the distinction between:

```
who owns the service
```

and:

```
who performed the action
```

NCC-09 keeps both visible.

An operator action can therefore answer two independent questions:

```
Who signed this action?
    -> Operator B

Why may B perform it for this service?
    -> Service A's NCC-09 grant
```

Addressable events are used for grants because authority is mutable current state.

Operators can be added, narrowed, expanded, expired, or revoked without changing either identity.

Scopes are deliberately extensible and externally defined so NCC-09 does not become a catalogue of application operations.

The core design principle is:

> NCC-09 allows a service identity to state who may act for it and within what scope. It does not allow another key to become or impersonate that identity.

## 34. Status

NCC-09 is experimental.

Implementers are encouraged to:

- keep root service keys separate from routine automation
- grant narrow scopes
- use expiry for automated or temporary operators
- use distinct operator keys for distinct operational roles
- revoke unused authority promptly
- require explicit opt-in from any specification that accepts operator-signed actions
- preserve operator authorship rather than representing operator events as service-authored events

If NCC-09 is not implemented, operator-signed events remain ordinary events authored only by the operator.
