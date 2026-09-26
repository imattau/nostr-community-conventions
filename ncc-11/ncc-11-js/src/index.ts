/**
 * NCC-11: Portable Trust Policy
 *
 * This library implements the NCC-11 convention for building, parsing, and
 * resolving signed kind:30067 trust-policy events: a portable format that
 * lets a Nostr identity express how it wants supporting clients and
 * runtimes to evaluate the facts and assertions published by other NCCs
 * (NCC-02, NCC-05, NCC-07, NCC-09, NCC-10), without those conventions
 * themselves changing (NCC-11 §2).
 *
 * NCC-11 deliberately does not depend on ncc-02-js, ncc-05-js, ncc-09-js,
 * or ncc-10-js: this library only builds, parses, and resolves policy
 * documents. Applying a resolved policy's rules to real service data is
 * the caller's responsibility (NCC-11 §31 steps 10-12).
 *
 * @module ncc-11-js
 */

import {
    SimplePool,
    finalizeEvent,
    verifyEvent,
    getPublicKey,
    nip44,
    Event,
    UnsignedEvent,
    Filter
} from 'nostr-tools';

export const KIND_TRUST_POLICY = 30067;

/** Well-known policy keys defined directly by NCC-11 (§9, §10.1, §11-14). */
export const RULE_KEYS = {
    KEY_PINNING: 'ncc:02:key-pinning',
    ATTESTATION: 'ncc:02:attestation',
    STALE_FALLBACK: 'ncc:05:stale-fallback',
    MAX_STALE_AGE: 'ncc:05:max-stale-age',
    OPERATOR_ACTIONS: 'ncc:09:operator-actions',
    OPERATOR_STATE: 'ncc:10:operator-state'
} as const;

/** Build the `ncc:05:transport:<scheme>` policy key for a transport (§12). */
export function transportRuleKey(scheme: string): string {
    return `ncc:05:transport:${scheme}`;
}

// --- Error classes ---

export class NCC11Error extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'NCC11Error';
    }
}

export class NCC11ArgumentError extends NCC11Error {
    constructor(message: string) {
        super(message);
        this.name = 'NCC11ArgumentError';
    }
}

// --- Shared tag/rule types ---

/** A `["rule", "<policy-key>", "<value>"]` pair, without the leading tag name. */
export type RuleTuple = [key: string, value: string];

export interface RawRuleSet {
    /** Policy key -> value. A key mapped to `null` had conflicting values (§23) and is unresolved. */
    rules: Map<string, string | null>;
    trustedCertifiers: Set<string>;
}

function emptyRuleSet(): RawRuleSet {
    return { rules: new Map(), trustedCertifiers: new Set() };
}

/**
 * Fold a flat list of `["rule", k, v]` / `["trust", "certifier", pk]`
 * tag-shaped arrays into a RawRuleSet, marking any policy key that appears
 * with disagreeing values as unresolved per §23.
 */
function foldTags(tags: string[][]): RawRuleSet {
    const set = emptyRuleSet();
    for (const tag of tags) {
        if (tag[0] === 'rule' && tag[1] !== undefined && tag[2] !== undefined) {
            const [, key, value] = tag;
            if (set.rules.has(key)) {
                const existing = set.rules.get(key);
                if (existing !== null && existing !== value) set.rules.set(key, null);
            } else {
                set.rules.set(key, value);
            }
        } else if (tag[0] === 'trust' && tag[1] === 'certifier' && tag[2]) {
            set.trustedCertifiers.add(tag[2]);
        }
    }
    return set;
}

// --- Building (§5, §6, §10, §16) ---

export interface BuildTrustPolicyOptions {
    /** Policy-owner secret key. Private content, when present, is encrypted to this same identity. */
    secretKey: Uint8Array;
    /** The `d` tag identifying this named policy profile (§5.2). */
    policyId: string;
    /** Public `["rule", key, value]` entries. */
    publicRules?: RuleTuple[];
    /** Public `["trust", "certifier", pubkey]` entries. */
    publicTrustedCertifiers?: string[];
    /** Private `["rule", key, value]` entries, encrypted into `content` (§16). */
    privateRules?: RuleTuple[];
    /** Private `["trust", "certifier", pubkey]` entries, encrypted into `content` (§16). */
    privateTrustedCertifiers?: string[];
    createdAt?: number;
}

function conversationKeyForSelf(secretKey: Uint8Array): Uint8Array {
    const ownPubkey = getPublicKey(secretKey);
    return nip44.v2.utils.getConversationKey(secretKey, ownPubkey);
}

/**
 * Build and sign a kind:30067 trust-policy event per NCC-11 §5.
 *
 * When `privateRules` or `privateTrustedCertifiers` are given, they are
 * JSON-encoded as tag-shaped arrays and NIP-44 encrypted to the policy
 * owner's own pubkey, following the NIP-51 private-list pattern (§16).
 */
export function buildTrustPolicy(opts: BuildTrustPolicyOptions): Event {
    const {
        secretKey,
        policyId,
        publicRules = [],
        publicTrustedCertifiers = [],
        privateRules = [],
        privateTrustedCertifiers = [],
        createdAt
    } = opts;

    if (!policyId) {
        throw new NCC11ArgumentError('policyId (the "d" tag) is required');
    }

    const hasAnyRule =
        publicRules.length > 0 ||
        publicTrustedCertifiers.length > 0 ||
        privateRules.length > 0 ||
        privateTrustedCertifiers.length > 0;
    if (!hasAnyRule) {
        throw new NCC11ArgumentError(
            'a policy must contain at least one recognised or extension rule, public or private (§5.3)'
        );
    }

    const tags: string[][] = [['d', policyId]];
    for (const [key, value] of publicRules) tags.push(['rule', key, value]);
    for (const pubkey of publicTrustedCertifiers) tags.push(['trust', 'certifier', pubkey]);

    let content = '';
    if (privateRules.length > 0 || privateTrustedCertifiers.length > 0) {
        const privateTags: string[][] = [];
        for (const [key, value] of privateRules) privateTags.push(['rule', key, value]);
        for (const pubkey of privateTrustedCertifiers) privateTags.push(['trust', 'certifier', pubkey]);
        const conversationKey = conversationKeyForSelf(secretKey);
        content = nip44.v2.encrypt(JSON.stringify(privateTags), conversationKey);
    }

    const unsigned: UnsignedEvent = {
        kind: KIND_TRUST_POLICY,
        pubkey: getPublicKey(secretKey),
        created_at: createdAt ?? Math.floor(Date.now() / 1000),
        tags,
        content
    };

    return finalizeEvent(unsigned, secretKey);
}

// --- Parsing (§5, §6, §10) ---

export interface ParsedPolicy {
    event: Event;
    /** The policy-owner pubkey (event author). */
    ownerPubkey: string;
    /** The `d` tag value (§5.2). */
    policyId: string;
    createdAt: number;
    /** Public rules and trusted certifiers read from event tags. */
    public: RawRuleSet;
}

/**
 * Parse and verify a raw event as an NCC-11 trust policy. Returns `null`
 * (rather than throwing) for anything that doesn't structurally conform,
 * matching the parse style used by other ncc-*-js reference libraries.
 */
export function parseTrustPolicy(event: Event): ParsedPolicy | null {
    if (event.kind !== KIND_TRUST_POLICY) return null;
    if (!verifyEvent(event)) return null;

    const policyId = event.tags.find((t) => t[0] === 'd')?.[1];
    if (!policyId) return null;

    return {
        event,
        ownerPubkey: event.pubkey,
        policyId,
        createdAt: event.created_at,
        public: foldTags(event.tags)
    };
}

/**
 * Decrypt and parse the private policy content of an NCC-11 event (§16).
 * Returns `null` if there is no private content, or if it fails to decrypt
 * or parse — callers should then fall back to public-only rules per §17,
 * without assuming those public rules are the complete policy.
 */
export function decryptPrivatePolicy(event: Event, secretKey: Uint8Array): RawRuleSet | null {
    if (!event.content) return null;

    try {
        const conversationKey = conversationKeyForSelf(secretKey);
        const plaintext = nip44.v2.decrypt(event.content, conversationKey);
        const parsedTags = JSON.parse(plaintext);
        if (!Array.isArray(parsedTags)) return null;
        return foldTags(parsedTags as string[][]);
    } catch {
        return null;
    }
}

// --- Combining public + private (§17) ---

export interface EffectivePolicy {
    event: Event;
    ownerPubkey: string;
    policyId: string;
    createdAt: number;
    /** Resolved policy key -> value. A key absent here is unspecified (§21) or was in conflict (§23). */
    rules: Map<string, string>;
    trustedCertifiers: Set<string>;
    /** True once private content was successfully decrypted and folded in. */
    privateContentApplied: boolean;
}

/**
 * Combine a parsed policy's public rules with its (optionally already
 * decrypted) private rules, per §17: a private rule takes precedence over
 * a public rule for the same key. A public-only combine still safely
 * ignores any publicly-conflicted key (§23).
 */
export function combinePolicy(parsed: ParsedPolicy, privateSet: RawRuleSet | null = null): EffectivePolicy {
    const rules = new Map<string, string>();
    for (const [key, value] of parsed.public.rules) {
        if (value !== null) rules.set(key, value);
    }
    const trustedCertifiers = new Set(parsed.public.trustedCertifiers);

    if (privateSet) {
        for (const [key, value] of privateSet.rules) {
            if (value !== null) rules.set(key, value);
            else rules.delete(key);
        }
        for (const pubkey of privateSet.trustedCertifiers) trustedCertifiers.add(pubkey);
    }

    return {
        event: parsed.event,
        ownerPubkey: parsed.ownerPubkey,
        policyId: parsed.policyId,
        createdAt: parsed.createdAt,
        rules,
        trustedCertifiers,
        privateContentApplied: privateSet !== null
    };
}

// --- Addressable-event replacement (§18) ---

/**
 * Resolve the current policy event among candidates sharing the same
 * `kind + pubkey + d`, applying NIP-01 replacement semantics: the highest
 * `created_at` wins, with the lowest event id breaking a tie (§18).
 */
export function resolveCurrentPolicyEvent(candidates: Event[]): Event | null {
    if (candidates.length === 0) return null;
    return candidates.reduce((latest, candidate) => {
        if (candidate.created_at > latest.created_at) return candidate;
        if (candidate.created_at < latest.created_at) return latest;
        return candidate.id < latest.id ? candidate : latest;
    });
}

// --- Rule evaluation helpers (§21, §23, §24) ---

/** Read a resolved policy key, or `undefined` if unspecified (§21) or unresolved (§23). Unknown keys are treated the same way (§24). */
export function getRule(policy: EffectivePolicy, key: string): string | undefined {
    return policy.rules.get(key);
}

/** Whether `pubkey` is named as a trusted NCC-02 certifier in this policy (§10). This does not itself validate any attestation. */
export function isCertifierTrusted(policy: EffectivePolicy, pubkey: string): boolean {
    return policy.trustedCertifiers.has(pubkey);
}

/** Read the `ncc:05:transport:<scheme>` rule for a given transport scheme (§12). */
export function getTransportRule(policy: EffectivePolicy, scheme: string): 'allow' | 'deny' | undefined {
    const value = getRule(policy, transportRuleKey(scheme));
    return value === 'allow' || value === 'deny' ? value : undefined;
}

/** Read `ncc:05:max-stale-age` as a non-negative integer, or `undefined` if absent or not a valid integer (§11.1). */
export function getMaxStaleAgeSeconds(policy: EffectivePolicy): number | undefined {
    const raw = getRule(policy, RULE_KEYS.MAX_STALE_AGE);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : undefined;
}

// --- Publishing ---

export async function publishTrustPolicy(
    pool: SimplePool,
    relays: string[],
    opts: BuildTrustPolicyOptions
): Promise<Event> {
    const event = buildTrustPolicy(opts);
    await Promise.any(pool.publish(relays, event));
    return event;
}

// --- Client resolution (§31) ---

export interface ResolveTrustPolicyOptions {
    /** Policy-owner pubkey. */
    ownerPubkey: string;
    /** The named policy profile to retrieve, e.g. "default" (§5.2). */
    policyId: string;
    /** Supply this only when resolving your own policy, to decrypt private content (§16). */
    secretKey?: Uint8Array;
    timeoutMs?: number;
}

/**
 * Retrieve, verify, and resolve the current NCC-11 policy for an owner and
 * policy id, decrypting private content when `secretKey` is supplied,
 * following the client evaluation procedure of §31 (steps 3-8). Returns
 * `null` if no valid policy event is found.
 */
export async function resolveTrustPolicy(
    pool: SimplePool,
    relays: string[],
    opts: ResolveTrustPolicyOptions
): Promise<EffectivePolicy | null> {
    const { ownerPubkey, policyId, secretKey, timeoutMs = 5000 } = opts;

    const events = await pool.querySync(
        relays,
        { kinds: [KIND_TRUST_POLICY], authors: [ownerPubkey], '#d': [policyId] } as Filter,
        { maxWait: timeoutMs }
    );

    const candidates = events.filter((e) => {
        const parsed = parseTrustPolicy(e);
        return parsed !== null && parsed.policyId === policyId;
    });

    const current = resolveCurrentPolicyEvent(candidates);
    if (!current) return null;

    const parsed = parseTrustPolicy(current);
    if (!parsed) return null;

    const privateSet = secretKey ? decryptPrivatePolicy(current, secretKey) : null;
    return combinePolicy(parsed, privateSet);
}
