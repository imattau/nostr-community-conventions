/**
 * Spec-compliance smoke test for ncc-10-js.
 * Exercises build -> parse -> resolve -> client-resolution against an
 * in-memory mock relay pool, with no network access required.
 */

import { generateSecretKey, getPublicKey, Event, Filter } from 'nostr-tools';
import {
    buildDirectState,
    buildOperatorState,
    parseDirectState,
    parseOperatorState,
    resolveCurrentState,
    resolveServiceState,
    operatorAddressId,
    KIND_OPERATIONAL_STATE,
    NCC10ArgumentError
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
    const skService = generateSecretKey();
    const pkService = getPublicKey(skService);
    const skOperatorB = generateSecretKey();
    const pkOperatorB = getPublicKey(skOperatorB);
    const skOperatorC = generateSecretKey();
    const pkOperatorC = getPublicKey(skOperatorC);

    // 4: building a state with an unrecognised value is rejected.
    let threw = false;
    try {
        buildDirectState({ secretKey: skService, service: 'relay', state: 'down' as any });
    } catch (e) {
        threw = e instanceof NCC10ArgumentError;
    }
    assert(threw, 'building a direct state with an unrecognised state value is rejected');

    // 5: build a basic direct state and check its shape.
    const direct1 = buildDirectState({
        secretKey: skService,
        service: 'relay',
        state: 'degraded',
        since: 1_790_379_700,
        content: 'Intermittent upstream connectivity.',
        createdAt: 1_000_000
    });
    assert(direct1.kind === KIND_OPERATIONAL_STATE, 'direct state uses kind 30065');
    assert(direct1.tags.find((t) => t[0] === 'd')?.[1] === 'relay', 'direct state d tag equals the service id (§5.2)');
    assert(direct1.tags.some((t) => t[0] === 'state' && t[1] === 'degraded'), 'direct state carries the declared state');

    // 5: parsing a validly signed direct state.
    const parsedDirect1 = parseDirectState(direct1);
    assert(parsedDirect1 !== null, 'a validly signed direct state parses successfully');
    assert(parsedDirect1!.state === 'degraded', 'parsed direct state has the expected state value');

    // Tampered signature must fail verification.
    const tampered: Event = JSON.parse(JSON.stringify(direct1));
    tampered.content = 'tampered';
    assert(parseDirectState(tampered) === null, 'a tampered direct state fails signature verification');

    // 10: a newer direct state replaces the older one under addressable-event replacement.
    const direct2 = buildDirectState({ secretKey: skService, service: 'relay', state: 'operational', createdAt: 1_200_000 });
    const parsedDirect2 = parseDirectState(direct2)!;
    const currentDirect = resolveCurrentState([parsedDirect1!, parsedDirect2]);
    assert(currentDirect === parsedDirect2, 'the later created_at wins under addressable-event replacement (§10)');

    // 12: build and parse an operator-published state.
    const operatorState1 = buildOperatorState({
        secretKey: skOperatorB,
        servicePubkey: pkService,
        service: 'relay',
        state: 'maintenance',
        expectedUntil: 1_790_387_200,
        createdAt: 1_000_000
    });
    assert(
        operatorState1.tags.find((t) => t[0] === 'd')?.[1] === operatorAddressId(pkService, 'relay'),
        'operator state d tag is servicePubkey:service (§12)'
    );
    assert(
        operatorState1.tags.some((t) => t[0] === 'operator_for' && t[1] === pkService && t[2] === 'relay'),
        'operator state carries the operator_for principal reference'
    );

    const parsedOperator1 = parseOperatorState(operatorState1);
    assert(parsedOperator1 !== null, 'a validly signed operator state parses successfully');
    assert(parsedOperator1!.authorPubkey === pkOperatorB, 'the operator remains the event author (§12)');

    // parseDirectState must not accept an operator-shaped event, and vice versa.
    assert(parseDirectState(operatorState1) === null, 'an operator state does not parse as a direct state');
    assert(parseOperatorState(direct1) === null, 'a direct state does not parse as an operator state');

    // 25: client resolution prefers a valid direct state over operator state.
    const poolWithDirect = new MockPool([direct2, operatorState1]) as any;
    const resolvedWithDirect = await resolveServiceState(poolWithDirect, ['wss://mock'], {
        servicePubkey: pkService,
        service: 'relay',
        isAuthorisedOperator: async () => true
    });
    assert(resolvedWithDirect.status === 'direct', 'direct state takes priority over operator state when both exist (§19)');

    // 25: falls back to operator state when no direct state is available.
    const poolOperatorOnly = new MockPool([operatorState1]) as any;
    const resolvedOperatorOnly = await resolveServiceState(poolOperatorOnly, ['wss://mock'], {
        servicePubkey: pkService,
        service: 'relay',
        isAuthorisedOperator: async (op) => op === pkOperatorB
    });
    assert(resolvedOperatorOnly.status === 'operator', 'operator state is used when no direct state exists');
    assert(
        resolvedOperatorOnly.status === 'operator' && resolvedOperatorOnly.state.event.id === operatorState1.id,
        'the resolved operator state is the authorised operator event'
    );

    // 13: an operator event from a non-authorised operator is ignored.
    const resolvedUnauthorised = await resolveServiceState(poolOperatorOnly, ['wss://mock'], {
        servicePubkey: pkService,
        service: 'relay',
        isAuthorisedOperator: async () => false
    });
    assert(resolvedUnauthorised.status === 'unknown', 'an operator event fails resolution once NCC-09 authority is denied (§13)');

    // 20: two authorised operators disagreeing yields an explicit conflict, not a silent pick.
    const operatorStateC = buildOperatorState({
        secretKey: skOperatorC,
        servicePubkey: pkService,
        service: 'relay',
        state: 'unavailable',
        createdAt: 1_000_500
    });
    const poolTwoOperators = new MockPool([operatorState1, operatorStateC]) as any;
    const resolvedConflict = await resolveServiceState(poolTwoOperators, ['wss://mock'], {
        servicePubkey: pkService,
        service: 'relay',
        isAuthorisedOperator: async () => true
    });
    assert(resolvedConflict.status === 'conflict', 'disagreeing authorised operator states are reported as a conflict (§20)');
    assert(
        resolvedConflict.status === 'conflict' && resolvedConflict.candidates.length === 2,
        'the conflict result carries every disagreeing candidate'
    );

    // 20: two authorised operators agreeing resolves cleanly.
    const operatorStateBAgain = buildOperatorState({
        secretKey: skOperatorC,
        servicePubkey: pkService,
        service: 'relay',
        state: 'maintenance',
        createdAt: 1_000_500
    });
    const poolAgreeing = new MockPool([operatorState1, operatorStateBAgain]) as any;
    const resolvedAgreeing = await resolveServiceState(poolAgreeing, ['wss://mock'], {
        servicePubkey: pkService,
        service: 'relay',
        isAuthorisedOperator: async () => true
    });
    assert(resolvedAgreeing.status === 'operator', 'agreeing authorised operator states resolve without conflict (§20)');

    // 21: no events at all resolves to unknown, never a guessed state.
    const emptyPool = new MockPool([]) as any;
    const resolvedEmpty = await resolveServiceState(emptyPool, ['wss://mock'], {
        servicePubkey: pkService,
        service: 'relay',
        isAuthorisedOperator: async () => true
    });
    assert(resolvedEmpty.status === 'unknown', 'absence of any NCC-10 event resolves to unknown, not a guessed state (§21)');

    if (failures > 0) {
        console.error(`\n${failures} check(s) failed.`);
        process.exit(1);
    }
    console.log('\nAll checks passed.');
}

main();
