/**
 * NCC-10: Service Operational State
 *
 * This library implements the NCC-10 convention for building, parsing, and
 * resolving signed kind:30065 operational state events, published either
 * directly by a service identity or by an NCC-09-authorised operator, and
 * for resolving the current declared state for a service across a Nostr
 * relay pool.
 *
 * NCC-10 deliberately does not depend on ncc-09-js: whether an operator
 * event is authorised is established by whatever NCC-09 validation the
 * caller already has (see `resolveServiceState`'s `isAuthorisedOperator`
 * callback), keeping the operator-authority concern (NCC-09) separate from
 * the operational-state concern (NCC-10), per NCC-10 §19.
 *
 * @module ncc-10-js
 */

import {
    SimplePool,
    finalizeEvent,
    verifyEvent,
    Event,
    UnsignedEvent,
    getPublicKey
} from 'nostr-tools';

export const KIND_OPERATIONAL_STATE = 30065;

export const STATES = ['operational', 'degraded', 'maintenance', 'unavailable', 'retiring'] as const;
export type OperationalState = (typeof STATES)[number];

function isOperationalState(value: string): value is OperationalState {
    return (STATES as readonly string[]).includes(value);
}

// --- Error classes ---

export class NCC10Error extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'NCC10Error';
    }
}

export class NCC10ArgumentError extends NCC10Error {
    constructor(message: string) {
        super(message);
        this.name = 'NCC10ArgumentError';
    }
}

// --- Identifier helpers ---

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;

function firstTagValue(event: Event, name: string): string | undefined {
    return event.tags.find((t) => t[0] === name)?.[1];
}

/**
 * Build the NCC-10 §12 operator address identifier for a service published
 * on behalf of a principal: `<service-pubkey-hex>:<service-id>`.
 */
export function operatorAddressId(servicePubkey: string, service: string): string {
    return `${servicePubkey}:${service}`;
}

// --- Direct state (NCC-10 section 5) ---

export interface DirectStateOptions {
    /** Service identity secret key. */
    secretKey: Uint8Array;
    /** Stable service identifier, e.g. the NCC-02 service `d` tag. */
    service: string;
    /** One of the five NCC-10 states. */
    state: OperationalState;
    /** Unix timestamp the reported condition is believed to have begun. */
    since?: number;
    /** Unix timestamp the current condition is expected to end by. */
    expectedUntil?: number;
    /** Opaque application/external incident identifier. */
    incident?: string;
    /** Successor service pubkey (hex). Only meaningful when state is 'retiring'. */
    successor?: string;
    /** Short human-readable status text. MUST NOT be relied on for validation. */
    content?: string;
    createdAt?: number;
}

/**
 * Build and sign a kind:30065 direct state event per NCC-10 section 5.
 */
export function buildDirectState(opts: DirectStateOptions): Event {
    const { secretKey, service, state, content, createdAt } = opts;

    if (!service) {
        throw new NCC10ArgumentError('service identifier is required');
    }
    if (!isOperationalState(state)) {
        throw new NCC10ArgumentError(`state must be one of: ${STATES.join(', ')}`);
    }
    if (opts.successor !== undefined && !HEX_PUBKEY_RE.test(opts.successor)) {
        throw new NCC10ArgumentError('successor must be 64 lowercase hex characters');
    }

    const tags: string[][] = [
        ['d', service],
        ['service', service],
        ['state', state]
    ];
    if (opts.since !== undefined) tags.push(['since', String(opts.since)]);
    if (opts.expectedUntil !== undefined) tags.push(['expected_until', String(opts.expectedUntil)]);
    if (opts.incident !== undefined) tags.push(['incident', opts.incident]);
    if (opts.successor !== undefined) tags.push(['successor', opts.successor]);

    const unsigned: UnsignedEvent = {
        kind: KIND_OPERATIONAL_STATE,
        pubkey: getPublicKey(secretKey),
        created_at: createdAt ?? Math.floor(Date.now() / 1000),
        tags,
        content: content ?? ''
    };

    return finalizeEvent(unsigned, secretKey);
}

// --- Operator state (NCC-10 section 12) ---

export interface OperatorStateOptions {
    /** Operator's own secret key. The operator remains the event author. */
    secretKey: Uint8Array;
    /** Principal (service identity) pubkey the operator claims to act for. */
    servicePubkey: string;
    /** Stable service identifier. */
    service: string;
    /** One of the five NCC-10 states. */
    state: OperationalState;
    since?: number;
    expectedUntil?: number;
    incident?: string;
    successor?: string;
    content?: string;
    createdAt?: number;
}

/**
 * Build and sign a kind:30065 operator-published state event per NCC-10
 * section 12. This alone does not make the event authorised — see
 * `resolveServiceState` and NCC-10 §13 for validation against the
 * principal's NCC-09 authority grant.
 */
export function buildOperatorState(opts: OperatorStateOptions): Event {
    const { secretKey, servicePubkey, service, state, content, createdAt } = opts;

    if (!HEX_PUBKEY_RE.test(servicePubkey)) {
        throw new NCC10ArgumentError('servicePubkey must be 64 lowercase hex characters');
    }
    if (!service) {
        throw new NCC10ArgumentError('service identifier is required');
    }
    if (!isOperationalState(state)) {
        throw new NCC10ArgumentError(`state must be one of: ${STATES.join(', ')}`);
    }
    if (opts.successor !== undefined && !HEX_PUBKEY_RE.test(opts.successor)) {
        throw new NCC10ArgumentError('successor must be 64 lowercase hex characters');
    }

    const tags: string[][] = [
        ['d', operatorAddressId(servicePubkey, service)],
        ['service', service],
        ['state', state],
        ['operator_for', servicePubkey, service]
    ];
    if (opts.since !== undefined) tags.push(['since', String(opts.since)]);
    if (opts.expectedUntil !== undefined) tags.push(['expected_until', String(opts.expectedUntil)]);
    if (opts.incident !== undefined) tags.push(['incident', opts.incident]);
    if (opts.successor !== undefined) tags.push(['successor', opts.successor]);

    const unsigned: UnsignedEvent = {
        kind: KIND_OPERATIONAL_STATE,
        pubkey: getPublicKey(secretKey),
        created_at: createdAt ?? Math.floor(Date.now() / 1000),
        tags,
        content: content ?? ''
    };

    return finalizeEvent(unsigned, secretKey);
}

// --- Parsing (structural + signature checks only) ---

export interface ParsedState {
    /** The event author: the service identity for a direct state, the operator for an operator state. */
    authorPubkey: string;
    service: string;
    state: OperationalState;
    since?: number;
    expectedUntil?: number;
    incident?: string;
    successor?: string;
    createdAt: number;
    dTag: string;
    content: string;
    /** Present only on an operator-published event. */
    operatorFor?: { servicePubkey: string; service: string };
    event: Event;
}

function parseCommon(event: Event): Omit<ParsedState, 'operatorFor'> | null {
    if (event.kind !== KIND_OPERATIONAL_STATE) return null;
    if (!verifyEvent(event)) return null;

    const dTag = firstTagValue(event, 'd');
    const service = firstTagValue(event, 'service');
    const stateRaw = firstTagValue(event, 'state');

    if (!dTag || !service || !stateRaw || !isOperationalState(stateRaw)) return null;

    const sinceRaw = firstTagValue(event, 'since');
    const expectedUntilRaw = firstTagValue(event, 'expected_until');
    const since = sinceRaw !== undefined ? Number(sinceRaw) : undefined;
    const expectedUntil = expectedUntilRaw !== undefined ? Number(expectedUntilRaw) : undefined;
    if (since !== undefined && !Number.isFinite(since)) return null;
    if (expectedUntil !== undefined && !Number.isFinite(expectedUntil)) return null;

    const successor = firstTagValue(event, 'successor');
    if (successor !== undefined && !HEX_PUBKEY_RE.test(successor)) return null;

    return {
        authorPubkey: event.pubkey,
        service,
        state: stateRaw,
        since,
        expectedUntil,
        incident: firstTagValue(event, 'incident'),
        successor,
        createdAt: event.created_at,
        dTag,
        content: event.content,
        event
    };
}

/**
 * Parse and verify a raw event as a directly-published NCC-10 state.
 * Requires `d === service` (NCC-10 §5.2). Returns null (rather than
 * throwing) for anything that doesn't structurally conform.
 */
export function parseDirectState(event: Event): ParsedState | null {
    const common = parseCommon(event);
    if (!common) return null;
    if (common.dTag !== common.service) return null;
    return common;
}

/**
 * Parse and verify a raw event as an operator-published NCC-10 state.
 * Requires the NCC-10 §12 `d` and `operator_for` shape. This only checks
 * structure and signature — it does NOT establish that the operator is
 * authorised; use `resolveServiceState` or validate the referenced NCC-09
 * grant yourself per NCC-10 §13.
 */
export function parseOperatorState(event: Event): ParsedState | null {
    const common = parseCommon(event);
    if (!common) return null;

    const operatorForTag = event.tags.find((t) => t[0] === 'operator_for');
    if (!operatorForTag || !operatorForTag[1] || !operatorForTag[2]) return null;

    const servicePubkey = operatorForTag[1];
    const operatorForService = operatorForTag[2];
    if (!HEX_PUBKEY_RE.test(servicePubkey)) return null;
    if (operatorForService !== common.service) return null;
    if (common.dTag !== operatorAddressId(servicePubkey, common.service)) return null;

    return { ...common, operatorFor: { servicePubkey, service: operatorForService } };
}

// --- Addressable-event replacement (NCC-10 §10) ---

/**
 * Resolve the current addressable event among candidates sharing the same
 * `kind + pubkey + d`, applying NIP-01 replacement semantics: the highest
 * `created_at` wins, with the lowest event id breaking a tie.
 */
export function resolveCurrentState(candidates: ParsedState[]): ParsedState | null {
    if (candidates.length === 0) return null;
    return candidates.reduce((latest, candidate) => {
        if (candidate.createdAt > latest.createdAt) return candidate;
        if (candidate.createdAt < latest.createdAt) return latest;
        return candidate.event.id < latest.event.id ? candidate : latest;
    });
}

// --- Publishing ---

export async function publishDirectState(
    pool: SimplePool,
    relays: string[],
    opts: DirectStateOptions
): Promise<Event> {
    const event = buildDirectState(opts);
    await Promise.any(pool.publish(relays, event));
    return event;
}

export async function publishOperatorState(
    pool: SimplePool,
    relays: string[],
    opts: OperatorStateOptions
): Promise<Event> {
    const event = buildOperatorState(opts);
    await Promise.any(pool.publish(relays, event));
    return event;
}

// --- Client resolution (NCC-10 section 25) ---

export type ServiceStateResolution =
    | { status: 'direct'; state: ParsedState }
    | { status: 'operator'; state: ParsedState }
    | { status: 'conflict'; candidates: ParsedState[] }
    | { status: 'unknown' };

export interface ResolveServiceStateOptions {
    /** Service identity pubkey. */
    servicePubkey: string;
    /** Stable service identifier. */
    service: string;
    timeoutMs?: number;
    /**
     * Called for each candidate operator-published event to determine
     * whether that operator currently holds NCC-09 `ncc:10:publish`
     * authority for this servicePubkey/service. Wire this to your NCC-09
     * grant lookup (e.g. ncc-09-js's `fetchAndValidateAuthority`).
     */
    isAuthorisedOperator: (operatorPubkey: string) => Promise<boolean> | boolean;
}

/**
 * Resolve the current operational state of a service per NCC-10 §25:
 * prefer a valid direct state; otherwise use operator-published state
 * validated against NCC-09 authority; treat disagreeing valid operator
 * states as a conflict rather than silently picking one.
 */
export async function resolveServiceState(
    pool: SimplePool,
    relays: string[],
    opts: ResolveServiceStateOptions
): Promise<ServiceStateResolution> {
    const { servicePubkey, service, timeoutMs = 5000, isAuthorisedOperator } = opts;

    const directEvents = await pool.querySync(
        relays,
        { kinds: [KIND_OPERATIONAL_STATE], authors: [servicePubkey], '#d': [service] } as any,
        { maxWait: timeoutMs }
    );
    const directCandidates = directEvents
        .map(parseDirectState)
        .filter((s): s is ParsedState => s !== null && s.dTag === service);
    const currentDirect = resolveCurrentState(directCandidates);
    if (currentDirect) return { status: 'direct', state: currentDirect };

    const operatorDTag = operatorAddressId(servicePubkey, service);
    const operatorEvents = await pool.querySync(
        relays,
        { kinds: [KIND_OPERATIONAL_STATE], '#d': [operatorDTag] } as any,
        { maxWait: timeoutMs }
    );
    const operatorCandidates = operatorEvents
        .map(parseOperatorState)
        .filter((s): s is ParsedState => s !== null && s.dTag === operatorDTag);

    // Resolve one current state per distinct operator (author), then keep
    // only the operators that are currently authorised.
    const byOperator = new Map<string, ParsedState[]>();
    for (const candidate of operatorCandidates) {
        const list = byOperator.get(candidate.authorPubkey) ?? [];
        list.push(candidate);
        byOperator.set(candidate.authorPubkey, list);
    }

    const currentPerOperator: ParsedState[] = [];
    for (const [operatorPubkey, candidates] of byOperator) {
        const current = resolveCurrentState(candidates);
        if (!current) continue;
        if (await isAuthorisedOperator(operatorPubkey)) currentPerOperator.push(current);
    }

    if (currentPerOperator.length === 0) return { status: 'unknown' };
    if (currentPerOperator.length === 1) return { status: 'operator', state: currentPerOperator[0] };

    const distinctStates = new Set(currentPerOperator.map((s) => s.state));
    if (distinctStates.size === 1) return { status: 'operator', state: currentPerOperator[0] };

    return { status: 'conflict', candidates: currentPerOperator };
}
