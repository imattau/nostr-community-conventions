# NCC-13: Software Package Release Profile

**Status:** Draft
**Category:** Software / Distribution
**Author(s):** lostcause
**Supersedes:** None

## Related Specifications

- NIP-34: Git repository announcements and repository state.
- NIP-51: Release Artifact Sets and Software Application references.
- NIP-94: File Metadata.
- NCC-07: Service Capability Manifest.
- NCC-08: Service Identity Rotation and Handover.
- NCC-09: Scoped Operator Authority.

## Abstract

This Nostr Community Convention defines package-manager semantics for software releases represented using existing Nostr release primitives.

NCC-13 does not introduce a new release event. Instead, it profiles the existing NIP-51 Release Artifact Set:

```
kind:30063
```

and defines interoperable metadata for:

- software versions
- version comparison schemes
- release channels
- package dependencies
- package conflicts
- operating-system compatibility
- architecture compatibility
- package format
- source repository provenance
- source commit provenance

Existing Nostr objects continue to provide:

```
kind:32267   Software Application
kind:30063   Release Artifact Set
kind:1063    File Metadata
kind:30617   Git Repository Announcement
```

NCC-13 allows package managers to interpret these objects as installable software releases without defining installation behaviour itself.

## 1. Purpose

NIP-51 already allows a software release to group multiple artefacts. For example:

```
Software Application
        |
        v
Release Artifact Set
        |
        +-- Windows artefact
        +-- macOS artefact
        +-- Linux artefact
```

However, generic release artefact grouping does not answer all questions required by a package manager. A package manager also needs to determine:

- which version a release represents
- how versions are compared
- whether the release is stable or pre-release
- whether an artefact is compatible with the local platform
- what other software the package requires
- whether packages conflict
- which source revision a release claims to derive from

NCC-13 addresses the question: "How should a package manager interpret this NIP-51 software release?"

## 2. Design Principle

NCC-13 is a profile over existing Nostr objects. It MUST NOT redefine functionality already provided by a NIP.

The intended model is:

```
kind:32267
Software Application
        |
        v
kind:30063
Release Artifact Set
        |
        +----------------------+
        |                      |
        v                      v
kind:1063                  kind:30617
File Metadata              Git Repository
        |                      |
        |                      +-- source commit
        |
        +-- platform
        +-- architecture
        +-- package format

NCC-13 adds:
        version semantics
        channel semantics
        dependency semantics
        compatibility semantics
        provenance semantics
```

## 3. Non-Goals

NCC-13 does not define:

- software application identity
- release artefact grouping
- file hashes
- file URLs
- file sizes
- MIME types
- blob storage
- Git repository identity
- release notes
- installation scripts
- filesystem layout
- package installation behaviour
- package removal behaviour
- dependency-solving algorithms
- central package registries
- vulnerability databases
- reproducible-build verification
- CI systems
- build systems
- software sandboxing
- application permissions

These concerns are either already handled by existing NIPs or belong to package managers and other specifications.

## 4. Existing Nostr Objects

### 4.1 Software Application

The software package identity is the referenced:

```
kind:32267
```

Software Application event. Its NIP-01 address is:

```
32267:<publisher-pubkey>:<application-id>
```

NCC-13 does not create a separate package identity.

### 4.2 Release Artifact Set

A package release is represented by:

```
kind:30063
```

as defined by NIP-51. A conforming NCC-13 release MUST reference exactly one parent Software Application using an `a` tag.

Example:

```
["a", "32267:<publisher-pubkey>:com.example.app"]
```

The Release Artifact Set MAY reference one or more NIP-94 File Metadata events using `e` tags.

### 4.3 File Metadata

Individual distributable artefacts remain:

```
kind:1063
```

NIP-94 File Metadata events. NCC-13 does not redefine:

- hashes
- file locations
- file sizes
- MIME types

NCC-13 only defines additional package-selection metadata associated with those artefacts.

### 4.4 Git Repository

Where source provenance is provided, a package MAY reference a NIP-34 repository announcement:

```
kind:30617
```

NCC-13 does not redefine repository identity or Git behaviour.

## 5. Release Identifier

NIP-51 Release Artifact Sets are addressable events and require a `d` identifier. NCC-13 RECOMMENDS:

```
<application-id>@<version>
```

Example:

```
com.example.app@1.4.2
```

A complete release address therefore resembles:

```
30063:<publisher-pubkey>:com.example.app@1.4.2
```

The `d` value identifies the release object. The explicit `version` tag defined below remains authoritative for NCC-13 version interpretation.

## 6. Required NCC-13 Release Metadata

An NCC-13-compatible Release Artifact Set MUST contain:

```
["version", "<version>"]
```

It SHOULD contain:

```
["version_scheme", "<scheme>"]
["channel", "<channel>"]
```

Example:

```
[
  ["d", "com.example.app@1.4.2"],
  ["a", "32267:<publisher>:com.example.app"],
  ["version", "1.4.2"],
  ["version_scheme", "semver"],
  ["channel", "stable"]
]
```

## 7. Version

The `version` tag identifies the software version represented by the release.

Example:

```
["version", "1.4.2"]
```

The version string MUST be interpreted according to the declared `version_scheme`. Package managers MUST NOT assume that arbitrary version strings are SemVer.

## 8. Version Schemes

The `version_scheme` tag defines comparison semantics. NCC-13 defines:

```
semver
calver
opaque
```

### 8.1 `semver`

Example:

```
["version", "1.4.2"]
["version_scheme", "semver"]
```

The value follows Semantic Versioning comparison semantics. Package managers supporting NCC-13 SHOULD support `semver`.

### 8.2 `calver`

Example:

```
["version", "2026.09.1"]
["version_scheme", "calver"]
```

The publisher declares the release as calendar-versioned. NCC-13 does not define a universal CalVer field structure. Consumers MAY compare CalVer versions only when they support the publisher's chosen compatible CalVer form.

### 8.3 `opaque`

Example:

```
["version", "phoenix-7"]
["version_scheme", "opaque"]
```

Opaque versions MUST NOT be ordered by generic clients. A client may:

- test equality
- display the value
- use application-specific comparison rules

but MUST NOT infer:

```
phoenix-8 > phoenix-7
```

without a separately defined ordering rule.

### 8.4 Missing Version Scheme

If `version_scheme` is absent, clients MUST treat the version as:

```
opaque
```

This avoids unsafe version-order assumptions.

## 9. Release Channels

The optional `channel` tag identifies the intended release stream.

Example:

```
["channel", "stable"]
```

NCC-13 defines conventional channel names:

```
stable
beta
alpha
nightly
```

Publishers MAY define additional channel names. Unknown channels MUST remain valid. Clients MUST NOT automatically treat unknown channels as equivalent to `stable`.

### 9.1 Default Channel

If no `channel` tag is present, clients SHOULD treat the release as belonging to:

```
stable
```

unless the Software Application or local policy explicitly defines otherwise.

## 10. Dependencies

Package dependencies are expressed using:

```
["requires", "<software-address>", "<version-constraint>"]
```

Example:

```
["requires",
 "32267:<publisher>:com.example.runtime",
 ">=2.0.0"]
```

The first value MUST be the address of a Software Application. The constraint MUST be interpreted using the dependency application's applicable version scheme.

## 11. Optional Dependencies

Optional dependencies use:

```
["optional", "<software-address>", "<version-constraint>"]
```

Example:

```
["optional",
 "32267:<publisher>:com.example.media",
 ">=1.0.0"]
```

Failure to satisfy an optional dependency MUST NOT, by itself, make the package uninstallable under NCC-13. The application MAY expose reduced functionality.

## 12. Conflicts

Package conflicts use:

```
["conflicts", "<software-address>", "<version-constraint>"]
```

Example:

```
["conflicts",
 "32267:<publisher>:com.example.legacy",
 "<2.0.0"]
```

A package manager SHOULD NOT install a release while a matching conflicting release is present. NCC-13 does not define how conflicts are automatically resolved.

## 13. Version Constraints

For dependencies using `semver`, clients SHOULD support:

```
=
>
>=
<
<=
```

Examples:

```
>=2.0.0
<3.0.0
=1.4.2
```

Multiple constraints for the same dependency are cumulative.

Example:

```
["requires", "<software>", ">=2.0.0"]
["requires", "<software>", "<3.0.0"]
```

means:

```
>=2.0.0 AND <3.0.0
```

NCC-13 v0.1 does not define:

- caret ranges
- tilde ranges
- wildcard ranges
- Boolean OR expressions
- arbitrary dependency expressions

This intentionally keeps dependency interpretation small and deterministic.

## 14. Dependency Resolution

NCC-13 defines dependency declarations. It does not define the dependency-solving algorithm. A package manager MAY use:

- simple recursive resolution
- SAT solving
- repository-specific policy
- administrator intervention

provided the resulting installation satisfies all recognised mandatory dependency and conflict declarations.

## 15. Platform Metadata

Package-selection metadata SHOULD be placed on the individual NIP-94 File Metadata artefact rather than on the Release Artifact Set. NCC-13 defines the following optional tags:

```
["os", "<operating-system>"]
["arch", "<architecture>"]
["format", "<package-format>"]
```

## 16. Operating System

Examples:

```
["os", "linux"]
["os", "windows"]
["os", "macos"]
["os", "android"]
["os", "ios"]
["os", "any"]
```

`any` means the artefact is not restricted to a specific operating system. Unknown OS values are permitted.

## 17. Architecture

Examples:

```
["arch", "amd64"]
["arch", "arm64"]
["arch", "armv7"]
["arch", "riscv64"]
["arch", "wasm32"]
["arch", "any"]
```

`any` means architecture-independent. Clients MUST NOT assume that an unknown architecture is compatible.

## 18. Package Format

The optional `format` tag identifies the artefact packaging format.

Examples:

```
["format", "deb"]
["format", "rpm"]
["format", "apk"]
["format", "appimage"]
["format", "flatpak"]
["format", "tar.gz"]
["format", "zip"]
["format", "wasm"]
```

Package formats are descriptive identifiers. NCC-13 does not define how any package format is installed.

## 19. Artefact Selection

Given multiple artefacts in a Release Artifact Set, a package manager SHOULD select an artefact matching:

1. local operating system
2. local architecture
3. supported package format
4. local package-manager policy

Example:

```
Release 1.4.2
   |
   +-- linux / amd64 / deb
   +-- linux / arm64 / deb
   +-- linux / amd64 / tar.gz
   +-- windows / amd64 / exe
```

A Debian-based ARM64 system would normally select:

```
linux / arm64 / deb
```

provided the referenced artefact passes normal NIP-94 verification.

## 20. Generic Artefacts

An artefact MAY use:

```
["os", "any"]
["arch", "any"]
```

for platform-independent releases. Examples may include:

- JavaScript packages
- source archives
- portable WASM modules
- platform-independent data packages

Package managers SHOULD prefer a more specifically compatible artefact over a generic one when both are otherwise equivalent.

## 21. Source Repository Provenance

A Release Artifact Set MAY reference the source repository using:

```
["source", "30617:<publisher>:<repository-id>"]
```

The value MUST be a valid NIP-01 address for a NIP-34 Repository Announcement.

Example:

```
["source",
 "30617:<publisher>:example-app"]
```

This asserts: "This release claims to derive from this source repository."

## 22. Source Commit

Where a source repository is specified, the release MAY include:

```
["commit", "<git-object-id>"]
```

Example:

```
["commit", "7f83b1657ff1fc53b92dc18148a1d65dfa13514f"]
```

The commit identifies the source revision from which the publisher claims the release was produced.

## 23. Provenance Semantics

A valid source repository and commit declaration establishes a signed publisher claim:

```
release R
claims to derive from
repository S
at commit C
```

It does not prove:

```
artefact bytes were reproducibly built from commit C
```

That requires independent build or reproducibility evidence. Clients MUST distinguish:

```
claimed source provenance
```

from:

```
verified reproducible build
```

## 24. Example NCC-13 Release

```json
{
  "kind": 30063,
  "pubkey": "<publisher-pubkey>",
  "created_at": 1790380000,
  "tags": [
    ["d", "com.example.app@1.4.2"],

    ["a",
     "32267:<publisher-pubkey>:com.example.app"],

    ["version", "1.4.2"],
    ["version_scheme", "semver"],
    ["channel", "stable"],

    ["source",
     "30617:<publisher-pubkey>:example-app"],
    ["commit",
     "7f83b1657ff1fc53b92dc18148a1d65dfa13514f"],

    ["requires",
     "32267:<runtime-publisher>:com.example.runtime",
     ">=2.0.0"],

    ["conflicts",
     "32267:<legacy-publisher>:com.example.legacy",
     "<2.0.0"],

    ["e", "<linux-amd64-file-metadata-event>"],
    ["e", "<linux-arm64-file-metadata-event>"],
    ["e", "<windows-file-metadata-event>"]
  ],
  "content": "Release notes in Markdown"
}
```

## 25. Example Artefact Metadata

A referenced NIP-94 artefact may include NCC-13 selectors:

```json
{
  "kind": 1063,
  "pubkey": "<publisher-pubkey>",
  "created_at": 1790380000,
  "tags": [
    ["url", "https://example.com/example_1.4.2_amd64.deb"],
    ["x", "<sha256>"],
    ["m", "application/vnd.debian.binary-package"],
    ["size", "4829102"],

    ["os", "linux"],
    ["arch", "amd64"],
    ["format", "deb"]
  ],
  "content": ""
}
```

The file identity, hash and location remain NIP-94 concerns. The `os`, `arch` and `format` tags provide NCC-13 package-selection semantics.

## 26. Release Discovery

A package manager begins with the Software Application address:

```
32267:<publisher>:<application-id>
```

It may then query relays for:

```
kind:30063
```

Release Artifact Sets referencing that application. Conceptually:

```
Software Application
        |
        +-- 1.3.0 stable
        +-- 1.4.0 stable
        +-- 1.4.2 stable
        +-- 1.5.0 beta
```

The package manager then applies:

- channel policy
- version rules
- compatibility rules
- dependency rules
- local trust policy

to choose a release.

## 27. Upgrade Selection

For ordered version schemes, a package manager MAY select the greatest compatible version within the configured channel.

Example:

```
installed:
1.4.1

available:
1.4.1 stable
1.4.2 stable
1.5.0 beta

selected channel:
stable
```

The upgrade candidate is:

```
1.4.2
```

NCC-13 does not require automatic installation.

## 28. Downgrades

A package manager MAY install an older release where local policy permits. NCC-13 does not prohibit downgrades. Clients SHOULD clearly distinguish:

```
upgrade
downgrade
same-version reinstall
```

when version ordering is available.

## 29. Mutable Release Events

Because `kind:30063` is addressable, publishers may replace a Release Artifact Set having the same address. Package managers MUST apply normal addressable-event replacement semantics. Publishers SHOULD NOT silently change artefact bytes while keeping the same version identifier. If artefact contents materially change, the publisher SHOULD issue a new release version.

## 30. Artefact Integrity

NCC-13 relies on NIP-94 hashes for artefact integrity. Before installation, clients SHOULD verify the downloaded bytes against the referenced NIP-94 cryptographic hash. A matching hash proves that the downloaded bytes match the referenced artefact metadata. It does not prove that the software is safe or trustworthy.

## 31. Publisher Identity

The signature of the Release Artifact Set identifies the event publisher. NCC-13 does not itself establish whether that publisher is trusted. Applications MAY use:

- local trust
- NCC trust conventions
- application-specific policy
- external attestations

when deciding whether to install software.

## 32. Relationship to NCC-08

Long-lived software projects may rotate identity. Where NCC-08 establishes:

```
publisher A -> publisher B
```

a package manager MAY recognise publisher B as the successor identity for the software project after validating the NCC-08 handover. The new publisher SHOULD issue new Software Application and Release Artifact Set events under the successor identity. NCC-13 does not itself establish identity continuity.

## 33. Relationship to NCC-09

NCC-13 explicitly supports NCC-09 operator publication. The NCC-09 scope is:

```
ncc:13:publish
```

A project identity MAY authorise a release system, CI agent or package automation key to publish NCC-13-compatible Release Artifact Sets. The operator MUST sign using its own key. The release event MUST identify the principal using:

```
["operator_for",
 "<project-pubkey>",
 "<application-id>"]
```

A supporting package manager MUST validate the NCC-09 grant before treating an operator-published release as authorised for the project.

## 34. CI and Release Automation

NCC-09 integration allows:

```
project root key
       |
       | NCC-09
       | ncc:13:publish
       v
release automation
       |
       v
kind:30063
```

This allows the durable project identity key to remain offline while release automation uses a narrowly scoped operational key. NCC-13 does not require CI automation.

## 35. Build Attestations

NCC-13 does not define build attestations. An implementation MAY associate:

- CI attestations
- reproducible-build proofs
- third-party signatures
- security review attestations

with a release using other conventions or specifications. Such evidence MUST NOT be confused with the release publisher's own source provenance claim.

## 36. Package Catalogues

NCC-13 does not require a central package catalogue. A catalogue MAY index Software Application and Release Artifact Set events to improve discovery. The underlying objects remain independently resolvable Nostr events. Therefore:

```
catalogue
```

may provide:

```
discovery
curation
search
ranking
policy
```

without becoming the authoritative source of release identity.

## 37. Relationship to NIP-51

NIP-51 defines:

```
kind:30063
Release Artifact Set
```

including references to:

```
kind:1063
File Metadata
```

and:

```
kind:32267
Software Application
```

NCC-13 does not redefine those relationships. It adds package-manager interpretation to them.

## 38. Relationship to NIP-94

NIP-94 remains authoritative for file metadata including:

- file URL
- cryptographic hash
- MIME type
- file size
- other general file properties

NCC-13 adds:

```
os
arch
format
```

as package-selection metadata.

## 39. Relationship to NIP-34

NIP-34 remains authoritative for Git repository announcements and repository state. NCC-13 MAY reference a NIP-34 repository and Git commit for source provenance. It does not alter Git collaboration semantics.

## 40. Relationship to NCC-07

A package-distribution service MAY advertise:

```
["cap", "ncc:13"]
```

through NCC-07. This means the service claims support for NCC-13 package-release semantics. Capability advertisement is not required for an individual release to conform.

## 41. Unsupported Metadata

Clients MUST safely ignore NCC-13 tags they do not understand. For example, a future extension:

```
["target", "gpu:nvidia"]
```

MUST NOT invalidate an otherwise valid release for clients that do not understand the tag. However, unknown compatibility constraints MUST NOT be assumed to match the local system.

## 42. Security Considerations

### 42.1 Signed Does Not Mean Safe

A valid release signature proves authorship. It does not prove that software is:

- safe
- correct
- non-malicious
- audited
- vulnerability-free

### 42.2 Hash Verification

Package managers SHOULD verify all artefact hashes before installation. Failure to match the referenced NIP-94 hash MUST cause the artefact to be rejected.

### 42.3 Malicious Dependencies

Publishers may declare malicious or misleading dependencies. Dependency declarations MUST NOT automatically grant additional trust to dependency publishers. Each dependency must be independently evaluated.

### 42.4 Publisher Compromise

An attacker controlling a software publisher key may publish malicious releases. NCC-13 cannot protect against compromise of the authoritative project identity. Scoped NCC-09 operator keys may reduce exposure of durable root keys.

### 42.5 Operator Compromise

An attacker controlling an authorised `ncc:13:publish` operator may publish releases while that authority remains active. Project identities SHOULD:

- narrowly scope release authority
- expire operator grants where appropriate
- revoke compromised operator keys promptly

### 42.6 Dependency Confusion

Dependencies reference complete Software Application addresses. Package managers MUST NOT resolve dependencies using only human-readable package names. For example:

```
com.example.runtime
```

alone is insufficient. The dependency identity is:

```
32267:<publisher-pubkey>:com.example.runtime
```

This prevents package-name collisions from automatically changing dependency identity.

### 42.7 Source Provenance

A `source` and `commit` declaration is a signed claim. Clients MUST NOT present it as verified reproducible-build evidence unless additional verification has occurred.

## 43. Privacy Considerations

Software releases are normally public. NCC-13 metadata may reveal:

- dependency relationships
- supported platforms
- deployment targets
- release infrastructure
- source repository locations

Publishers SHOULD avoid unnecessary metadata where disclosure would create operational risk. NCC-13 does not define private package releases.

## 44. Minimal Publisher Conformance

A release publisher conforms to NCC-13 if the release:

1. uses NIP-51 `kind:30063`
2. references exactly one `kind:32267` Software Application
3. includes a `version` tag
4. provides valid references to distributable NIP-94 artefacts where applicable
5. uses NCC-13 dependency syntax when declaring dependencies
6. uses NCC-13 compatibility metadata when platform-specific artefact selection is required
7. does not redefine existing NIP-51 or NIP-94 metadata semantics

## 45. Minimal Client Conformance

A package manager conforms to NCC-13 if it:

1. resolves NIP-51 Release Artifact Sets
2. identifies their parent Software Application
3. interprets the `version` field
4. treats missing `version_scheme` as `opaque`
5. understands `semver`
6. understands release channels
7. validates mandatory dependency declarations
8. respects conflicts
9. selects compatible artefacts using `os`, `arch` and `format`
10. verifies referenced artefact hashes before installation
11. safely ignores unknown optional metadata
12. does not assume unknown compatibility constraints are satisfied

## 46. Why This Is an NCC

The Nostr protocol already contains the primitives needed to represent:

- software
- releases
- artefacts
- source repositories

The missing layer is shared package-manager interpretation. NCC-13 therefore does not require relay changes or new protocol primitives. Relays only store ordinary Nostr events. Package semantics remain client-side.

## 47. Design Rationale

NCC-13 deliberately avoids introducing another release event. The existing Nostr stack already provides:

```
32267  Software Application
30063  Release Artifact Set
1063   File Metadata
30617  Git Repository Announcement
```

Duplicating those objects would fragment implementations. NCC-13 instead standardises the missing relationship between a generic software release and package-management behaviour. The convention keeps dependency declarations simple and avoids defining an installer or dependency solver.

This allows different package ecosystems to share the same release metadata while retaining their own installation mechanisms. A Debian package manager, WASM runtime, Nostr application catalogue or decentralised package manager may all interpret the same release graph differently while agreeing on:

- software identity
- version
- dependency identity
- compatibility
- artefact integrity
- source provenance

The core design principle is: NCC-13 defines how package managers interpret existing Nostr software releases. It does not redefine the release objects or define how software is installed.

## 48. Status

NCC-13 is experimental. Implementers are encouraged to:

- reuse NIP-51 Release Artifact Sets
- reuse NIP-94 File Metadata
- reuse NIP-34 repository identities
- use complete Nostr addresses for dependency identity
- use SemVer where practical
- keep dependency syntax simple
- verify artefact hashes
- distinguish claimed provenance from reproducible-build proof
- use NCC-09 scoped release operators rather than exposing durable project keys
- avoid central package registries becoming authoritative identity stores

If NCC-13 is not implemented, existing NIP-51 software release behaviour remains unchanged.

## Reference Implementation

- [`ncc-13-js/`](ncc-13-js/) — TypeScript library built on `nostr-tools` implementing release building/parsing, addressable-event replacement, version comparison and constraint evaluation, dependency/conflict evaluation, and platform-based artefact selection.
