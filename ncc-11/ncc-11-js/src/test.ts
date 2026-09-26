/**
 * Spec-compliance smoke test for ncc-11-js.
 * Exercises build -> parse -> decrypt -> combine -> resolve against an
 * in-memory mock relay pool, with no network access required.
 */

import { generateSecretKey, getPublicKey, Event, Filter } from 'nostr-tools';
import {
    buildTrustPolicy,
    parseTrustPolicy,
    decryptPrivatePolicy,
    combinePolicy,
    resolveCurrentPolicyEvent,
    resolveTrustPolicy,
    getRule,
    isCertifierTrusted,
    getTransportRule,
    getMaxStaleAgeSeconds,
    RULE_KEYS,
    transportRuleKey,
    KIND_TRUST_POLICY,
    NCC11ArgumentError
} from './index.js';

class MockPool {
    private store: Event[];
    constructor(store: Event[]) {
        this.store = store;
    }
    async querySync(_relays: string[], filter: Filter): Promise<Event[]> {
        return this.store.filter((e) => {
            if (filter.kinds && !filter.kinds.includes(e.kind)) return false;
            if (filter.authors && !filter.authors.includes(e.pubkey)) return false;
            const wantD = (filter as any)['#d'] as string[] | undefined;
            if (wantD) {
                const d = e.tags.find((t) => t[0] === 'd')?.[1];
                if (!d || !wantD.includes(d)) return false;
            }
            return true;
        });
    }
}

let failures = 0;
function assert(cond: boolean, message: string) {
    if (!cond) {
        failures++;
        console.error(`FAIL: ${message}`);
    } else {
        console.log(`ok: ${message}`);
    }
}

async function main() {
    const skOwner = generateSecretKey();
    const pkOwner = getPublicKey(skOwner);
    const certifierA = generateSecretKey();
    const pkCertifierA = getPublicKey(certifierA);
    const certifierB = generateSecretKey();
    const pkCertifierB = getPublicKey(certifierB);

    // 5.3: a policy with no rules at all is rejected.
    let threw = false;
    try {
        buildTrustPolicy({ secretKey: skOwner, policyId: 'default' });
    } catch (e) {
        threw = e instanceof NCC11ArgumentError;
    }
    assert(threw, 'a policy with no public or private rules is rejected (§5.3)');

    // 5.3: an empty policyId is rejected.
    threw = false;
    try {
        buildTrustPolicy({ secretKey: skOwner, policyId: '', publicRules: [[RULE_KEYS.KEY_PINNING, 'require']] });
    } catch (e) {
        threw = e instanceof NCC11ArgumentError;
    }
    assert(threw, 'a policy without a policyId ("d" tag) is rejected (§5.2)');

    // 5, 6, 10: build a public policy matching the §15 example shape.
    const publicPolicy = buildTrustPolicy({
        secretKey: skOwner,
        policyId: 'default',
        publicRules: [
            [RULE_KEYS.KEY_PINNING, 'require'],
            [RULE_KEYS.ATTESTATION, 'require'],
            [RULE_KEYS.STALE_FALLBACK, 'allow'],
            [RULE_KEYS.MAX_STALE_AGE, '3600'],
            [transportRuleKey('https'), 'allow'],
            [transportRuleKey('http'), 'deny']
        ],
        publicTrustedCertifiers: [pkCertifierA],
        createdAt: 1_000_000
    });
    assert(publicPolicy.kind === KIND_TRUST_POLICY, 'a built policy uses kind 30067 (§5.1)');
    assert(publicPolicy.tags.find((t) => t[0] === 'd')?.[1] === 'default', 'the d tag carries the policy id (§5.2)');
    assert(publicPolicy.content === '', 'a policy with no private rules has empty content');

    const parsedPublic = parseTrustPolicy(publicPolicy);
    assert(parsedPublic !== null, 'a validly signed policy parses successfully');
    assert(parsedPublic!.policyId === 'default', 'the parsed policy id matches the d tag');

    // Tampered signature must fail verification.
    const tampered: Event = JSON.parse(JSON.stringify(publicPolicy));
    tampered.tags = [...tampered.tags, ['rule', 'ncc:09:operator-actions', 'deny']];
    assert(parseTrustPolicy(tampered) === null, 'a tampered policy fails signature verification');

    const effectivePublicOnly = combinePolicy(parsedPublic!);
    assert(getRule(effectivePublicOnly, RULE_KEYS.KEY_PINNING) === 'require', 'a public rule resolves via getRule (§9.1)');
    assert(isCertifierTrusted(effectivePublicOnly, pkCertifierA), 'a publicly trusted certifier is recognised (§10)');
    assert(!isCertifierTrusted(effectivePublicOnly, pkCertifierB), 'an untrusted certifier is not recognised (§10)');
    assert(getTransportRule(effectivePublicOnly, 'https') === 'allow', 'transport allow rule resolves (§12)');
    assert(getTransportRule(effectivePublicOnly, 'http') === 'deny', 'transport deny rule resolves (§12)');
    assert(getTransportRule(effectivePublicOnly, 'onion') === undefined, 'an unlisted transport is unspecified, not inferred (§12)');
    assert(getMaxStaleAgeSeconds(effectivePublicOnly) === 3600, 'max-stale-age parses as an integer (§11.1)');
    assert(effectivePublicOnly.privateContentApplied === false, 'a public-only combine reports private content as not applied');

    // 24: an unrecognised policy key is retained as opaque data, not rejected.
    const withUnknown = buildTrustPolicy({
        secretKey: skOwner,
        policyId: 'default',
        publicRules: [[RULE_KEYS.KEY_PINNING, 'require'], ['ncc:27:future-behaviour', 'require']],
        createdAt: 1_000_000
    });
    const parsedUnknown = parseTrustPolicy(withUnknown)!;
    assert(parsedUnknown !== null, 'a policy containing an unknown rule key still parses (§24)');
    const effectiveUnknown = combinePolicy(parsedUnknown);
    assert(
        getRule(effectiveUnknown, 'ncc:27:future-behaviour') === 'require',
        'an unknown rule key is preserved as opaque data for callers that do understand it (§24)'
    );

    // 23: two conflicting public rules for the same key resolve as unresolved (absent), not tag order.
    const conflicting = buildTrustPolicy({
        secretKey: skOwner,
        policyId: 'default',
        publicRules: [
            [RULE_KEYS.OPERATOR_ACTIONS, 'allow'],
            [RULE_KEYS.OPERATOR_ACTIONS, 'deny']
        ],
        createdAt: 1_000_000
    });
    const effectiveConflicting = combinePolicy(parseTrustPolicy(conflicting)!);
    assert(
        getRule(effectiveConflicting, RULE_KEYS.OPERATOR_ACTIONS) === undefined,
        'contradictory public rules for the same key are treated as unresolved, not picked by tag order (§23)'
    );

    // 16, 17: build a mixed public/private policy and decrypt it.
    const mixedPolicy = buildTrustPolicy({
        secretKey: skOwner,
        policyId: 'default',
        publicRules: [[RULE_KEYS.KEY_PINNING, 'require']],
        publicTrustedCertifiers: [pkCertifierA],
        privateRules: [[transportRuleKey('onion'), 'allow'], [RULE_KEYS.OPERATOR_ACTIONS, 'deny']],
        privateTrustedCertifiers: [pkCertifierB],
        createdAt: 1_000_000
    });
    assert(mixedPolicy.content.length > 0, 'a policy with private rules has non-empty encrypted content (§16)');

    const parsedMixed = parseTrustPolicy(mixedPolicy)!;
    const decrypted = decryptPrivatePolicy(mixedPolicy, skOwner);
    assert(decrypted !== null, 'private content decrypts successfully for the policy owner (§16)');
    assert(decrypted!.rules.get(transportRuleKey('onion')) === 'allow', 'a decrypted private rule is recovered correctly');

    const effectiveMixed = combinePolicy(parsedMixed, decrypted);
    assert(effectiveMixed.privateContentApplied === true, 'a successful decrypt is reflected in privateContentApplied');
    assert(getRule(effectiveMixed, RULE_KEYS.KEY_PINNING) === 'require', 'a public-only key survives combining with private rules');
    assert(getTransportRule(effectiveMixed, 'onion') === 'allow', 'a private-only rule is present after combining (§17)');
    assert(isCertifierTrusted(effectiveMixed, pkCertifierB), 'a private trusted certifier is present after combining (§17)');

    // 17: a private rule overrides a public rule for the same key.
    const overridePolicy = buildTrustPolicy({
        secretKey: skOwner,
        policyId: 'default',
        publicRules: [[RULE_KEYS.OPERATOR_ACTIONS, 'allow']],
        privateRules: [[RULE_KEYS.OPERATOR_ACTIONS, 'deny']],
        createdAt: 1_000_000
    });
    const parsedOverride = parseTrustPolicy(overridePolicy)!;
    const decryptedOverride = decryptPrivatePolicy(overridePolicy, skOwner);
    const effectiveOverride = combinePolicy(parsedOverride, decryptedOverride);
    assert(
        getRule(effectiveOverride, RULE_KEYS.OPERATOR_ACTIONS) === 'deny',
        'a private rule takes precedence over a public rule for the same key (§17)'
    );

    // 17: a client unable to decrypt still gets public rules, without private ones assumed.
    const effectiveUndecrypted = combinePolicy(parsedOverride, null);
    assert(
        getRule(effectiveUndecrypted, RULE_KEYS.OPERATOR_ACTIONS) === 'allow',
        'without decryption, only the public rule is visible (§17)'
    );
    assert(effectiveUndecrypted.privateContentApplied === false, 'an undecrypted policy reports private content as not applied');

    // decrypting with the wrong key must not fabricate a result.
    const wrongKey = generateSecretKey();
    assert(decryptPrivatePolicy(mixedPolicy, wrongKey) === null, 'decrypting private content with the wrong key fails safely');

    // 18: a newer policy event replaces the older one under addressable-event replacement.
    const older = buildTrustPolicy({ secretKey: skOwner, policyId: 'default', publicRules: [[RULE_KEYS.KEY_PINNING, 'prefer']], createdAt: 1_000_000 });
    const newer = buildTrustPolicy({ secretKey: skOwner, policyId: 'default', publicRules: [[RULE_KEYS.KEY_PINNING, 'require']], createdAt: 1_200_000 });
    const current = resolveCurrentPolicyEvent([older, newer]);
    assert(current === newer, 'the later created_at wins under addressable-event replacement (§18)');

    // 19: distinct named policies are independent addressable events.
    const strictPolicy = buildTrustPolicy({
        secretKey: skOwner,
        policyId: 'strict',
        publicRules: [[RULE_KEYS.KEY_PINNING, 'require'], [RULE_KEYS.STALE_FALLBACK, 'deny']],
        createdAt: 1_000_000
    });
    assert(
        strictPolicy.tags.find((t) => t[0] === 'd')?.[1] === 'strict',
        'a differently-named policy profile is a distinct addressable event (§19)'
    );

    // 31: full client resolution against a mock pool, including decryption.
    const pool = new MockPool([older, newer, mixedPolicy]) as any;
    const resolvedDefault = await resolveTrustPolicy(pool, ['wss://mock'], {
        ownerPubkey: pkOwner,
        policyId: 'default',
        secretKey: skOwner
    });
    assert(resolvedDefault !== null, 'resolveTrustPolicy finds the current policy for an owner/policyId (§31)');
    assert(
        resolvedDefault!.event.id === newer.id,
        'resolveTrustPolicy picks the current addressable event among multiple candidates (§18, §31)'
    );

    const poolMixedOnly = new MockPool([mixedPolicy]) as any;
    const resolvedNoKey = await resolveTrustPolicy(poolMixedOnly, ['wss://mock'], {
        ownerPubkey: pkOwner,
        policyId: 'default'
    });
    assert(resolvedNoKey !== null, 'resolveTrustPolicy still returns a policy without a secretKey');
    assert(
        resolvedNoKey!.privateContentApplied === false,
        'without a secretKey, resolveTrustPolicy does not attempt decryption (§16, §17)'
    );
    assert(
        getRule(resolvedNoKey!, RULE_KEYS.KEY_PINNING) === 'require',
        'public rules remain available without a secretKey'
    );

    // 21: no matching event at all resolves to null, never a guessed policy.
    const emptyPool = new MockPool([]) as any;
    const resolvedEmpty = await resolveTrustPolicy(emptyPool, ['wss://mock'], {
        ownerPubkey: pkOwner,
        policyId: 'unknown-profile'
    });
    assert(resolvedEmpty === null, 'absence of any matching policy event resolves to null, not a default (§21)');

    if (failures > 0) {
        console.error(`\n${failures} check(s) failed.`);
        process.exit(1);
    }
    console.log('\nAll checks passed.');
}

main();
