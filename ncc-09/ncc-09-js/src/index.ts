/**
 * NCC-09: Scoped Operator Authority
 *
 * This library implements the NCC-09 convention for building, parsing, and
 * validating signed kind:30064 authority grant events, and for resolving
 * and validating the current authority state for a principal/operator/
 * service triple across a Nostr relay pool.
 *
 * @module ncc-09-js
 */

import {
    SimplePool,
    finalizeEvent,
    verifyEvent,
    Event,
    UnsignedEvent,
    getPublicKey
} from 'nostr-tools';

export const KIND_AUTHORITY_GRANT = 30064;

// --- Error classes ---

export class NCC09Error extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'NCC09Error';
    }
}

export class NCC09ArgumentError extends NCC09Error {
    constructor(message: string) {
        super(message);
        this.name = 'NCC09ArgumentError';
    }
}

// --- Identifier helpers ---

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;

function firstTagValue(event: Event, name: string): string | undefined {
    return event.tags.find((t) => t[0] === name)?.[1];
}

function allTagValues(event: Event, name: string): string[] {
    return event.tags.filter((t) => t[0] === name).map((t) => t[1]);
}

/**
 * Build the recommended NCC-09 §6.2 address identifier for a service/operator
 * pair: `<service-id>:<operator-pubkey-hex>`.
 */
export function authorityAddressId(service: string, operatorPubkey: string): string {
    return `${service}:${operatorPubkey}`;
}

// --- Authority Grant (NCC-09 section 6) ---

export type GrantStatus = 'active' | 'revoked';

export interface AuthorityGrantOptions {
    /** Principal (service identity) secret key. */
    secretKey: Uint8Array;
    /** Stable service identifier, e.g. the NCC-02 service `d` tag. */
    service: string;
    /** Operator pubkey (hex) being authorised. */
    operatorPubkey: string;
    /** Grant status. Defaults to 'active'. */
    status?: GrantStatus;
    /**
     * Scope identifiers granted to the operator. Required (non-empty) when
     * status is 'active' (NCC-09 §6.3). SHOULD be omitted/empty when
     * status is 'revoked' (§15).
     */
    scopes?: string[];
    /** Unix timestamp after which the grant is no longer valid. */
    expiration?: number;
    /** Unix timestamp before which the grant is not yet valid. */
    validFrom?: number;
    /** Short human-readable context. MUST NOT be relied on for validation. */
    note?: string;
    createdAt?: number;
}

/**
 * Build and sign a kind:30064 Authority Grant per NCC-09 section 6.
 */
export function buildAuthorityGrant(opts: AuthorityGrantOptions): Event {
    const { secretKey, service, operatorPubkey, note, createdAt } = opts;

    if (!service) {
        throw new NCC09ArgumentError('service identifier is required');
    }
    if (!HEX_PUBKEY_RE.test(operatorPubkey)) {
        throw new NCC09ArgumentError('operatorPubkey must be 64 lowercase hex characters');
    }

    const status: GrantStatus = opts.status ?? 'active';
    const scopes = opts.scopes ?? [];

    if (status === 'active' && scopes.length === 0) {
        throw new NCC09ArgumentError('an active grant MUST contain at least one scope (NCC-09 §6.3)');
    }
    if (status === 'revoked' && scopes.length > 0) {
        throw new NCC09ArgumentError('a revoked grant SHOULD contain no scope tags (NCC-09 §15)');
    }

    if (
        opts.expiration !== undefined &&
        opts.validFrom !== undefined &&
        opts.expiration < opts.validFrom
    ) {
        throw new NCC09ArgumentError('expiration MUST NOT be earlier than valid_from');
    }

    const grantCreatedAt = createdAt ?? Math.floor(Date.now() / 1000);

    const tags: string[][] = [
        ['d', authorityAddressId(service, operatorPubkey)],
        ['service', service],
        ['p', operatorPubkey],
        ['status', status]
    ];
    for (const scope of scopes) tags.push(['scope', scope]);
    if (opts.expiration !== undefined) tags.push(['expiration', String(opts.expiration)]);
    if (opts.validFrom !== undefined) tags.push(['valid_from', String(opts.validFrom)]);
    if (note) tags.push(['note', note]);

    const unsigned: UnsignedEvent = {
        kind: KIND_AUTHORITY_GRANT,
        pubkey: getPublicKey(secretKey),
        created_at: grantCreatedAt,
        tags,
        content: ''
    };

    return finalizeEvent(unsigned, secretKey);
}

/**
 * Build and sign a kind:30064 revocation for an existing service/operator
 * grant per NCC-09 section 15. Convenience wrapper over
 * `buildAuthorityGrant` with `status: 'revoked'` and no scopes.
 */
export function buildRevocation(opts: {
    secretKey: Uint8Array;
    service: string;
    operatorPubkey: string;
    note?: string;
    createdAt?: number;
}): Event {
    return buildAuthorityGrant({ ...opts, status: 'revoked', scopes: [] });
}

// --- Parsing (structural + signature checks only) ---

export interface ParsedAuthorityGrant {
    principalPubkey: string;
    service: string;
    operatorPubkey: string;
    status: GrantStatus;
    scopes: string[];
    expiration?: number;
    validFrom?: number;
    note?: string;
    createdAt: number;
    dTag: string;
    event: Event;
}

/**
 * Parse and verify a raw event as an NCC-09 Authority Grant.
 * Returns null (rather than throwing) for anything that doesn't structurally
 * conform, since unrelated or malformed events are common on relays.
 */
export function parseAuthorityGrant(event: Event): ParsedAuthorityGrant | null {
    if (event.kind !== KIND_AUTHORITY_GRANT) return null;
    if (!verifyEvent(event)) return null;

    const dTag = firstTagValue(event, 'd');
    const service = firstTagValue(event, 'service');
    const statusRaw = firstTagValue(event, 'status');
    const operators = allTagValues(event, 'p');

    if (!dTag || !service) return null;
    if (statusRaw !== 'active' && statusRaw !== 'revoked') return null;
    if (operators.length !== 1) return null;

    const operatorPubkey = operators[0];
    if (!HEX_PUBKEY_RE.test(operatorPubkey)) return null;

    const scopes = allTagValues(event, 'scope');
    if (statusRaw === 'active' && scopes.length === 0) return null;

    const expirationRaw = firstTagValue(event, 'expiration');
    const validFromRaw = firstTagValue(event, 'valid_from');
    const expiration = expirationRaw !== undefined ? Number(expirationRaw) : undefined;
    const validFrom = validFromRaw !== undefined ? Number(validFromRaw) : undefined;
    if (expiration !== undefined && !Number.isFinite(expiration)) return null;
    if (validFrom !== undefined && !Number.isFinite(validFrom)) return null;

    return {
        principalPubkey: event.pubkey,
        service,
        operatorPubkey,
        status: statusRaw,
        scopes,
        expiration,
        validFrom,
        note: firstTagValue(event, 'note'),
        createdAt: event.created_at,
        dTag,
        event
    };
}

// --- Addressable-event replacement (NCC-09 §13, §29.5) ---

/**
 * Resolve the current addressable event among candidate grants sharing the
 * same `kind + pubkey + d`, applying NIP-01 replacement semantics: the
 * highest `created_at` wins, with the lowest event id breaking a tie.
 */
export function resolveCurrentGrant(candidates: ParsedAuthorityGrant[]): ParsedAuthorityGrant | null {
    if (candidates.length === 0) return null;
    return candidates.reduce((latest, candidate) => {
        if (candidate.createdAt > latest.createdAt) return candidate;
        if (candidate.createdAt < latest.createdAt) return latest;
        return candidate.event.id < latest.event.id ? candidate : latest;
    });
}

// --- Validation (NCC-09 section 12-13) ---

export interface AuthorityValidationOptions {
    /** Expected principal (service identity) pubkey. */
    principalPubkey: string;
    /** Expected service identifier. */
    service: string;
    /** Expected operator pubkey. */
    operatorPubkey: string;
    /** Required scope identifier. */
    scope: string;
    now?: number;
}

export interface AuthorityValidationResult {
    valid: boolean;
    /** Reasons the grant failed validation. Empty when valid is true. */
    errors: string[];
}

/**
 * Validate a single (already-resolved-to-current) grant against every rule
 * in NCC-09 section 13. Does not throw: callers should check `.valid` and
 * MUST NOT treat a grant with any error as authorising the action.
 */
export function validateAuthorityGrant(
    grant: ParsedAuthorityGrant,
    opts: AuthorityValidationOptions
): AuthorityValidationResult {
    const errors: string[] = [];
    const now = opts.now ?? Math.floor(Date.now() / 1000);

    if (grant.principalPubkey !== opts.principalPubkey) errors.push('grant is not published by the expected principal');
    if (grant.operatorPubkey !== opts.operatorPubkey) errors.push('grant operator does not match the expected operator');
    if (grant.service !== opts.service) errors.push('grant service does not match the expected service');
    if (grant.status !== 'active') errors.push('grant status is not "active"');
    if (!grant.scopes.includes(opts.scope)) errors.push(`grant does not include the required scope "${opts.scope}"`);
    if (grant.validFrom !== undefined && now < grant.validFrom) errors.push('grant is not yet valid (before valid_from)');
    if (grant.expiration !== undefined && now > grant.expiration) errors.push('grant has expired');

    return { valid: errors.length === 0, errors };
}

// --- Publishing ---

export async function publishAuthorityGrant(
    pool: SimplePool,
    relays: string[],
    opts: AuthorityGrantOptions
): Promise<Event> {
    const event = buildAuthorityGrant(opts);
    await Promise.any(pool.publish(relays, event));
    return event;
}

export async function publishRevocation(
    pool: SimplePool,
    relays: string[],
    opts: { secretKey: Uint8Array; service: string; operatorPubkey: string; note?: string; createdAt?: number }
): Promise<Event> {
    const event = buildRevocation(opts);
    await Promise.any(pool.publish(relays, event));
    return event;
}

// --- Fetch + validate (NCC-09 section 12 end-to-end helper) ---

export interface FetchAuthorityOptions {
    timeoutMs?: number;
    now?: number;
}

/**
 * Query relays for every kind:30064 event at the service/operator address,
 * resolve the current one per NIP-01 replacement semantics, and validate it
 * for the requested scope — the full client procedure from NCC-09 §12.
 * Returns `null` when no grant exists at that address.
 */
export async function fetchAndValidateAuthority(
    pool: SimplePool,
    relays: string[],
    opts: AuthorityValidationOptions & FetchAuthorityOptions
): Promise<{ grant: ParsedAuthorityGrant; result: AuthorityValidationResult } | null> {
    const { timeoutMs = 5000, principalPubkey, service, operatorPubkey } = opts;
    const dTag = authorityAddressId(service, operatorPubkey);

    const events = await pool.querySync(
        relays,
        { kinds: [KIND_AUTHORITY_GRANT], authors: [principalPubkey], '#d': [dTag] } as any,
        { maxWait: timeoutMs }
    );

    const candidates = events
        .map(parseAuthorityGrant)
        .filter((g): g is ParsedAuthorityGrant => g !== null && g.dTag === dTag);

    const grant = resolveCurrentGrant(candidates);
    if (!grant) return null;

    return { grant, result: validateAuthorityGrant(grant, opts) };
}
