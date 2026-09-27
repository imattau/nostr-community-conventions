/**
 * NCC-13: Software Package Release Profile
 *
 * This library implements the NCC-13 profile over existing Nostr release
 * primitives: building and parsing kind:30063 Release Artifact Sets with
 * package-manager metadata (version, version scheme, channel, dependencies,
 * conflicts, source provenance), resolving the current release for an
 * address, comparing/constraining versions, and selecting a compatible
 * kind:1063 artefact by os/arch/format.
 *
 * NCC-13 does not define a new event kind and does not implement
 * installation behaviour, dependency solving, or trust policy.
 *
 * @module ncc-13-js
 */

import { finalizeEvent, verifyEvent, Event, UnsignedEvent, getPublicKey } from 'nostr-tools';

export const KIND_SOFTWARE_APPLICATION = 32267;
export const KIND_RELEASE_ARTIFACT_SET = 30063;
export const KIND_FILE_METADATA = 1063;
export const KIND_GIT_REPOSITORY = 30617;

// --- Error classes ---

export class NCC13Error extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'NCC13Error';
    }
}

export class NCC13ArgumentError extends NCC13Error {
    constructor(message: string) {
        super(message);
        this.name = 'NCC13ArgumentError';
    }
}

// --- Tag helpers ---

function firstTagValue(event: Event, name: string): string | undefined {
    return event.tags.find((t) => t[0] === name)?.[1];
}

function allTagRows(event: Event, name: string): string[][] {
    return event.tags.filter((t) => t[0] === name);
}

function allTagValues(event: Event, name: string): string[] {
    return allTagRows(event, name).map((t) => t[1]);
}

// --- NIP-01 addressable-event addresses ---

export interface NostrAddress {
    kind: number;
    pubkey: string;
    identifier: string;
}

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;

/** Parse a `kind:pubkey:identifier` address (NIP-01 `a` tag value). */
export function parseAddress(address: string): NostrAddress | null {
    const parts = address.split(':');
    if (parts.length < 3) return null;
    const kind = Number(parts[0]);
    const pubkey = parts[1];
    const identifier = parts.slice(2).join(':');
    if (!Number.isInteger(kind) || kind < 0) return null;
    if (!HEX_PUBKEY_RE.test(pubkey)) return null;
    return { kind, pubkey, identifier };
}

/** Build a `kind:pubkey:identifier` address string. */
export function formatAddress(kind: number, pubkey: string, identifier: string): string {
    return `${kind}:${pubkey}:${identifier}`;
}

/**
 * Build the NCC-13 §5 recommended `d` identifier for a release:
 * `<application-id>@<version>`.
 */
export function releaseIdentifier(applicationId: string, version: string): string {
    return `${applicationId}@${version}`;
}

// --- Version schemes (NCC-13 section 8) ---

export type VersionScheme = 'semver' | 'calver' | 'opaque';

export interface SemVer {
    major: number;
    minor: number;
    patch: number;
    prerelease: (string | number)[];
}

/** Parse a SemVer-shaped version string (`MAJOR.MINOR.PATCH[-prerelease][+build]`). */
export function parseSemVer(version: string): SemVer | null {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
    if (!m) return null;
    const prerelease = m[4] ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [];
    return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease };
}

function comparePrereleaseIdentifiers(a: (string | number)[], b: (string | number)[]): number {
    // SemVer 2.0.0 §11: a version with a prerelease has lower precedence than
    // one without; otherwise compare identifiers left to right.
    if (a.length === 0 && b.length === 0) return 0;
    if (a.length === 0) return 1;
    if (b.length === 0) return -1;
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
        if (i >= a.length) return -1;
        if (i >= b.length) return 1;
        const x = a[i];
        const y = b[i];
        if (typeof x === 'number' && typeof y === 'number') {
            if (x !== y) return x < y ? -1 : 1;
            continue;
        }
        if (typeof x === 'number') return -1;
        if (typeof y === 'number') return 1;
        if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
}

/** Compare two SemVer versions. Returns -1, 0, or 1. */
export function compareSemVer(a: SemVer, b: SemVer): number {
    if (a.major !== b.major) return a.major < b.major ? -1 : 1;
    if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
    if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
    return comparePrereleaseIdentifiers(a.prerelease, b.prerelease);
}

/**
 * Compare two dot-separated, all-numeric version strings (used for a best-
 * effort `calver` comparison per NCC-13 §8.2, when both versions match this
 * common CalVer shape). Returns null if either string isn't purely
 * dot-separated integers.
 */
export function compareDottedNumeric(a: string, b: string): number | null {
    const pa = a.split('.');
    const pb = b.split('.');
    if (!pa.every((p) => /^\d+$/.test(p)) || !pb.every((p) => /^\d+$/.test(p))) return null;
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const na = i < pa.length ? Number(pa[i]) : 0;
        const nb = i < pb.length ? Number(pb[i]) : 0;
        if (na !== nb) return na < nb ? -1 : 1;
    }
    return 0;
}

/**
 * Compare two version strings under the given scheme. Returns -1, 0, or 1.
 *
 * Per NCC-13 §8.3/§8.4, `opaque` versions MUST NOT be ordered by generic
 * clients: this throws NCC13Error rather than guessing an order. Callers
 * that only need equality on an opaque version should compare the strings
 * directly instead of calling this function.
 */
export function compareVersions(a: string, b: string, scheme: VersionScheme): number {
    if (scheme === 'semver') {
        const sa = parseSemVer(a);
        const sb = parseSemVer(b);
        if (!sa || !sb) throw new NCC13ArgumentError(`version is not valid semver: "${!sa ? a : b}"`);
        return compareSemVer(sa, sb);
    }
    if (scheme === 'calver') {
        const cmp = compareDottedNumeric(a, b);
        if (cmp === null) {
            throw new NCC13Error(
                'calver comparison is only supported for dot-separated numeric forms the client recognises (NCC-13 §8.2)'
            );
        }
        return cmp;
    }
    throw new NCC13Error('opaque versions MUST NOT be ordered by generic clients (NCC-13 §8.3)');
}

// --- Version constraints (NCC-13 section 13) ---

export interface VersionConstraint {
    operator: '=' | '>' | '>=' | '<' | '<=';
    version: string;
}

const CONSTRAINT_RE = /^(=|>=|<=|>|<)\s*(.+)$/;

/** Parse a single constraint string such as `">=2.0.0"`. */
export function parseVersionConstraint(constraint: string): VersionConstraint | null {
    const m = CONSTRAINT_RE.exec(constraint.trim());
    if (!m) return null;
    return { operator: m[1] as VersionConstraint['operator'], version: m[2].trim() };
}

/** Test whether `version` satisfies a single constraint under `scheme`. */
export function satisfiesConstraint(version: string, constraint: VersionConstraint, scheme: VersionScheme): boolean {
    const cmp = compareVersions(version, constraint.version, scheme);
    switch (constraint.operator) {
        case '=':
            return cmp === 0;
        case '>':
            return cmp > 0;
        case '>=':
            return cmp >= 0;
        case '<':
            return cmp < 0;
        case '<=':
            return cmp <= 0;
    }
}

/**
 * Test whether `version` satisfies every constraint (cumulative AND, per
 * NCC-13 §13).
 */
export function satisfiesConstraints(version: string, constraints: VersionConstraint[], scheme: VersionScheme): boolean {
    return constraints.every((c) => satisfiesConstraint(version, c, scheme));
}

// --- Dependency declarations (NCC-13 sections 10-12) ---

export interface DependencyDeclaration {
    /** Full Software Application address, e.g. `32267:<pubkey>:<app-id>`. */
    address: string;
    constraint: string;
}

// --- Release Artifact Set (NCC-13 section 6) ---

export interface ReleaseArtifactSetOptions {
    /** Publisher secret key. */
    secretKey: Uint8Array;
    /** Full `kind:32267` Software Application address. */
    applicationAddress: string;
    version: string;
    versionScheme?: VersionScheme;
    channel?: string;
    /** Overrides the recommended `<application-id>@<version>` `d` identifier. */
    dId?: string;
    /** Full `kind:30617` Git Repository Announcement address. */
    source?: string;
    /** Git commit object id the release claims to derive from. */
    commit?: string;
    requires?: DependencyDeclaration[];
    optional?: DependencyDeclaration[];
    conflicts?: DependencyDeclaration[];
    /** Event ids of referenced kind:1063 File Metadata artefacts. */
    fileEventIds?: string[];
    content?: string;
    createdAt?: number;
}

function requireAddressKind(address: string, kind: number, label: string): NostrAddress {
    const parsed = parseAddress(address);
    if (!parsed) throw new NCC13ArgumentError(`${label} is not a valid Nostr address: "${address}"`);
    if (parsed.kind !== kind) throw new NCC13ArgumentError(`${label} must reference kind ${kind}, got kind ${parsed.kind}`);
    return parsed;
}

/**
 * Build and sign a kind:30063 Release Artifact Set per NCC-13 section 6.
 */
export function buildReleaseArtifactSet(opts: ReleaseArtifactSetOptions): Event {
    const { secretKey, applicationAddress, version, content, createdAt } = opts;

    if (!version) throw new NCC13ArgumentError('version is required (NCC-13 §6)');
    const app = requireAddressKind(applicationAddress, KIND_SOFTWARE_APPLICATION, 'applicationAddress');

    if (opts.source) requireAddressKind(opts.source, KIND_GIT_REPOSITORY, 'source');
    if (opts.commit && !opts.source) {
        throw new NCC13ArgumentError('commit requires a source repository to be specified (NCC-13 §22)');
    }

    const dId = opts.dId ?? releaseIdentifier(app.identifier, version);

    const tags: string[][] = [
        ['d', dId],
        ['a', applicationAddress],
        ['version', version]
    ];

    if (opts.versionScheme) tags.push(['version_scheme', opts.versionScheme]);
    if (opts.channel) tags.push(['channel', opts.channel]);
    if (opts.source) tags.push(['source', opts.source]);
    if (opts.commit) tags.push(['commit', opts.commit]);

    for (const dep of opts.requires ?? []) tags.push(['requires', dep.address, dep.constraint]);
    for (const dep of opts.optional ?? []) tags.push(['optional', dep.address, dep.constraint]);
    for (const dep of opts.conflicts ?? []) tags.push(['conflicts', dep.address, dep.constraint]);
    for (const id of opts.fileEventIds ?? []) tags.push(['e', id]);

    const unsigned: UnsignedEvent = {
        kind: KIND_RELEASE_ARTIFACT_SET,
        pubkey: getPublicKey(secretKey),
        created_at: createdAt ?? Math.floor(Date.now() / 1000),
        tags,
        content: content ?? ''
    };

    return finalizeEvent(unsigned, secretKey);
}

// --- Parsing ---

export interface ParsedRelease {
    publisherPubkey: string;
    dId: string;
    applicationAddress: string;
    version: string;
    /** Declared scheme, or 'opaque' if absent (NCC-13 §8.4). */
    versionScheme: VersionScheme;
    /** Raw `channel` tag value, if present. */
    channel?: string;
    source?: string;
    commit?: string;
    requires: DependencyDeclaration[];
    optional: DependencyDeclaration[];
    conflicts: DependencyDeclaration[];
    fileEventIds: string[];
    createdAt: number;
    event: Event;
}

/**
 * The effective release channel per NCC-13 §9.1: the declared `channel`,
 * or `"stable"` when absent.
 */
export function effectiveChannel(release: ParsedRelease): string {
    return release.channel ?? 'stable';
}

function parseDependencyRows(event: Event, name: string): DependencyDeclaration[] {
    return allTagRows(event, name)
        .filter((row) => row.length >= 3 && parseAddress(row[1]) !== null)
        .map((row) => ({ address: row[1], constraint: row[2] }));
}

/**
 * Parse and verify a raw event as an NCC-13 Release Artifact Set. Returns
 * null (rather than throwing) for anything that doesn't structurally
 * conform, since unrelated or malformed events are common on relays.
 */
export function parseRelease(event: Event): ParsedRelease | null {
    if (event.kind !== KIND_RELEASE_ARTIFACT_SET) return null;
    if (!verifyEvent(event)) return null;

    const dId = firstTagValue(event, 'd');
    const version = firstTagValue(event, 'version');
    const applicationAddresses = allTagValues(event, 'a').filter((a) => parseAddress(a)?.kind === KIND_SOFTWARE_APPLICATION);

    if (!dId || !version) return null;
    if (applicationAddresses.length !== 1) return null;

    const versionSchemeRaw = firstTagValue(event, 'version_scheme');
    const versionScheme: VersionScheme =
        versionSchemeRaw === 'semver' || versionSchemeRaw === 'calver' || versionSchemeRaw === 'opaque'
            ? versionSchemeRaw
            : 'opaque';

    const source = firstTagValue(event, 'source');
    const commit = firstTagValue(event, 'commit');
    if (source && !parseAddress(source)) return null;

    return {
        publisherPubkey: event.pubkey,
        dId,
        applicationAddress: applicationAddresses[0],
        version,
        versionScheme,
        channel: firstTagValue(event, 'channel'),
        source,
        commit,
        requires: parseDependencyRows(event, 'requires'),
        optional: parseDependencyRows(event, 'optional'),
        conflicts: parseDependencyRows(event, 'conflicts'),
        fileEventIds: allTagValues(event, 'e'),
        createdAt: event.created_at,
        event
    };
}

// --- Addressable-event replacement (NCC-13 section 29) ---

/**
 * Resolve the current release among candidates sharing the same
 * `kind + pubkey + d`, applying NIP-01 replacement semantics: the highest
 * `created_at` wins, with the lowest event id breaking a tie.
 */
export function resolveCurrentRelease(candidates: ParsedRelease[]): ParsedRelease | null {
    if (candidates.length === 0) return null;
    return candidates.reduce((latest, candidate) => {
        if (candidate.createdAt > latest.createdAt) return candidate;
        if (candidate.createdAt < latest.createdAt) return latest;
        return candidate.event.id < latest.event.id ? candidate : latest;
    });
}

// --- Dependency and conflict evaluation (NCC-13 sections 10-14) ---

export interface InstalledPackage {
    applicationAddress: string;
    version: string;
    versionScheme: VersionScheme;
}

/** Build a lookup keyed by application address from a set of installed packages. */
export function indexInstalled(packages: InstalledPackage[]): Map<string, InstalledPackage> {
    return new Map(packages.map((p) => [p.applicationAddress, p]));
}

export interface DependencyCheckResult {
    dependency: DependencyDeclaration;
    /** False when the dependency is not installed at all. */
    installed: boolean;
    /** False when installed but the version constraint is not met. */
    satisfied: boolean;
}

function checkDependency(dep: DependencyDeclaration, installed: Map<string, InstalledPackage>): DependencyCheckResult {
    const pkg = installed.get(dep.address);
    if (!pkg) return { dependency: dep, installed: false, satisfied: false };

    const constraint = parseVersionConstraint(dep.constraint);
    if (!constraint) return { dependency: dep, installed: true, satisfied: false };

    let satisfied: boolean;
    try {
        satisfied = satisfiesConstraint(pkg.version, constraint, pkg.versionScheme);
    } catch {
        // Unorderable (opaque) installed version: cannot confirm the
        // constraint, so treat as unsatisfied per NCC-13 §8.3.
        satisfied = false;
    }
    return { dependency: dep, installed: true, satisfied };
}

export interface DependencyEvaluation {
    requires: DependencyCheckResult[];
    optional: DependencyCheckResult[];
    /** True only when every `requires` dependency is installed and satisfied. */
    allRequiredSatisfied: boolean;
}

/**
 * Evaluate a release's `requires`/`optional` declarations against a set of
 * installed packages (NCC-13 §10-§11). Does not perform dependency
 * resolution or installation — see NCC-13 §14.
 */
export function evaluateDependencies(release: ParsedRelease, installed: Map<string, InstalledPackage>): DependencyEvaluation {
    const requires = release.requires.map((dep) => checkDependency(dep, installed));
    const optional = release.optional.map((dep) => checkDependency(dep, installed));
    return { requires, optional, allRequiredSatisfied: requires.every((r) => r.satisfied) };
}

export interface ConflictCheckResult {
    dependency: DependencyDeclaration;
    /** True when an installed package matches the conflicting address and constraint. */
    conflicting: boolean;
}

/**
 * Evaluate a release's `conflicts` declarations against installed packages
 * (NCC-13 §12). A package manager SHOULD NOT install the release while any
 * result here has `conflicting: true`.
 */
export function evaluateConflicts(release: ParsedRelease, installed: Map<string, InstalledPackage>): ConflictCheckResult[] {
    return release.conflicts.map((dep) => {
        const check = checkDependency(dep, installed);
        return { dependency: dep, conflicting: check.installed && check.satisfied };
    });
}

// --- Platform compatibility metadata (NCC-13 sections 15-20) ---

export interface FileSelector {
    os?: string;
    arch?: string;
    format?: string;
    event: Event;
}

/** Read the NCC-13 `os`/`arch`/`format` selector tags off a kind:1063 event. */
export function parseFileSelector(event: Event): FileSelector {
    return {
        os: firstTagValue(event, 'os'),
        arch: firstTagValue(event, 'arch'),
        format: firstTagValue(event, 'format'),
        event
    };
}

export interface PlatformTarget {
    os: string;
    arch: string;
    /** Package formats the local package manager can install, in preference order. */
    formats?: string[];
}

function matchesDimension(declared: string | undefined, wanted: string): boolean {
    // An absent selector is treated as unrestricted, same as an explicit "any".
    return declared === undefined || declared === 'any' || declared === wanted;
}

/**
 * Select the best-matching artefact for a target platform from a set of
 * kind:1063 File Metadata events carrying NCC-13 selectors (§19-§20).
 *
 * Filters to artefacts compatible with `target.os` and `target.arch`
 * (an `os`/`arch` of `"any"`, or the tag being absent, matches anything),
 * then prefers, in order: a matching declared `format` (in the caller's
 * preference order) over none/unmatched, and a more specific `os`/`arch`
 * declaration over `"any"` (NCC-13 §20). Returns null when nothing matches.
 */
export function selectArtifact(files: Event[], target: PlatformTarget): FileSelector | null {
    const candidates = files
        .map(parseFileSelector)
        .filter((f) => matchesDimension(f.os, target.os) && matchesDimension(f.arch, target.arch));

    if (candidates.length === 0) return null;

    const formatRank = (f: FileSelector): number => {
        if (!f.format || !target.formats) return -1;
        const idx = target.formats.indexOf(f.format);
        return idx === -1 ? -1 : target.formats.length - idx;
    };
    const specificity = (f: FileSelector): number => (f.os !== 'any' && f.os ? 1 : 0) + (f.arch !== 'any' && f.arch ? 1 : 0);

    candidates.sort((a, b) => {
        const byFormat = formatRank(b) - formatRank(a);
        if (byFormat !== 0) return byFormat;
        return specificity(b) - specificity(a);
    });

    return candidates[0];
}
