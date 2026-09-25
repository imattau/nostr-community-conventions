/**
 * Spec-compliance smoke test for ncc-08-js.
 * Exercises build -> parse -> validate -> resolve against an in-memory mock
 * relay pool, with no network access required.
 */

import { generateSecretKey, getPublicKey, Event, Filter } from 'nostr-tools';
import {
    buildHandoverProposal,
    buildHandoverAcceptance,
    parseHandoverProposal,
    parseHandoverAcceptance,
    validateHandoverPair,
    handoverEffectiveTime,
    handoverState,
    resolveHandoverChain,
    KIND_HANDOVER,
    NCC08ArgumentError
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
            const wantService = (filter as any)['#service'] as string[] | undefined;
            if (wantService) {
                const service = e.tags.find((t) => t[0] === 'service')?.[1];
                if (!service || !wantService.includes(service)) return false;
            }
            const wantE = (filter as any)['#e'] as string[] | undefined;
            if (wantE) {
                const refs = e.tags.filter((t) => t[0] === 'e').map((t) => t[1]);
                if (!refs.some((r) => wantE.includes(r))) return false;
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
    const skA = generateSecretKey();
    const pkA = getPublicKey(skA);
    const skB = generateSecretKey();
    const pkB = getPublicKey(skB);
    const skC = generateSecretKey();
    const pkC = getPublicKey(skC);

    // 8.1 required tags: successor must be well-formed.
    let threw = false;
    try {
        buildHandoverProposal({ secretKey: skA, service: 'relay', successorPubkey: 'not-a-pubkey' });
    } catch (e) {
        threw = e instanceof NCC08ArgumentError;
    }
    assert(threw, 'building a proposal with a malformed successor pubkey is rejected');

    // 8/9: build a basic proposal + acceptance and check their shape.
    const proposal = buildHandoverProposal({
        secretKey: skA,
        service: 'relay',
        successorPubkey: pkB,
        reason: 'planned service key rotation',
        createdAt: 1_000_000
    });
    assert(proposal.kind === KIND_HANDOVER, 'proposal uses kind 1070');
    assert(proposal.tags.some((t) => t[0] === 'role' && t[1] === 'predecessor'), 'proposal has role=predecessor');
    assert(proposal.tags.filter((t) => t[0] === 'p').length === 1, 'proposal has exactly one p tag');

    const acceptance = buildHandoverAcceptance({ secretKey: skB, proposal, createdAt: 1_000_100 });
    assert(acceptance.kind === KIND_HANDOVER, 'acceptance uses kind 1070');
    assert(acceptance.tags.some((t) => t[0] === 'role' && t[1] === 'successor'), 'acceptance has role=successor');
    assert(acceptance.tags.some((t) => t[0] === 'e' && t[1] === proposal.id), 'acceptance references the proposal event id');

    // 9: an acceptance from the wrong key is rejected.
    threw = false;
    try {
        buildHandoverAcceptance({ secretKey: skC, proposal });
    } catch (e) {
        threw = e instanceof NCC08ArgumentError;
    }
    assert(threw, 'an acceptance signed by a non-named successor is rejected');

    // 10: parsing + full pair validation.
    const parsedProposal = parseHandoverProposal(proposal);
    const parsedAcceptance = parseHandoverAcceptance(acceptance);
    assert(parsedProposal !== null, 'a validly signed proposal parses successfully');
    assert(parsedAcceptance !== null, 'a validly signed acceptance parses successfully');

    const pairResult = validateHandoverPair(parsedProposal!, parsedAcceptance!);
    assert(pairResult.valid, 'a matching proposal/acceptance pair validates');
    assert(handoverEffectiveTime(parsedProposal!, parsedAcceptance!) === 1_000_100, 'effective time defaults to acceptance.created_at (§11.1)');
    assert(handoverState(parsedProposal!, parsedAcceptance!, 1_000_099) === 'accepted', 'state is "accepted" just before the effective time');
    assert(handoverState(parsedProposal!, parsedAcceptance!, 1_000_100) === 'effective', 'state is "effective" at the effective time');
    assert(handoverState(parsedProposal!, null, 1_000_100) === 'proposed', 'state is "proposed" with no acceptance yet');

    // 10.9: an acceptance referencing a different proposal event fails validation.
    const otherProposal = buildHandoverProposal({ secretKey: skA, service: 'relay', successorPubkey: pkB, createdAt: 1_000_000 });
    const mismatchedAcceptance = parseHandoverAcceptance(
        buildHandoverAcceptance({ secretKey: skB, proposal: otherProposal, createdAt: 1_000_100 })
    )!;
    // Force a mismatch: pair the original proposal with an acceptance for a
    // structurally-identical-but-different proposal event.
    const crossPair = validateHandoverPair(parsedProposal!, mismatchedAcceptance);
    assert(!crossPair.valid, 'an acceptance referencing a different proposal event fails validation');

    // 11.2: explicit effective time in the future.
    const futureProposal = buildHandoverProposal({
        secretKey: skA,
        service: 'wallet',
        successorPubkey: pkB,
        effective: 2_000_000,
        expires: 3_000_000,
        createdAt: 1_500_000
    });
    const futureAcceptance = buildHandoverAcceptance({ secretKey: skB, proposal: futureProposal, createdAt: 1_600_000 });
    const parsedFutureProposal = parseHandoverProposal(futureProposal)!;
    const parsedFutureAcceptance = parseHandoverAcceptance(futureAcceptance)!;
    assert(
        handoverEffectiveTime(parsedFutureProposal, parsedFutureAcceptance) === 2_000_000,
        'explicit effective timestamp overrides acceptance.created_at (§11.2)'
    );
    assert(handoverState(parsedFutureProposal, parsedFutureAcceptance, 1_900_000) === 'accepted', 'accepted-but-not-yet-effective state before the effective timestamp');
    assert(handoverState(parsedFutureProposal, parsedFutureAcceptance, 2_000_000) === 'effective', 'effective at the explicit effective timestamp');

    // 25.3: acceptance created after expiry is rejected at build time and by validation.
    threw = false;
    try {
        buildHandoverAcceptance({ secretKey: skB, proposal: futureProposal, createdAt: 3_500_000 });
    } catch (e) {
        threw = e instanceof NCC08ArgumentError;
    }
    assert(threw, 'building an acceptance after the proposal expires is rejected');

    // Tampered signature must fail verification.
    const tampered: Event = JSON.parse(JSON.stringify(proposal));
    tampered.content = 'tampered';
    assert(parseHandoverProposal(tampered) === null, 'a tampered proposal fails signature verification');

    // 14/27: chain resolution across two rotations, A -> B -> C.
    const p1 = buildHandoverProposal({ secretKey: skA, service: 'relay', successorPubkey: pkB, createdAt: 1000 });
    const a1 = buildHandoverAcceptance({ secretKey: skB, proposal: p1, createdAt: 1010 });
    const p2 = buildHandoverProposal({ secretKey: skB, service: 'relay', successorPubkey: pkC, createdAt: 2000 });
    const a2 = buildHandoverAcceptance({ secretKey: skC, proposal: p2, createdAt: 2010 });

    const pool = new MockPool([p1, a1, p2, a2]) as any;
    const result = await resolveHandoverChain(pool, ['wss://mock'], pkA, 'relay', { now: 5000 });
    assert(result.status === 'no_successor', 'a clean two-hop chain terminates once the final successor has no further handover');
    assert(result.current === pkC, 'chain resolution follows A -> B -> C to the final successor');
    assert(result.chain.length === 2, 'resolved chain records both handover links');

    // 15: conflicting completed handovers (A -> B and A -> D) are reported, not merged.
    const skD = generateSecretKey();
    const pkD = getPublicKey(skD);
    const p1b = buildHandoverProposal({ secretKey: skA, service: 'relay', successorPubkey: pkD, createdAt: 1500 });
    const a1b = buildHandoverAcceptance({ secretKey: skD, proposal: p1b, createdAt: 1510 });
    const conflictPool = new MockPool([p1, a1, p1b, a1b]) as any;
    const conflictResult = await resolveHandoverChain(conflictPool, ['wss://mock'], pkA, 'relay', { now: 5000 });
    assert(conflictResult.status === 'conflict', 'two completed handovers from the same predecessor are surfaced as a conflict');

    // 14: a loop (A -> B -> A) is detected rather than followed indefinitely.
    const pLoop = buildHandoverProposal({ secretKey: skB, service: 'relay', successorPubkey: pkA, createdAt: 3000 });
    const aLoop = buildHandoverAcceptance({ secretKey: skA, proposal: pLoop, createdAt: 3010 });
    const loopPool = new MockPool([p1, a1, pLoop, aLoop]) as any;
    const loopResult = await resolveHandoverChain(loopPool, ['wss://mock'], pkA, 'relay', { now: 5000 });
    assert(loopResult.status === 'loop', 'a handover loop is detected rather than followed indefinitely');

    // 12: no proposal at all resolves to no_successor.
    const emptyPool = new MockPool([]) as any;
    const emptyResult = await resolveHandoverChain(emptyPool, ['wss://mock'], pkA, 'relay', { now: 5000 });
    assert(emptyResult.status === 'no_successor', 'a service with no proposals has no successor');

    if (failures > 0) {
        console.error(`\n${failures} check(s) failed.`);
        process.exit(1);
    }
    console.log('\nAll checks passed.');
}

main();
