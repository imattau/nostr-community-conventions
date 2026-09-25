/**
 * NCC-07: Service Capability Manifest
 *
 * This library implements the NCC-07 convention for publishing and resolving
 * signed, addressable capability manifests bound to a Nostr service identity.
 *
 * @module ncc-07-js
 */

import {
    SimplePool,
    finalizeEvent,
    verifyEvent,
    Event,
    UnsignedEvent,
    getPublicKey
} from 'nostr-tools';

export const KIND_CAPABILITY_MANIFEST = 30062;
export const DEFAULT_MANIFEST_D_TAG = 'capabilities';

// --- Error Classes ---

export class NCC07Error extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'NCC07Error';
    }
}

export class NCC07ArgumentError extends NCC07Error {
    constructor(message: string) {
        super(message);
        this.name = 'NCC07ArgumentError';
    }
}

export class NCC07ValidationError extends NCC07Error {
    constructor(message: string) {
        super(message);
        this.name = 'NCC07ValidationError';
    }
}

// --- Capability identifier helpers ---

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;
const NIP_CAP_RE = /^nip:\d+$/;
const NCC_CAP_RE = /^ncc:\d+$/;
const PUBKEY_CAP_RE = /^pubkey:[0-9a-f]{64}:[a-z0-9]+(-[a-z0-9]+)*$/;

export type CapabilityNamespace = 'nip' | 'ncc' | 'pubkey' | 'unknown';

/**
 * Determine the namespace of a capability identifier, per NCC-07 section 7.
 * Identifiers outside the three defined namespaces are treated as opaque
 * ('unknown') rather than rejected, since clients MUST safely ignore
 * capabilities they don't understand.
 */
export function capabilityNamespace(cap: string): CapabilityNamespace {
    if (NIP_CAP_RE.test(cap)) return 'nip';
    if (NCC_CAP_RE.test(cap)) return 'ncc';
    if (PUBKEY_CAP_RE.test(cap)) return 'pubkey';
    return 'unknown';
}

/**
 * Structural validation of a capability identifier string.
 * Only checks the identifier is a non-empty, lowercase, sensible string -
 * NCC-07 identifiers outside the three defined namespaces remain legal
 * opaque strings.
 */
export function isWellFormedCapability(cap: string): boolean {
    if (typeof cap !== 'string' || cap.length === 0) return false;
    if (cap !== cap.toLowerCase()) return false;
    if (/\s/.test(cap)) return false;
    return true;
}

export function nipCapability(nipNumber: number | string): string {
    return `nip:${nipNumber}`;
}

export function nccCapability(nccNumber: number | string): string {
    return `ncc:${nccNumber}`;
}

export function pubkeyCapability(namespacePubkeyHex: string, name: string): string {
    if (!HEX_PUBKEY_RE.test(namespacePubkeyHex)) {
        throw new NCC07ArgumentError('namespacePubkeyHex must be 64 lowercase hex characters');
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
        throw new NCC07ArgumentError('capability name must be lowercase, hyphen-separated ASCII');
    }
    return `pubkey:${namespacePubkeyHex}:${name}`;
}

// --- Manifest building ---

export interface CapabilityManifestOptions {
    /** Service secret key (hex or Uint8Array via nostr-tools finalizeEvent). */
    secretKey: Uint8Array;
    /** Capability identifiers this manifest asserts. Must contain at least one. */
    capabilities: string[];
    /** Overrides the default 'capabilities' d-tag for non-default manifests. */
    dTag?: string;
    createdAt?: number;
}

/**
 * Build and sign a kind:30062 capability manifest event per NCC-07 section 6.
 */
export function buildCapabilityManifest(opts: CapabilityManifestOptions): Event {
    const { secretKey, capabilities, dTag = DEFAULT_MANIFEST_D_TAG, createdAt } = opts;

    if (!capabilities || capabilities.length === 0) {
        throw new NCC07ArgumentError('a capability manifest MUST contain at least one capability');
    }
    for (const cap of capabilities) {
        if (!isWellFormedCapability(cap)) {
            throw new NCC07ValidationError(`malformed capability identifier: ${JSON.stringify(cap)}`);
        }
    }

    const unsigned: UnsignedEvent = {
        kind: KIND_CAPABILITY_MANIFEST,
        pubkey: getPublicKey(secretKey),
        created_at: createdAt ?? Math.floor(Date.now() / 1000),
        tags: [
            ['d', dTag],
            ...capabilities.map((cap) => ['cap', cap])
        ],
        content: ''
    };

    return finalizeEvent(unsigned, secretKey);
}

/**
 * Publish a capability manifest to the given relays.
 */
export async function publishCapabilityManifest(
    pool: SimplePool,
    relays: string[],
    opts: CapabilityManifestOptions
): Promise<Event> {
    const event = buildCapabilityManifest(opts);
    await Promise.any(pool.publish(relays, event));
    return event;
}

// --- Manifest parsing ---

export interface ParsedCapabilityManifest {
    pubkey: string;
    dTag: string;
    capabilities: string[];
    createdAt: number;
    event: Event;
}

/**
 * Parse and verify a raw event as an NCC-07 capability manifest.
 * Returns null if the event does not conform (wrong kind, missing d-tag,
 * no cap tags, or an invalid signature) rather than throwing, since
 * malformed or unrelated events found on relays are common and clients
 * MUST NOT treat them as failures - just as not-a-manifest.
 */
export function parseCapabilityManifest(event: Event): ParsedCapabilityManifest | null {
    if (event.kind !== KIND_CAPABILITY_MANIFEST) return null;
    if (!verifyEvent(event)) return null;

    const dTagEntry = event.tags.find((t) => t[0] === 'd');
    if (!dTagEntry || typeof dTagEntry[1] !== 'string') return null;

    const capabilities = event.tags
        .filter((t) => t[0] === 'cap' && typeof t[1] === 'string')
        .map((t) => t[1]);

    if (capabilities.length === 0) return null;

    return {
        pubkey: event.pubkey,
        dTag: dTagEntry[1],
        capabilities,
        createdAt: event.created_at,
        event
    };
}

// --- Resolution ---

export interface ResolveCapabilityManifestOptions {
    dTag?: string;
    timeoutMs?: number;
}

/**
 * Resolve the latest capability manifest for a service pubkey, per NCC-07
 * section 9. Applies NIP-01 addressable-event replacement by keeping only
 * the highest created_at among valid manifests returned by the relay pool.
 */
export async function resolveCapabilityManifest(
    pool: SimplePool,
    relays: string[],
    servicePubkey: string,
    opts: ResolveCapabilityManifestOptions = {}
): Promise<ParsedCapabilityManifest | null> {
    const { dTag = DEFAULT_MANIFEST_D_TAG, timeoutMs = 5000 } = opts;

    const events = await pool.querySync(
        relays,
        {
            kinds: [KIND_CAPABILITY_MANIFEST],
            authors: [servicePubkey],
            '#d': [dTag]
        },
        { maxWait: timeoutMs }
    );

    let latest: ParsedCapabilityManifest | null = null;
    for (const event of events) {
        const parsed = parseCapabilityManifest(event);
        if (!parsed) continue;
        if (!latest || parsed.createdAt > latest.createdAt) {
            latest = parsed;
        }
    }
    return latest;
}

/** Convenience check: does a resolved manifest assert a given capability? */
export function hasCapability(manifest: ParsedCapabilityManifest | null, cap: string): boolean {
    return !!manifest && manifest.capabilities.includes(cap);
}
