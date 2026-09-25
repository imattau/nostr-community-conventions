# NCC-10: Service Operational State

**Status:** Draft
**Category:** Service / Operations
**Author(s):** lostcause
**Supersedes:** None

## Related NCCs

- **NCC-00:** Publication, revision, and discovery of NCC documents.
- **NCC-02:** Pubkey-owned service identity, trust, endpoint binding, attestations, and revocation.
- **NCC-05:** Identity-bound service locator resolution.
- **NCC-06:** Service participation profile composing NCC-02 and NCC-05.
- **NCC-07:** Service capability advertisement.
- **NCC-08:** Service identity rotation and handover.
- **NCC-09:** Scoped operator authority.

---

## Abstract

This Nostr Community Convention defines a minimal, machine-readable method for a Nostr-identified service to publish its current operational state.

A service may report one of the following states:

- `operational`
- `degraded`
- `maintenance`
- `unavailable`
- `retiring`

The state is published as a signed addressable event.

NCC-10 also defines optional publication by an operator explicitly authorised under NCC-09 using the scope:

```text
ncc:10:publish
```

NCC-10 records what a service or authorised operator claims about the service's current state.

It does not prove availability, replace independent monitoring, define incident management, or require relay enforcement.

---

## 1. Purpose

Nostr clients may be able to identify a service, resolve its endpoint, and discover its capabilities without knowing whether the service currently considers itself operational.

NCC-10 addresses the question:

> "What does this service currently say about its operational state?"

This allows clients and users to distinguish between situations such as:

- normal operation
- partial degradation
- planned maintenance
- known unavailability
- intentional retirement

without inferring state only from connection success or failure.

---

## 2. Design Goals

NCC-10 aims to provide:

- simple machine-readable service state
- signed state assertions
- deterministic latest-state behaviour
- optional human-readable context
- support for expected maintenance windows
- explicit integration with NCC-09 operators
- composition with NCC-08 service retirement and succession
- safe handling by clients that do not support the convention

The convention deliberately separates operator-declared state from independently observed service health.

---

## 3. Non-Goals

NCC-10 does not define:

- uptime monitoring
- availability measurement
- service-level agreements
- incident-management workflows
- alerting systems
- component health trees
- severity scoring
- performance metrics
- monitoring attestations
- relay enforcement
- automatic failover
- service identity
- service location
- capability discovery
- service recovery
- proof that a reported state is correct

Those concerns belong to monitoring systems, applications, or separate conventions.

---

# 4. Operational State Model

NCC-10 defines five operational states:

```text
operational
degraded
maintenance
unavailable
retiring
```

A service MUST publish exactly one state in its current NCC-10 state event.

---

## 4.1 `operational`

The service reports that it is operating normally.

This does not guarantee:

- reachability
- performance
- availability
- correctness

It is a self-reported operational state.

---

## 4.2 `degraded`

The service reports that it remains operational but that one or more aspects of normal service are impaired.

Examples may include:

- reduced performance
- partial feature availability
- intermittent failures
- reduced capacity

Clients SHOULD NOT assume complete unavailability.

---

## 4.3 `maintenance`

The service reports that it is intentionally undergoing maintenance.

The service may be:

- fully available
- partially available
- temporarily unavailable

Clients MAY use `expected_until` where present to provide additional context.

---

## 4.4 `unavailable`

The service reports that it is currently unavailable for normal use.

This is an operator assertion and does not itself indicate the cause.

---

## 4.5 `retiring`

The service reports that it is being withdrawn from use.

A retiring service MAY remain available during a transition period.

A retiring state MAY include a successor hint as described in Section 14.

Retirement does not itself establish service identity continuity.

---

# 5. Event Definition

## 5.1 Event Kind

Service operational state events use:

- **kind `30065`**

Kind `30065` is an addressable event under the NIP-01 addressable event range.

Operational state represents current mutable state, so addressable-event replacement semantics are appropriate.

---

## 5.2 Direct Publication Identifier

When the service identity publishes its own state, the `d` tag MUST be:

```text
<service-id>
```

Example:

```text
["d", "relay"]
```

The state is therefore addressable by:

```text
kind + service-pubkey + service-id
```

---

## 5.3 Required Tags

A directly published state event MUST contain:

```text
["d", "<service-id>"]
["service", "<service-id>"]
["state", "<state-value>"]
```

`state` MUST contain one of the values defined in Section 4.

---

## 5.4 Optional Tags

A state event MAY contain:

```text
["since", "<unix-seconds>"]
["expected_until", "<unix-seconds>"]
["incident", "<identifier>"]
["successor", "<pubkey-hex>"]
```

The meaning of these tags is defined below.

---

## 5.5 Content

The `content` field MAY contain short human-readable status information.

Example:

```text
Intermittent upstream connectivity.
```

Clients MUST NOT require content in order to interpret the machine-readable state.

Clients MUST NOT derive normative state from the text content.

---

# 6. Example Direct State Event

```json
{
  "kind": 30065,
  "pubkey": "<service-pubkey>",
  "created_at": 1790380000,
  "tags": [
    ["d", "relay"],
    ["service", "relay"],
    ["state", "degraded"],
    ["since", "1790379700"]
  ],
  "content": "Intermittent upstream connectivity."
}
```

This states that the service reports itself as degraded and that the degraded condition began before the status event was published.

---

# 7. `since`

The optional `since` tag identifies when the reported state is believed to have begun.

Example:

```text
["since", "1790379700"]
```

This may differ from the event's `created_at`.

For example:

```text
condition begins: 09:00
event published:  09:07
```

Clients MAY display the reported duration of the current state using `since`.

Clients MUST NOT treat `since` as cryptographic proof that the state actually began at that time.

---

# 8. `expected_until`

The optional `expected_until` tag provides an estimated time at which the current condition is expected to end.

Example:

```text
["expected_until", "1790387200"]
```

This is particularly useful for:

- maintenance
- temporary outages
- known degraded periods

`expected_until` is informational.

Passing the timestamp does not automatically change the service state.

A new NCC-10 event must be published to declare a different current state.

---

# 9. `incident`

The optional `incident` tag provides an identifier that applications may use to associate a status event with external or application-specific incident information.

Example:

```text
["incident", "incident-2026-09-26-01"]
```

NCC-10 does not define:

- incident-event formats
- incident timelines
- remediation workflows
- incident severity

The identifier MUST be treated as opaque unless another specification defines its meaning.

---

# 10. State Replacement

A new state event replaces the previous state event for the same:

```text
kind + pubkey + d
```

For direct service publication:

```text
30065:<service-pubkey>:<service-id>
```

The latest valid addressable event represents the service's current declared state.

For example:

```text
09:00 degraded
09:30 maintenance
10:15 operational
```

The current state is:

```text
operational
```

Historical states MAY remain available from archival systems but MUST NOT override the current addressable event.

---

# 11. NCC-09 Operator Publication

NCC-10 explicitly supports publication by an operator authorised through NCC-09.

The NCC-09 authority scope for publishing NCC-10 state is:

```text
ncc:10:publish
```

An NCC-09 authority grant containing:

```text
["scope", "ncc:10:publish"]
```

authorises the named operator to publish NCC-10 operational state for the specified service, subject to the rules below.

---

# 12. Operator State Events

An authorised operator signs NCC-10 state events using the operator's own key.

The operator MUST NOT impersonate the service identity.

An operator state event MUST contain:

```text
["d", "<service-pubkey>:<service-id>"]
["service", "<service-id>"]
["state", "<state-value>"]
["operator_for", "<service-pubkey>", "<service-id>"]
```

Example:

```json
{
  "kind": 30065,
  "pubkey": "<operator-pubkey>",
  "created_at": 1790380000,
  "tags": [
    ["d", "<service-pubkey>:relay"],
    ["service", "relay"],
    ["state", "maintenance"],
    ["operator_for", "<service-pubkey>", "relay"],
    ["expected_until", "1790387200"]
  ],
  "content": "Scheduled maintenance."
}
```

The operator remains the event author.

The `operator_for` tag identifies the principal service under which the operator claims to act.

It does not itself provide authority.

---

# 13. Operator Validation

A client considering an operator-published NCC-10 event MUST:

1. verify the NCC-10 event signature
2. identify the operator pubkey from the event author
3. identify the principal service from `operator_for`
4. verify that the `service` identifier matches the `operator_for` service identifier
5. resolve the principal's current NCC-09 authority grant for that operator and service
6. verify the NCC-09 grant signature
7. verify that the grant is active
8. verify that the grant is within its validity period
9. verify that the grant contains:

```text
ncc:10:publish
```

10. only then treat the operator event as authorised NCC-10 state

If any required validation fails, the client MUST NOT treat the event as authoritative NCC-10 state for the principal service.

---

# 14. Successor Hint

A service in `retiring` state MAY include:

```text
["successor", "<pubkey-hex>"]
```

Example:

```text
state: retiring
successor: B
```

This means only:

> "The retiring service indicates B as an intended successor."

It does not establish cryptographic identity continuity.

Clients that support NCC-08 SHOULD independently resolve and validate any NCC-08 handover involving that successor.

Therefore:

```text
NCC-10 successor hint
```

is not equivalent to:

```text
NCC-08 validated handover
```

---

# 15. Relationship to NCC-08

NCC-08 defines cryptographically acknowledged continuity between service identities.

NCC-10 describes current operational state.

They may be composed during retirement.

Example:

```text
Service A

NCC-10:
state = retiring
successor = B

NCC-08:
A -> B
```

If the NCC-08 handover is valid and effective, a client may display:

```text
A is retiring.
B is the verified successor.
```

If NCC-08 continuity is absent, the client SHOULD NOT describe B as a verified successor solely from NCC-10.

---

# 16. Relationship to NCC-02

NCC-02 identifies the service.

When NCC-10 is used with NCC-02:

- the direct NCC-10 publisher SHOULD be the corresponding service identity
- the NCC-10 `service` identifier SHOULD match the relevant NCC-02 Service Record identifier

NCC-10 does not establish service identity independently of the client's existing trust model.

---

# 17. Relationship to NCC-05

NCC-05 answers:

> "Where can this service currently be reached?"

NCC-10 answers:

> "What state does the service currently report?"

These are independent assertions.

For example:

```text
NCC-05:
endpoint is reachable at X

NCC-10:
state = maintenance
```

Both may be valid simultaneously.

Clients MUST NOT infer NCC-10 state solely from NCC-05 endpoint reachability.

---

# 18. Relationship to NCC-07

NCC-07 describes what a service claims to support.

NCC-10 describes the service's current operational state.

A service MAY advertise:

```text
["cap", "ncc:10"]
```

under NCC-07 to indicate support for NCC-10.

NCC-07 capability advertisement is not required for a valid NCC-10 event.

---

# 19. Direct State Versus Operator State

A directly published service state has priority over operator-published state when both are current and available.

The reasoning is:

```text
service's own assertion
```

is more direct than:

```text
authorised operator's assertion
```

Therefore, clients SHOULD resolve state in this order:

1. current valid state signed directly by the service identity
2. current valid NCC-09-authorised operator state
3. unknown state

An operator MUST NOT override a current directly signed service state merely by publishing a newer operator event.

---

# 20. Multiple Operator States

More than one operator may hold `ncc:10:publish` authority.

If no current direct service state is available, a client may encounter multiple valid operator states.

If all valid operator states agree, the client MAY use that state.

If valid operator states disagree, the client SHOULD treat the result as conflicting operator state.

Example:

```text
Operator B:
state = operational

Operator C:
state = unavailable
```

A client MUST NOT silently interpret one of these as the service's definitive state solely because its event has a later timestamp.

Applications MAY:

- display the conflict
- apply local operator trust policy
- wait for a direct service assertion
- treat service state as unknown

---

# 21. Unknown State

Absence of an NCC-10 event does not imply any particular service state.

In particular:

```text
no NCC-10 event
```

does not mean:

```text
operational
```

and does not mean:

```text
unavailable
```

Clients SHOULD represent this situation as unknown or simply omit operational-state information.

---

# 22. Independent Monitoring

NCC-10 state is an assertion, not an observation.

For example:

```text
NCC-10:
operational
```

may coexist with:

```text
external monitor:
connection failed
```

Neither statement invalidates the other because they answer different questions.

NCC-10 means:

> "The service or authorised operator reports this state."

A monitoring system means:

> "This observer measured this condition."

NCC-10 does not define reconciliation between these perspectives.

---

# 23. No Component Hierarchy

NCC-10 does not define nested service components.

For example, a single NCC-10 event SHOULD NOT attempt to encode:

```text
database = degraded
api = operational
media = unavailable
```

Where independently meaningful operational components need independent state, they SHOULD be represented as separate service identifiers where practical.

Example:

```text
service: api
service: media
service: relay
```

Each service can then publish its own NCC-10 state.

---

# 24. No Severity Scores

NCC-10 deliberately does not define:

- numeric severity
- colour states
- incident levels
- priority rankings

Examples such as:

```text
severity = 3
red
criticality = high
```

are outside the core convention.

Applications MAY maintain their own presentation or alerting policy based on NCC-10 state.

---

# 25. Client Resolution

To resolve the operational state of a service, a supporting client SHOULD:

1. identify the service pubkey
2. identify the service identifier
3. query appropriate relays for direct kind `30065` state
4. verify the direct event signature
5. apply normal NIP-01 addressable-event replacement semantics
6. if a valid direct state exists, use it
7. otherwise discover candidate operator-published kind `30065` events
8. validate each operator event under NCC-09
9. if one valid operator state exists, use it
10. if multiple valid operator states agree, MAY use that state
11. if valid operator states conflict, treat state as conflicted or unknown
12. if no valid state exists, treat state as unknown

---

# 26. State Freshness

NCC-10 does not define a mandatory expiry period for operational state.

Some state declarations may legitimately persist for long periods.

For example:

```text
operational
retiring
```

may remain valid until replaced.

Applications MAY apply local freshness policy, but MUST distinguish such policy from NCC-10 validity.

A client MUST NOT claim that an NCC-10 event is invalid solely because it is old unless another applicable rule establishes expiry.

---

# 27. Example: Normal Operation

```json
{
  "kind": 30065,
  "pubkey": "<service-pubkey>",
  "created_at": 1790380000,
  "tags": [
    ["d", "api"],
    ["service", "api"],
    ["state", "operational"]
  ],
  "content": ""
}
```

---

# 28. Example: Scheduled Maintenance

```json
{
  "kind": 30065,
  "pubkey": "<service-pubkey>",
  "created_at": 1790380000,
  "tags": [
    ["d", "relay"],
    ["service", "relay"],
    ["state", "maintenance"],
    ["since", "1790380000"],
    ["expected_until", "1790387200"]
  ],
  "content": "Scheduled database maintenance."
}
```

---

# 29. Example: Retirement

```json
{
  "kind": 30065,
  "pubkey": "<service-pubkey-A>",
  "created_at": 1790380000,
  "tags": [
    ["d", "nsite"],
    ["service", "nsite"],
    ["state", "retiring"],
    ["successor", "<service-pubkey-B>"]
  ],
  "content": "This site is moving to a new service identity."
}
```

A supporting client SHOULD independently validate NCC-08 before treating B as a verified successor.

---

# 30. Example: Authorised Operator

Service A grants operator B:

```text
ncc:10:publish
```

through NCC-09.

B then publishes:

```json
{
  "kind": 30065,
  "pubkey": "<operator-B>",
  "created_at": 1790380000,
  "tags": [
    ["d", "<service-A>:relay"],
    ["service", "relay"],
    ["state", "degraded"],
    ["operator_for", "<service-A>", "relay"],
    ["since", "1790379700"]
  ],
  "content": "Reduced capacity while an upstream dependency recovers."
}
```

A client verifies B's NCC-09 grant before recognising the state as authoritative for service A.

---

# 31. Security Considerations

## 31.1 Self-Reported State

A directly signed NCC-10 event proves only that the service identity published the state.

It does not prove that the state accurately reflects observed service behaviour.

---

## 31.2 Operator Misreporting

An authorised operator with `ncc:10:publish` may publish incorrect state information.

Principals SHOULD grant this authority only to operators appropriate for operational reporting.

---

## 31.3 Principal Key Compromise

An attacker controlling the service identity can publish arbitrary NCC-10 state.

NCC-10 cannot protect against compromise of the root service identity.

---

## 31.4 Operator Key Compromise

An attacker controlling an authorised operator key may publish state while that authority remains valid.

NCC-09 expiry and revocation SHOULD be used to limit this exposure.

---

## 31.5 Stale Relay State

Relays may expose obsolete addressable events.

Clients SHOULD query appropriate relays and apply NIP-01 replacement semantics before interpreting service state.

---

## 31.6 False Availability Assumptions

Clients MUST NOT treat `operational` as proof that a service is reachable.

Likewise, clients SHOULD NOT assume a connection failure means an NCC-10 `operational` event is fraudulent or invalid.

---

# 32. Privacy Considerations

NCC-10 state is public by default.

Operational state may reveal information such as:

- maintenance activity
- service outages
- migration timing
- infrastructure issues
- retirement plans

Operators SHOULD avoid publishing unnecessary operational detail in `content`.

The machine-readable state SHOULD remain concise.

NCC-10 does not define private status publication.

---

# 33. Minimal Conformance

A service directly publishing NCC-10 conforms if it:

1. publishes a valid kind `30065` addressable event
2. uses the relevant service identifier as `d`
3. includes a matching `service` tag
4. includes exactly one recognised `state`
5. signs the event using the service identity

An NCC-09 operator conforms if it:

1. has a current valid grant for:
   ```text
   ncc:10:publish
   ```
2. signs the NCC-10 event using its own key
3. identifies the principal using `operator_for`
4. identifies the correct service
5. uses the required operator `d` format

A client conforms if it:

1. recognises the five NCC-10 states
2. resolves current addressable state
3. prefers direct service state over operator state
4. validates operator authority through NCC-09
5. does not infer state from absence of an event
6. does not treat operational state as proof of availability
7. treats conflicting authorised operator states explicitly rather than silently selecting a winner

---

# 34. Why This Is an NCC

NCC-10 does not modify relay behaviour or introduce a new transport mechanism.

It defines a shared application-layer interpretation of ordinary addressable Nostr events.

Relays do not need to:

- validate operational state
- measure availability
- verify operator authority
- interpret maintenance windows
- follow successor identities
- enforce incident handling

All interpretation remains client-side.

---

# 35. Design Rationale

NCC-10 deliberately defines a small state vocabulary.

The convention does not attempt to become:

- a monitoring system
- an incident-management standard
- an observability protocol
- an SLA framework
- a service dependency model

The five states are intended to answer one question:

> "How does this service currently describe its own operational condition?"

NCC-09 integration allows operational automation without exposing the service root key.

NCC-08 integration allows retirement information to point toward a successor without conflating a status hint with verified identity continuity.

The core design principle is:

> NCC-10 records what a service says about its current operational state. It does not prove availability or replace independent monitoring.

---

# 36. Status

NCC-10 is experimental.

Implementers are encouraged to:

- keep state declarations concise
- use `since` when the condition predates publication
- use `expected_until` for known temporary conditions
- avoid unnecessary operational detail
- use NCC-09 for automation rather than exposing service root keys
- independently verify NCC-08 succession when presenting retirement transitions
- treat missing state as unknown
- keep independent monitoring distinct from operator-declared state

If NCC-10 is not implemented, existing service behaviour remains unchanged.
