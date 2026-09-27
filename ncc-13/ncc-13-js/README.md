# ncc-13-js

Minimal reference implementation of [NCC-13: Software Package Release Profile](../README.md) in TypeScript, built on [`nostr-tools`](https://github.com/nbd-wtf/nostr-tools).

## Install

```bash
npm install
npm run build
```

## Usage

### Publisher: build a release

```ts
import { generateSecretKey } from 'nostr-tools';
import { buildReleaseArtifactSet, formatAddress, KIND_SOFTWARE_APPLICATION, KIND_GIT_REPOSITORY } from 'ncc-13-js';

const publisherSk = generateSecretKey();
const appAddress = formatAddress(KIND_SOFTWARE_APPLICATION, '<publisher-pubkey-hex>', 'com.example.app');

const release = buildReleaseArtifactSet({
  secretKey: publisherSk,
  applicationAddress: appAddress,
  version: '1.4.2',
  versionScheme: 'semver',
  channel: 'stable',
  source: formatAddress(KIND_GIT_REPOSITORY, '<publisher-pubkey-hex>', 'example-app'),
  commit: '7f83b1657ff1fc53b92dc18148a1d65dfa13514f',
  requires: [{ address: '32267:<runtime-publisher>:com.example.runtime', constraint: '>=2.0.0' }],
  conflicts: [{ address: '32267:<legacy-publisher>:com.example.legacy', constraint: '<2.0.0' }],
  fileEventIds: ['<linux-amd64-file-metadata-event-id>', '<windows-file-metadata-event-id>']
});

// publish `release` to relays with your preferred client/pool
```

### Client: parse a release and resolve the current one

```ts
import { parseRelease, resolveCurrentRelease, effectiveChannel } from 'ncc-13-js';

const candidates = rawEvents.map(parseRelease).filter((r): r is NonNullable<typeof r> => r !== null);
const current = resolveCurrentRelease(candidates);

if (current) {
  console.log(current.version, effectiveChannel(current));
}
```

### Client: version comparison and constraints

```ts
import { compareVersions, parseVersionConstraint, satisfiesConstraints } from 'ncc-13-js';

compareVersions('1.4.2', '1.4.1', 'semver'); // 1

const constraints = ['>=2.0.0', '<3.0.0'].map((c) => parseVersionConstraint(c)!);
satisfiesConstraints('2.5.0', constraints, 'semver'); // true
```

`compareVersions` throws for `opaque` versions (NCC-13 §8.3) rather than guessing an order — only test opaque versions for equality.

### Client: dependency and conflict evaluation

```ts
import { evaluateDependencies, evaluateConflicts, indexInstalled } from 'ncc-13-js';

const installed = indexInstalled([
  { applicationAddress: '32267:<runtime-publisher>:com.example.runtime', version: '2.3.0', versionScheme: 'semver' }
]);

const deps = evaluateDependencies(current, installed);
if (!deps.allRequiredSatisfied) {
  // missing or version-mismatched `requires` entries are in deps.requires
}

const conflicts = evaluateConflicts(current, installed);
if (conflicts.some((c) => c.conflicting)) {
  // a conflicting package is installed; SHOULD NOT install this release
}
```

### Client: artefact selection by platform

```ts
import { selectArtifact } from 'ncc-13-js';

const artefact = selectArtifact(fileMetadataEvents, {
  os: 'linux',
  arch: 'arm64',
  formats: ['deb', 'tar.gz'] // in preference order
});

if (artefact) {
  // artefact.event is the selected kind:1063 File Metadata event
}
```

## What this implements

- `buildReleaseArtifactSet` — construct and sign a `kind:30063` Release Artifact Set (NCC-13 §6), enforcing a well-formed parent application address, the recommended `<application-id>@<version>` `d` identifier (§5), and that `commit` is never declared without a `source` repository (§22).
- `parseRelease` — verify an event's signature and structure, returning `null` for anything that isn't a conformant release rather than throwing; defaults a missing `version_scheme` to `opaque` (§8.4).
- `effectiveChannel` — the effective release channel, defaulting to `stable` when no `channel` tag is present (§9.1).
- `resolveCurrentRelease` — NIP-01 addressable-event replacement semantics over candidate releases sharing the same address (§29): highest `created_at` wins, event id breaks ties.
- `compareVersions` / `compareSemVer` / `compareDottedNumeric` — version ordering for `semver`, and a best-effort dotted-numeric comparison usable for common `calver` forms (§8.1-§8.2). Throws for `opaque` versions rather than assuming an order (§8.3).
- `parseVersionConstraint` / `satisfiesConstraint` / `satisfiesConstraints` — the `=`/`>`/`>=`/`<`/`<=` constraint grammar from §13, with cumulative (AND) semantics across multiple constraints on the same dependency.
- `evaluateDependencies` / `evaluateConflicts` — check a release's `requires`/`optional`/`conflicts` declarations against a set of installed packages (§10-§12). Does not implement dependency resolution or installation (§14).
- `selectArtifact` — pick the best-matching `kind:1063` artefact for a target `os`/`arch`/preferred `format`s, treating `"any"` (or an absent tag) as unrestricted and preferring a more specific match over a generic one (§19-§20).

This library intentionally does not implement package installation, removal, dependency-solving algorithms, trust policy, or NCC-09 operator-grant validation for release publication — those are explicitly out of scope for NCC-13 (§3) or belong to the specifications that already define them.

## Tests

```bash
npm install
npm test
```

The test suite runs entirely in-memory and checks the build/parse/resolve round trip, version comparison and constraint evaluation (including the opaque-ordering refusal), default channel and version-scheme fallbacks, dependency/optional/conflict evaluation, and platform-based artefact selection against the spec's worked examples.
