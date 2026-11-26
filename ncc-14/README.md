# NCC-14: Application Composition and Service Binding

**Status:** Draft  
**Category:** Application / Interoperability  
**Author(s):** lostcause  
**Supersedes:** None

**Related specifications (Informative)**

- NIP-01: Nostr events and addressable events.
- NIP-19: Portable Nostr identifiers.
- NIP-44 and NIP-78: Optional encrypted configuration synchronisation.
- NIP-5A: Distribution and verification of frontend applications.
- NIP-89: Application recommendation metadata; not a composition format.
- NCC-02: Service identity and trust.
- NCC-05: Service endpoint discovery.
- NCC-07: Service capability claims.

## Abstract

NCC-14 defines a client-side convention for describing the backend services an application can use, checking whether those services claim compatible interfaces, and binding logical dependencies to service identities. It composes frontend distribution, service identity, and endpoint discovery without requiring a particular host, runtime, deployment system, language, transport, or authentication mechanism.

NCC-14 is optional. A browser library, native client, agent, or application runtime may implement it. Nostr Navigator may implement it, but is not required or privileged by this convention.

## 1. Purpose

NIP-5A can distribute a frontend. NCC-02 can identify and establish trust context for services. NCC-05 can resolve current endpoints for service identities. These pieces do not by themselves describe which services an application needs, whether a service is suitable for a dependency, or which provider a user chose.

NCC-14 supplies that composition layer. It enables an application publisher to describe logical dependencies without operating the corresponding backend, and a service operator to offer infrastructure without maintaining the application's frontend.

## 2. Scope and principles

NCC-14 defines conventions for:

- Composition descriptors and their relationship to an application frontend.
- Named service dependencies and interface compatibility declarations.
- Fixed, user-selectable, and discoverable provider bindings.
- User-owned bindings, runtime resolution, permissions, and lifecycle handling.
- Application updates, copying, and provider migration.

NCC-14 does not define a transport protocol, authentication mechanism, hosting standard, relay requirement, service API, interface language, or mandatory application runtime. It does not change NIP-5A, NCC-02, or NCC-05.

The convention follows these separations:

| Concern | Responsible specification or component |
| --- | --- |
| Application identity | Application publisher key and stable application identifier |
| Frontend distribution | NIP-5A or another distribution mechanism |
| Application composition | NCC-14 |
| Service identity and trust | NCC-02 and user policy |
| Endpoint resolution | NCC-05 or another locator mechanism |
| Service behaviour | The referenced interface specification |

An implementation MUST NOT assume that a particular browser, navigator, relay, hosting provider, or programming language is available.

## 3. Composition descriptor

A composition descriptor is a signed, addressable Nostr event authored by the application publisher. It describes an application release's logical dependencies and declared permissions. It contains no private endpoint, credential, access token, or user binding.

### 3.1 Event kind and identifier

This draft proposes addressable event kind `35129`, subject to confirmation of kind availability and community adoption. The event uses the normal NIP-01 addressable-event identity:

```text
35129:<publisher-pubkey>:<application-id>
```

The `d` tag MUST contain a stable application identifier scoped to the publisher. The proposal does not allocate a Nostr kind; `35129` is a provisional convention value and MUST be checked against current kind usage before implementations depend on it. If unavailable, the event definition needs revision before publication as a stable specification.

### 3.2 Required tags

- `d`: stable application identifier.
- `schema`: descriptor schema version; this draft uses `1`.
- `version`: application release version, interpreted as an opaque string unless the descriptor declares a version scheme.

The event SHOULD include `title` for human-readable display. It MAY include `summary`, `license`, and `url` tags.

### 3.3 Relationship to frontend manifests

Where the frontend is distributed using NIP-5A, its manifest MAY reference the composition descriptor using the existing `app` tag, with a NIP-01 address and relay hint as appropriate. The descriptor's `frontend` object MUST identify the frontend manifest address (or another unambiguous frontend identity) in content. Supporting runtimes MUST verify both references agree before treating the pair as an application configuration. The publisher key of the two events need not be the same only if an explicit, verifiable delegation rule is specified by the distribution mechanism; absent such a rule, the keys MUST match.

This mutual reference helps detect accidental mismatch; it does not prove that the frontend is safe. Implementations MUST verify event signatures, address references, and the frontend's own integrity data according to the referenced distribution convention. The composition reference is not covered by a frontend aggregate hash unless that distribution convention explicitly includes it. A runtime MUST track frontend and composition revisions separately.

NIP-89 metadata MAY help users discover or launch an application, but MUST NOT be treated as a replacement for a signed composition descriptor or as proof of application identity.

### 3.4 Content schema

The event content MUST be a UTF-8 JSON object. Unknown fields MUST be ignored unless marked as required by a future schema mechanism. A version 1 descriptor has this shape:

```json
{
  "schema": 1,
  "name": "Nostr Notes",
  "version": "1.2.0",
  "frontend": {
    "kind": 35128,
    "pubkey": "<publisher-pubkey-hex>",
    "d": "notes"
  },
  "dependencies": {
    "notes": {
      "interface": "org.example.notes",
      "version": {"scheme": "semver", "min": "1.0.0", "min_inclusive": true, "max": "2.0.0", "max_inclusive": false},
      "description_sha256": "<optional-sha256-hex>",
      "required": true,
      "binding": "user-selectable",
      "default": "30059:<service-pubkey>:notes-api"
    },
    "storage": {
      "interface": "org.example.storage",
      "version": {"scheme": "semver", "min": "2.0.0", "min_inclusive": true},
      "required": true,
      "binding": "discoverable"
    },
    "analytics": {
      "interface": "org.example.analytics",
      "version": {"scheme": "semver", "min": "1.0.0", "min_inclusive": true},
      "required": false,
      "binding": "fixed",
      "default": "30059:<service-pubkey>:analytics"
    }
  },
  "permissions": {
    "notes": {
      "methods": ["GET", "POST", "PUT", "DELETE"],
      "paths": ["/documents/*"]
    },
    "storage": {
      "methods": ["GET", "POST"],
      "paths": ["/files/*"],
      "max_upload_bytes": 10485760
    }
  }
}
```

The JSON `schema` value MUST agree with the `schema` tag. `version` MUST use the same value in the event tag and JSON content. `frontend.kind`, `frontend.pubkey`, and `frontend.d` together identify a NIP-01 addressable event; the example's kind `35128` represents a named NIP-5A manifest. Implementations SHOULD reject malformed descriptors, duplicate aliases, unknown binding modes, and dependency references that are not valid Nostr addresses where an address is required. `default` is optional and MUST be a service address, not an endpoint URL.

## 4. Dependencies and interfaces

Each dependency is keyed by a stable, application-local alias. An alias MUST match `^[a-z][a-z0-9_-]{0,63}$` and MUST be unique within the descriptor.

Each dependency MUST declare:

- `interface`: stable interface identifier.
- `version`: a compatibility constraint in the format defined below.
- `required`: whether the application can operate without it.
- `binding`: one of `fixed`, `user-selectable`, or `discoverable`.

An interface identifier SHOULD be globally unambiguous, for example a reverse-domain name, a NIP/NCC identifier, or a content-addressed URI. NCC-14 does not define interface behavior. For interoperable comparison, version constraints in this profile use SemVer 2.0.0 core versions (`MAJOR.MINOR.PATCH`) and inclusive/exclusive bounds. A dependency's `version` is an object with `scheme: "semver"`, optional `min` and `max` strings, and corresponding `min_inclusive` / `max_inclusive` booleans. At least one bound MUST be present; missing inclusivity flags default to `true`. Prerelease and build metadata are not permitted in this profile. A service version matches when it is a valid core SemVer version and satisfies every present bound. Unknown schemes or malformed constraints yield `unknown`, never a guessed match. This simple bound model avoids relying on package-manager-specific range operators such as `^` or `~`.

An interface MAY reference OpenAPI, AsyncAPI, JSON Schema, MCP, GraphQL SDL, a NIP, an NCC, or a custom contract. The reference SHOULD be immutable or content-addressed where possible. Interface descriptions may use formats unsuitable for every client; clients may report unsupported interface formats rather than claiming compatibility.

### 4.1 Service compatibility advertisement

NCC-14 defines an interface-advertisement profile on the existing NCC-07 capability manifest (kind `30062`, `d=capabilities`). This reuses NCC-07 service identity and replaceable-event behaviour without changing the meaning of existing `cap` tags. Interface advertisements are additional tags in the same signed manifest:

```json
["iface", "org.example.notes", "1.3.0", "https://example.org/notes/openapi.json", "<sha256-hex>"]
```

Tag fields are:

1. `iface` (literal marker).
2. Interface identifier.
3. One implemented interface version in SemVer core form.
4. Optional immutable interface-description URI.
5. Optional SHA-256 hash of the exact description bytes, lowercase hexadecimal.

The service MUST publish one `iface` tag for each supported interface version. The service MAY publish several versions of the same interface. The interface identifier and version MUST be non-empty. If the description URI is present, the hash MUST also be present; a hash without a URI is invalid. The hash is an integrity reference, not proof that the running service conforms to the description. A service that publishes no matching `iface` tag has made no machine-readable compatibility assertion under this profile, even if it has NCC-07 `cap` tags.

The kind `30062` event MUST be authored by the service identity pubkey used for NCC-02. Clients MUST resolve the latest valid event for that pubkey and `d=capabilities`, verify its signature, and apply NCC-07/NIP-01 replacement rules. An expired, invalid, or unavailable manifest yields `unknown`, not `incompatible`.

### 4.2 Compatibility comparison

For each dependency, a runtime compares its `interface` identifier and version bounds with all `iface` tags in the selected service's current manifest:

| Result | Meaning |
| --- | --- |
| `match` | At least one same-identifier advertised version satisfies the declared bounds. |
| `no-match` | A valid, current manifest is available and contains the interface identifier, but none of its advertised versions satisfies the bounds. |
| `unknown` | The manifest is missing, invalid, expired, unsupported, or lacks machine-readable interface data. |

A runtime MUST NOT treat `unknown` as `match`. A `no-match` service MUST NOT be presented as compatible. Local policy may permit a user to proceed despite `unknown` or `no-match`, but the exception MUST be visible and MUST NOT be represented as verified compatibility. `match` means only that the signed version assertion satisfies the declared range; it does not establish implementation correctness, trust, authorization, or availability.

The optional `description_sha256` field in a dependency allows the application publisher to pin the exact interface-description bytes. When present, a provider matches only if its `iface` tag includes the same hash; a missing or different hash yields `no-match`. The field MUST be a 64-character lowercase hexadecimal SHA-256 digest. A hash pin does not create compatibility by itself: identical documents may be implemented incorrectly. A changed hash requires a composition update and SHOULD trigger user review.

Service claims are self-asserted. Runtimes MUST distinguish advertised compatibility from independently tested compatibility and publisher-endorsed compatibility. An interface claim alone MUST NOT establish trust, authorization, availability, or correctness.

## 5. Binding models

The `binding` field determines how the provider is selected:

- `fixed`: the descriptor MUST identify a service identity in `default`. The runtime MUST use that identity or report the dependency unavailable. A user may still reject or disable the application; changing the provider requires a publisher update or an explicit user override that the runtime labels as a policy exception.
- `user-selectable`: the descriptor MAY recommend a default service identity; the user chooses whether to accept it or bind a compatible provider. `default` MUST NOT be interpreted as pre-authorization.
- `discoverable`: the runtime may find candidate providers that advertise the interface. The user or a previously authorized local policy chooses among them.

Discovery MUST NOT imply trust or automatic authorization. A runtime MUST NOT silently choose an unapproved provider where the selected provider changes the trust identity or permissions. If a required dependency cannot be resolved, the runtime SHOULD report a configuration or connectivity error. An unavailable optional dependency SHOULD NOT prevent application execution.

## 6. User-owned bindings

Bindings are local user configuration, separate from the publisher's descriptor. A binding maps an alias to a service identity, not directly to a mutable endpoint. The JSON example uses a NIP-01 address string (kind:pubkey:d); NIP-19 encodings may be used for display or storage only where the implementation can unambiguously decode them:

```json
{
  "application": "35129:<publisher-pubkey>:notes",
  "composition_event": "<event-id>",
  "bindings": {
    "notes": "30059:<user-pubkey>:notes",
    "storage": "30059:<provider-pubkey>:storage"
  }
}
```

Runtimes SHOULD store bindings locally by default. They MAY synchronize user bindings using an existing encrypted storage mechanism, such as NIP-44 with NIP-78, subject to the user's explicit choice and the mechanism's security properties. Public events MUST NOT contain private endpoint details, credentials, or access tokens. A shared binding should identify a service, not disclose a resolved private NCC-05 locator.

Bindings SHOULD be scoped to the complete application address and composition identity. They MUST NOT be automatically reused for a different publisher, application address, or fork.

## 7. Resolution and runtime behaviour

A supporting runtime SHOULD perform these steps:

1. Discover an application and its frontend distribution metadata.
2. Verify the frontend and composition signatures and their mutual references.
3. Parse the descriptor and identify declared dependencies and permissions.
4. Load user bindings keyed to the application address and the specific composition revision or its declared compatibility lineage; apply local provider-selection policy.
5. Check the selected service identity and trust context using NCC-02 or local policy.
6. Check advertised interface compatibility and report the evidence level.
7. Resolve the selected service endpoint using NCC-05 or another supported mechanism.
8. Apply permission and network isolation before allowing application requests.
9. Monitor updates, revocation, expiry, and resolution changes according to local policy.

Runtimes MUST NOT substitute an alternative provider for a selected provider without user authorization or a previously authorized policy. Redirects and endpoint changes MUST be checked against the active service identity and permission policy.

NCC-14 does not prescribe a programming language or API. A runtime may expose an API conceptually equivalent to:

```javascript
const app = await runtime.application();
const notes = await app.service("notes");
const response = await notes.fetch("/documents");
```

The API MUST reject undeclared aliases. Requests made through privileged runtime interfaces MUST be limited to the selected service and declared permissions. Applications may also make ordinary network requests outside such an interface; sandboxing and platform security determine whether those requests can be controlled.

## 8. Permissions and security boundaries

Permissions are a declaration of the maximum access requested through a supporting runtime's privileged interface. They are not a grant. Users or runtime policy decide whether to grant them. A descriptor may scope permissions by dependency, method, path, operation, or resource limits.

Runtimes SHOULD keep credentials scoped to individual service identities, isolate application storage by application identity, support revocation, and request renewed approval when an update expands sensitive permissions or changes a trusted service identity. Private-network and loopback access SHOULD require explicit approval. Redirect destinations MUST be revalidated against the allowed endpoint and service identity policy. A runtime MUST NOT expose Nostr private signing keys to application code. Permission path patterns MUST be interpreted against a normalized request path; implementations MUST reject ambiguous encodings or traversal that could bypass a path restriction. The descriptor does not define the syntax of path patterns beyond the illustrative example, so implementations MUST NOT claim interoperable enforcement of those patterns until a shared matching rule is specified.

NCC-14 does not replace browser same-origin rules, TLS validation, service authentication, or operating-system sandboxing. A configured service identity does not itself encrypt or authenticate the transport. Clients MUST apply the service's trust requirements and the transport's own security checks.

## 9. Updates and application state

Frontend code, composition, service identity, endpoint location, and user bindings have independent lifecycles. A runtime SHOULD track at least:

```json
{
  "frontend_event_id": "<event-id>",
  "frontend_integrity": "<distribution-integrity-value>",
  "composition_event_id": "<event-id>",
  "bindings_hash": "<local-configuration-hash>"
}
```

An unchanged frontend integrity value MUST NOT be treated as proof that composition or user bindings are unchanged. A changed endpoint for the same verified service identity may be resolved according to NCC-05 without changing the binding. A changed service identity, expanded permission, or incompatible interface change SHOULD trigger renewed user review. Breaking interface changes SHOULD use a new interface version and a corresponding composition update.

## 10. Copying and forking

A copied frontend or forked application is a distinct application when its publisher or application address differs, even if its asset bytes are identical. The fork publisher SHOULD publish a descriptor under its own identity and reference the fork's frontend. Runtimes MUST NOT automatically transfer the original application's bindings, permissions, or credentials to a fork. Merely republishing identical assets does not transfer the original publisher's identity or authorization.

This permits a fork to retain frontend assets while replacing abandoned or unavailable services. NCC-14 does not define software licensing, data migration, or ownership of backend data.

## 11. Relationship to other specifications

| Specification | Role |
| --- | --- |
| NIP-01 | Event signatures, addressable events, tags |
| NIP-19 | Portable Nostr references |
| NIP-44 / NIP-78 | Optional encrypted configuration synchronization |
| NIP-5A | Frontend distribution and integrity |
| NIP-89 | Application discovery/recommendation metadata |
| NCC-02 | Service identity and trust context |
| NCC-05 | Dynamic service endpoint resolution |
| NCC-07 | Service capability assertions |
| NCC-14 | Application dependencies, provider bindings, permissions, composition, and the `iface` advertisement profile on NCC-07 manifests |

NIP-89 should be considered for discovery metadata, but it does not currently define the dependency-binding semantics of this convention. A new composition descriptor is used here because discovery metadata and executable application dependencies have different purposes.

## 12. Non-goals

NCC-14 does not:

- Require Nostr Navigator or any other specific runtime.
- Require NIP-5A; other frontend distribution mechanisms may be used if a frontend identity can be verified.
- Define service APIs, interface contracts, transports, authentication, billing, or hosting.
- Require a particular relay or service catalogue.
- Prove that an advertised service implements an interface correctly.
- Grant an application authority to access a service merely because it is declared.

## 13. Security and privacy considerations

Signed descriptors establish who published the dependency declaration, not whether the application is benign. Descriptors and public bindings can reveal application dependencies and provider choices; sensitive bindings should remain local or use encrypted synchronization. Service discovery can expose interests or network metadata, depending on the mechanism used. Implementations should avoid leaking private NCC-05 locator data through public events, logs, or application-visible errors.

Applications may request overly broad permissions or recommend a malicious provider. Users should be shown the selected service identity, compatibility evidence, and requested privileges. A service's interface claim is not a security certification. Compromise of an application publisher may change dependencies and permissions; runtimes should surface descriptor changes independently of frontend changes.

## 14. Conformance

A publisher conforms to this draft when it publishes a valid signed descriptor, uses unique dependency aliases, declares interface/version/required/binding for each dependency, and keeps user-specific or secret configuration out of the public descriptor.

A runtime conforms to this draft when it verifies the descriptor and frontend references, keeps bindings separate from publisher data, checks service identity and interface claims before use, does not silently replace providers, rejects undeclared aliases through privileged APIs, and applies declared permission ceilings.

## 15. Implementation path

A minimal interoperable implementation can support one frontend distribution, one required HTTP dependency, a declared interface identifier, and two interchangeable NCC-02 service identities resolved through NCC-05. Later work can define a concrete interface advertisement profile, test vectors, encrypted binding synchronization, and richer permission vocabularies.

NCC-14 is experimental. The event kind and descriptor schema should be reviewed before implementations treat them as stable. A runtime that ignores NCC-14 leaves existing frontend distribution and service discovery behaviour unchanged.
