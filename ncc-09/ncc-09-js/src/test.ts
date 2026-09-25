/**
 * Spec-compliance smoke test for ncc-09-js.
 * Exercises build -> parse -> validate -> resolve -> fetch against an
 * in-memory mock relay pool, with no network access required.
 */

import { generateSecretKey, getPublicKey, Event, Filter } from 'nostr-tools';
import {
    buildAuthorityGrant,
    buildRevocation,
    parseAuthorityGrant,
    resolveCurrentGrant,
    validateAuthorityGrant,
    fetchAndValidateAuthority,
    authorityAddressId,
    KIND_AUTHORITY_GRANT,
    NCC09ArgumentError
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
    const skA = generateSecretKey(); // principal (service identity)
    const pkA = getPublicKey(skA);
    const skB = generateSecretKey(); // operator
    const pkB = getPublicKey(skB);

    // 6.3: an active grant requires a malformed operator pubkey to be rejected.
    let threw = false;
    try {
        buildAuthorityGrant({ secretKey: skA, service: 'relay', operatorPubkey: 'not-a-pubkey', scopes: ['x'] });
    } catch (e) {
        threw = e instanceof NCC09ArgumentError;
    }
    assert(threw, 'building a grant with a malformed operator pubkey is rejected');

    // 6.3: an active grant requires at least one scope.
    threw = false;
    try {
        buildAuthorityGrant({ secretKey: skA, service: 'relay', operatorPubkey: pkB, scopes: [] });
    } catch (e) {
        threw = e instanceof NCC09ArgumentError;
    }
    assert(threw, 'building an active grant with no scopes is rejected');

    // 6: build a basic active grant and check its shape.
    const grant1 = buildAuthorityGrant({
        secretKey: skA,
        service: 'relay',
        operatorPubkey: pkB,
        scopes: ['ncc:10:publish', 'pubkey:' + pkA + ':maintenance-report'],
        expiration: 2_000_000,
        createdAt: 1_000_000
    });
    assert(grant1.kind === KIND_AUTHORITY_GRANT, 'grant uses kind 30064');
    assert(grant1.tags.find((t) => t[0] === 'd')?.[1] === authorityAddressId('relay', pkB), 'grant d tag is service:operator');
    assert(grant1.tags.filter((t) => t[0] === 'p').length === 1, 'grant has exactly one p tag');
    assert(grant1.tags.some((t) => t[0] === 'status' && t[1] === 'active'), 'grant has status=active');
    assert(grant1.tags.filter((t) => t[0] === 'scope').length === 2, 'grant carries both scopes');

    // 12: parsing a validly signed grant.
    const parsed1 = parseAuthorityGrant(grant1);
    assert(parsed1 !== null, 'a validly signed grant parses successfully');
    assert(parsed1!.scopes.includes('ncc:10:publish'), 'parsed grant includes the expected scope');

    // 13: full grant validation for the correct principal/operator/service/scope.
    const okResult = validateAuthorityGrant(parsed1!, {
        principalPubkey: pkA,
        service: 'relay',
        operatorPubkey: pkB,
        scope: 'ncc:10:publish',
        now: 1_500_000
    });
    assert(okResult.valid, 'a matching, unexpired, active grant validates for its listed scope');

    // 13: validation fails for an unrecognised scope (§29.4 scope confusion).
    const wrongScope = validateAuthorityGrant(parsed1!, {
        principalPubkey: pkA,
        service: 'relay',
        operatorPubkey: pkB,
        scope: 'pubkey:someone-else:publish',
        now: 1_500_000
    });
    assert(!wrongScope.valid, 'validation fails for a scope not present on the grant');

    // 13: validation fails once now is past expiration (§29.6).
    const expiredResult = validateAuthorityGrant(parsed1!, {
        principalPubkey: pkA,
        service: 'relay',
        operatorPubkey: pkB,
        scope: 'ncc:10:publish',
        now: 2_000_001
    });
    assert(!expiredResult.valid, 'validation fails once the current time is past expiration');

    // 5: validation fails for a different service, even from the same principal/operator.
    const wrongService = validateAuthorityGrant(parsed1!, {
        principalPubkey: pkA,
        service: 'nsite',
        operatorPubkey: pkB,
        scope: 'ncc:10:publish',
        now: 1_500_000
    });
    assert(!wrongService.valid, 'authority for one service does not apply to another (§5)');

    // 14: updating authority replaces scopes rather than merging them.
    const grant2 = buildAuthorityGrant({
        secretKey: skA,
        service: 'relay',
        operatorPubkey: pkB,
        scopes: ['ncc:10:publish'],
        createdAt: 1_200_000
    });
    const parsed2 = parseAuthorityGrant(grant2)!;
    const current = resolveCurrentGrant([parsed1!, parsed2]);
    assert(current === parsed2, 'the later created_at wins under addressable-event replacement (§13, §29.5)');
    const dropped = validateAuthorityGrant(current!, {
        principalPubkey: pkA,
        service: 'relay',
        operatorPubkey: pkB,
        scope: 'pubkey:' + pkA + ':maintenance-report',
        now: 1_500_000
    });
    assert(!dropped.valid, 'a scope dropped in a newer grant is no longer authorised (§14)');

    // 15: revocation carries no scopes and invalidates the grant.
    threw = false;
    try {
        buildAuthorityGrant({ secretKey: skA, service: 'relay', operatorPubkey: pkB, status: 'revoked', scopes: ['x'] });
    } catch (e) {
        threw = e instanceof NCC09ArgumentError;
    }
    assert(threw, 'a revoked grant carrying scopes is rejected at build time');

    const revocation = buildRevocation({ secretKey: skA, service: 'relay', operatorPubkey: pkB, createdAt: 1_300_000 });
    const parsedRevocation = parseAuthorityGrant(revocation)!;
    const currentAfterRevoke = resolveCurrentGrant([parsed1!, parsed2, parsedRevocation]);
    assert(currentAfterRevoke === parsedRevocation, 'the revocation, being newest, becomes the current grant');
    const revokedResult = validateAuthorityGrant(currentAfterRevoke!, {
        principalPubkey: pkA,
        service: 'relay',
        operatorPubkey: pkB,
        scope: 'ncc:10:publish',
        now: 1_500_000
    });
    assert(!revokedResult.valid, 'a current revoked grant authorises nothing (§15)');

    // Tampered signature must fail verification.
    const tampered: Event = JSON.parse(JSON.stringify(grant1));
    tampered.content = 'tampered';
    assert(parseAuthorityGrant(tampered) === null, 'a tampered grant fails signature verification');

    // 12: end-to-end fetch + validate against a mock relay pool.
    const pool = new MockPool([grant1, grant2]) as any;
    const fetched = await fetchAndValidateAuthority(pool, ['wss://mock'], {
        principalPubkey: pkA,
        service: 'relay',
        operatorPubkey: pkB,
        scope: 'ncc:10:publish',
        now: 1_500_000
    });
    assert(fetched !== null, 'fetchAndValidateAuthority finds the current grant at the service/operator address');
    assert(fetched!.grant.event.id === grant2.id, 'fetchAndValidateAuthority resolves to the latest grant, not the oldest');
    assert(fetched!.result.valid, 'the resolved current grant validates for its retained scope');

    // 6.2: a grant published for a different operator does not appear at this address.
    const skC = generateSecretKey();
    const pkC = getPublicKey(skC);
    const noneResult = await fetchAndValidateAuthority(pool, ['wss://mock'], {
        principalPubkey: pkA,
        service: 'relay',
        operatorPubkey: pkC,
        scope: 'ncc:10:publish',
        now: 1_500_000
    });
    assert(noneResult === null, 'no grant is found at an address for an unauthorised operator');

    if (failures > 0) {
        console.error(`\n${failures} check(s) failed.`);
        process.exit(1);
    }
    console.log('\nAll checks passed.');
}

main();
