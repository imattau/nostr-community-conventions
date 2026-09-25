/**
 * NCC-08: Service Identity Rotation and Handover
 *
 * This library implements the NCC-08 convention for building, parsing, and
 * validating signed kind:1070 handover proposal/acceptance event pairs, and
 * for resolving handover chains across a Nostr relay pool.
 *
 * @module ncc-08-js
 */

import {
    SimplePool,
    finalizeEvent,
    verifyEvent,
    Event,
    UnsignedEvent,
    getPublicKey
} from 'nostr-tools';

export const KIND_HANDOVER = 1070;

// --- Error classes ---

export class NCC08Error extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'NCC08Error';
    }
}

export class NCC08ArgumentError extends NCC08Error {
    constructor(message: string) {
        super(message);
        this.name = 'NCC08ArgumentError';
    }
}

// --- Identifier helpers ---

const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/;
const HEX_ID_RE = /^[0-9a-f]{64}$/;

function randomHandoverId(): string {
    const bytes = new Uint8Array(32);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

function firstTagValue(event: Event, name: string): string | undefined {
    return event.tags.find((t) => t[0] === name)?.[1];
}

function allTagValues(event: Event, name: string): string[] {
    return event.tags.filter((t) => t[0] === name).map((t) => t[1]);
}

// --- Handover Proposal (NCC-08 section 8) ---

export interface HandoverProposalOptions {
    /** Predecessor (current service identity) secret key. */
    secretKey: Uint8Array;
    /** Stable service identifier, e.g. the NCC-02 service `d` tag. */
    service: string;
    /** Successor pubkey (hex) the service is being handed over to. */
    successorPubkey: string;
    /** Handover identifier. Randomly generated if omitted (recommended). */
    handoverId?: string;
    /** Unix timestamp at which the handover becomes effective. */
    effective?: number;
    /** Unix timestamp after which the proposal can no longer be accepted. */
    expires?: number;
    /** Short human-readable context. MUST NOT be relied on for validation. */
    reason?: string;
    createdAt?: number;
}

/**
 * Build and sign a kind:1070 Handover Proposal per NCC-08 section 8.
 */
export function buildHandoverProposal(opts: HandoverProposalOptions): Event {
    const { secretKey, service, successorPubkey, reason, createdAt } = opts;

    if (!service) {
        throw new NCC08ArgumentError('service identifier is required');
    }
    if (!HEX_PUBKEY_RE.test(successorPubkey)) {
        throw new NCC08ArgumentError('successorPubkey must be 64 lowercase hex characters');
    }

    const handoverId = opts.handoverId ?? randomHandoverId();
    if (!HEX_ID_RE.test(handoverId)) {
        throw new NCC08ArgumentError('handoverId must be 64 lowercase hex characters');
    }

    const proposalCreatedAt = createdAt ?? Math.floor(Date.now() / 1000);

    if (opts.effective !== undefined && opts.effective < proposalCreatedAt) {
        throw new NCC08ArgumentError('effective timestamp MUST NOT be earlier than the proposal created_at (NCC-08 §11.2)');
    }
    if (opts.expires !== undefined && opts.effective !== undefined && opts.expires < opts.effective) {
        throw new NCC08ArgumentError('expires MUST NOT be earlier than effective');
    }

    const tags: string[][] = [
        ['role', 'predecessor'],
        ['handover', handoverId],
        ['service', service],
        ['p', successorPubkey]
    ];
    if (opts.effective !== undefined) tags.push(['effective', String(opts.effective)]);
    if (opts.expires !== undefined) tags.push(['expires', String(opts.expires)]);
    if (reason) tags.push(['reason', reason]);

    const unsigned: UnsignedEvent = {
        kind: KIND_HANDOVER,
        pubkey: getPublicKey(secretKey),
        created_at: proposalCreatedAt,
        tags,
        content: ''
    };

    return finalizeEvent(unsigned, secretKey);
}

// --- Handover Acceptance (NCC-08 section 9) ---

export interface HandoverAcceptanceOptions {
    /** Successor secret key, matching the proposal's successor `p` tag. */
    secretKey: Uint8Array;
    /** The exact proposal event being accepted. */
    proposal: Event;
    createdAt?: number;
}

/**
 * Build and sign a kind:1070 Handover Acceptance per NCC-08 section 9.
 * Derives `handover`, `service`, and the predecessor `p`/`e` tags from the
 * proposal event, so the acceptance always references it correctly.
 */
export function buildHandoverAcceptance(opts: HandoverAcceptanceOptions): Event {
    const { secretKey, proposal, createdAt } = opts;

    const parsedProposal = parseHandoverProposal(proposal);
    if (!parsedProposal) {
        throw new NCC08ArgumentError('proposal is not a validly signed NCC-08 Handover Proposal');
    }

    const successorPubkey = getPublicKey(secretKey);
    if (successorPubkey !== parsedProposal.successorPubkey) {
        throw new NCC08ArgumentError('secretKey does not match the successor named in the proposal');
    }

    const acceptanceCreatedAt = createdAt ?? Math.floor(Date.now() / 1000);
    if (acceptanceCreatedAt < parsedProposal.createdAt) {
        throw new NCC08ArgumentError('acceptance MUST NOT be created before the proposal (NCC-08 §10.10)');
    }
    if (parsedProposal.expires !== undefined && acceptanceCreatedAt > parsedProposal.expires) {
        throw new NCC08ArgumentError('acceptance created after the proposal expires (NCC-08 §10.11)');
    }

    const unsigned: UnsignedEvent = {
        kind: KIND_HANDOVER,
        pubkey: successorPubkey,
        created_at: acceptanceCreatedAt,
        tags: [
            ['role', 'successor'],
            ['handover', parsedProposal.handoverId],
            ['service', parsedProposal.service],
            ['p', parsedProposal.pubkey],
            ['e', proposal.id]
        ],
        content: ''
    };

    return finalizeEvent(unsigned, secretKey);
}

// --- Parsing (structural + signature checks only; pairing is separate) ---

export interface ParsedHandoverProposal {
    role: 'predecessor';
    pubkey: string;
    handoverId: string;
    service: string;
    successorPubkey: string;
    effective?: number;
    expires?: number;
    reason?: string;
    createdAt: number;
    event: Event;
}

export interface ParsedHandoverAcceptance {
    role: 'successor';
    pubkey: string;
    handoverId: string;
    service: string;
    predecessorPubkey: string;
    proposalEventId: string;
    createdAt: number;
    event: Event;
}

/**
 * Parse and verify a raw event as an NCC-08 Handover Proposal.
 * Returns null (rather than throwing) for anything that doesn't structurally
 * conform, since unrelated or malformed events are common on relays.
 */
export function parseHandoverProposal(event: Event): ParsedHandoverProposal | null {
    if (event.kind !== KIND_HANDOVER) return null;
    if (firstTagValue(event, 'role') !== 'predecessor') return null;
    if (!verifyEvent(event)) return null;

    const handoverId = firstTagValue(event, 'handover');
    const service = firstTagValue(event, 'service');
    const successors = allTagValues(event, 'p');
    if (!handoverId || !service) return null;
    if (successors.length !== 1) return null;
    const successorPubkey = successors[0];
    if (!HEX_PUBKEY_RE.test(successorPubkey)) return null;

    const effectiveRaw = firstTagValue(event, 'effective');
    const expiresRaw = firstTagValue(event, 'expires');
    const effective = effectiveRaw !== undefined ? Number(effectiveRaw) : undefined;
    const expires = expiresRaw !== undefined ? Number(expiresRaw) : undefined;
    if (effective !== undefined && !Number.isFinite(effective)) return null;
    if (expires !== undefined && !Number.isFinite(expires)) return null;
    if (effective !== undefined && effective < event.created_at) return null;

    return {
        role: 'predecessor',
        pubkey: event.pubkey,
        handoverId,
        service,
        successorPubkey,
        effective,
        expires,
        reason: firstTagValue(event, 'reason'),
        createdAt: event.created_at,
        event
    };
}

/**
 * Parse and verify a raw event as an NCC-08 Handover Acceptance.
 * Returns null for anything that doesn't structurally conform.
 */
export function parseHandoverAcceptance(event: Event): ParsedHandoverAcceptance | null {
    if (event.kind !== KIND_HANDOVER) return null;
    if (firstTagValue(event, 'role') !== 'successor') return null;
    if (!verifyEvent(event)) return null;

    const handoverId = firstTagValue(event, 'handover');
    const service = firstTagValue(event, 'service');
    const predecessors = allTagValues(event, 'p');
    const proposalRefs = allTagValues(event, 'e');
    if (!handoverId || !service) return null;
    if (predecessors.length !== 1) return null;
    if (proposalRefs.length !== 1) return null;
    const predecessorPubkey = predecessors[0];
    if (!HEX_PUBKEY_RE.test(predecessorPubkey)) return null;

    return {
        role: 'successor',
        pubkey: event.pubkey,
        handoverId,
        service,
        predecessorPubkey,
        proposalEventId: proposalRefs[0],
        createdAt: event.created_at,
        event
    };
}

// --- Pair validation (NCC-08 section 10) ---

export interface HandoverPairValidation {
    valid: boolean;
    /** Reasons the pair failed validation. Empty when valid is true. */
    errors: string[];
}

/**
 * Validate a proposal/acceptance pair against every rule in NCC-08 section 10.
 * Does not throw: callers should check `.valid` and MUST NOT treat a pair
 * with any error as a completed handover.
 */
export function validateHandoverPair(
    proposal: ParsedHandoverProposal,
    acceptance: ParsedHandoverAcceptance
): HandoverPairValidation {
    const errors: string[] = [];

    if (proposal.role !== 'predecessor') errors.push('proposal role must be "predecessor"');
    if (acceptance.role !== 'successor') errors.push('acceptance role must be "successor"');
    if (proposal.handoverId !== acceptance.handoverId) errors.push('handover identifiers do not match');
    if (proposal.service !== acceptance.service) errors.push('service identifiers do not match');
    if (proposal.successorPubkey !== acceptance.pubkey) {
        errors.push("proposal's successor does not match the acceptance author");
    }
    if (acceptance.predecessorPubkey !== proposal.pubkey) {
        errors.push("acceptance's predecessor does not match the proposal author");
    }
    if (acceptance.proposalEventId !== proposal.event.id) {
        errors.push('acceptance does not reference the exact proposal event');
    }
    if (acceptance.createdAt < proposal.createdAt) {
        errors.push('acceptance was created before the proposal');
    }
    if (proposal.expires !== undefined && acceptance.createdAt > proposal.expires) {
        errors.push('acceptance was created after the proposal expired');
    }

    return { valid: errors.length === 0, errors };
}

// --- Effective time and state (NCC-08 sections 11-12) ---

/**
 * Compute the effective timestamp of a valid handover pair (NCC-08 §11).
 * Callers should only call this once `validateHandoverPair` reports valid.
 */
export function handoverEffectiveTime(
    proposal: ParsedHandoverProposal,
    acceptance: ParsedHandoverAcceptance
): number {
    return proposal.effective ?? acceptance.createdAt;
}

export type HandoverState = 'proposed' | 'accepted' | 'effective';

/**
 * Determine the handover's state per NCC-08 §12.
 * Pass `acceptance: null` when no matching acceptance has been found yet.
 */
export function handoverState(
    proposal: ParsedHandoverProposal,
    acceptance: ParsedHandoverAcceptance | null,
    now: number = Math.floor(Date.now() / 1000)
): HandoverState {
    if (!acceptance) return 'proposed';
    const { valid } = validateHandoverPair(proposal, acceptance);
    if (!valid) return 'proposed';
    const effectiveAt = handoverEffectiveTime(proposal, acceptance);
    return now >= effectiveAt ? 'effective' : 'accepted';
}

// --- Publishing ---

export async function publishHandoverProposal(
    pool: SimplePool,
    relays: string[],
    opts: HandoverProposalOptions
): Promise<Event> {
    const event = buildHandoverProposal(opts);
    await Promise.any(pool.publish(relays, event));
    return event;
}

export async function publishHandoverAcceptance(
    pool: SimplePool,
    relays: string[],
    opts: HandoverAcceptanceOptions
): Promise<Event> {
    const event = buildHandoverAcceptance(opts);
    await Promise.any(pool.publish(relays, event));
    return event;
}

// --- Chain resolution (NCC-08 sections 14-15, 27) ---

export interface HandoverLink {
    proposal: ParsedHandoverProposal;
    acceptance: ParsedHandoverAcceptance;
    effectiveAt: number;
}

export type HandoverChainResult =
    /** `maxHops` was reached while a further successor was still being found. */
    | { status: 'resolved'; current: string; chain: HandoverLink[] }
    /** `current` has no further effective handover; it is the chain's terminus. */
    | { status: 'no_successor'; current: string; chain: HandoverLink[] }
    | { status: 'conflict'; current: string; chain: HandoverLink[]; conflictingLinks: HandoverLink[] }
    | { status: 'loop'; current: string; chain: HandoverLink[] };

export interface ResolveHandoverChainOptions {
    timeoutMs?: number;
    now?: number;
    /** Safety bound on chain length, independent of loop detection. */
    maxHops?: number;
}

/**
 * Follow effective NCC-08 handovers for a service starting from `startPubkey`,
 * per the client resolution algorithm in NCC-08 §27. Stops on no effective
 * successor, a loop, a conflict (multiple incompatible completed handovers
 * from the same predecessor for the same service), or `maxHops`.
 */
export async function resolveHandoverChain(
    pool: SimplePool,
    relays: string[],
    startPubkey: string,
    service: string,
    opts: ResolveHandoverChainOptions = {}
): Promise<HandoverChainResult> {
    const { timeoutMs = 5000, now = Math.floor(Date.now() / 1000), maxHops = 32 } = opts;

    const chain: HandoverLink[] = [];
    const visited = new Set<string>([startPubkey]);
    let current = startPubkey;

    for (let hop = 0; hop < maxHops; hop++) {
        const proposalEvents = await pool.querySync(
            relays,
            { kinds: [KIND_HANDOVER], authors: [current], '#service': [service] } as any,
            { maxWait: timeoutMs }
        );

        const proposals = proposalEvents
            .map(parseHandoverProposal)
            .filter((p): p is ParsedHandoverProposal => p !== null && p.service === service);

        const links: HandoverLink[] = [];
        for (const proposal of proposals) {
            const acceptanceEvents = await pool.querySync(
                relays,
                { kinds: [KIND_HANDOVER], authors: [proposal.successorPubkey], '#e': [proposal.event.id] } as any,
                { maxWait: timeoutMs }
            );
            for (const raw of acceptanceEvents) {
                const acceptance = parseHandoverAcceptance(raw);
                if (!acceptance) continue;
                const { valid } = validateHandoverPair(proposal, acceptance);
                if (!valid) continue;
                const effectiveAt = handoverEffectiveTime(proposal, acceptance);
                if (effectiveAt > now) continue;
                links.push({ proposal, acceptance, effectiveAt });
            }
        }

        if (links.length === 0) {
            return { status: 'no_successor', current, chain };
        }

        const distinctSuccessors = new Set(links.map((l) => l.acceptance.pubkey));
        if (distinctSuccessors.size > 1) {
            return { status: 'conflict', current, chain, conflictingLinks: links };
        }

        // Multiple valid links to the same successor: take the earliest effective one.
        links.sort((a, b) => a.effectiveAt - b.effectiveAt);
        const link = links[0];
        chain.push(link);

        const next = link.acceptance.pubkey;
        if (visited.has(next)) {
            return { status: 'loop', current: next, chain };
        }
        visited.add(next);
        current = next;
    }

    return { status: 'resolved', current, chain };
}
