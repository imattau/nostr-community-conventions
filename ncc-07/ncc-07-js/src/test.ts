/**
 * Spec-compliance smoke test for ncc-07-js.
 * Exercises build -> parse -> resolve against an in-memory mock relay pool,
 * with no network access required.
 */

import { generateSecretKey, getPublicKey, Event, Filter } from 'nostr-tools';
import {
    buildCapabilityManifest,
    parseCapabilityManifest,
    resolveCapabilityManifest,
    hasCapability,
    nccCapability,
    pubkeyCapability,
    isWellFormedCapability,
    capabilityNamespace,
    KIND_CAPABILITY_MANIFEST,
    NCC07ArgumentError
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
                const dTag = e.tags.find((t) => t[0] === 'd')?.[1];
                if (!dTag || !wantD.includes(dTag)) return false;
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
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);

    // 6.2 required tags: at least one `cap`, must throw with none.
    let threw = false;
    try {
        buildCapabilityManifest({ secretKey: sk, capabilities: [] });
    } catch (e) {
        threw = e instanceof NCC07ArgumentError;
    }
    assert(threw, 'building a manifest with zero capabilities is rejected');

    // 7. identifier construction + namespace detection.
    const authorPubkey = getPublicKey(generateSecretKey());
    const capNcc05 = nccCapability(5);
    const capBackup = pubkeyCapability(authorPubkey, 'remote-backup');
    assert(capNcc05 === 'ncc:5', 'nccCapability formats ncc:<number>');
    assert(capabilityNamespace(capNcc05) === 'ncc', 'ncc:<n> resolves to ncc namespace');
    assert(capabilityNamespace(capBackup) === 'pubkey', 'pubkey:<hex>:<name> resolves to pubkey namespace');
    assert(capabilityNamespace('experimental-thing') === 'unknown', 'unrecognised identifiers are unknown, not invalid');
    assert(isWellFormedCapability('ncc:02'), 'lowercase identifiers are well-formed');
    assert(!isWellFormedCapability('NCC:02'), 'uppercase identifiers are not well-formed');

    // 6.1/6.2/6.4: build a manifest and check its shape.
    const manifest = buildCapabilityManifest({
        secretKey: sk,
        capabilities: ['ncc:02', 'ncc:05', capBackup]
    });
    assert(manifest.kind === KIND_CAPABILITY_MANIFEST, 'manifest uses kind 30062');
    assert(manifest.tags.some((t) => t[0] === 'd' && t[1] === 'capabilities'), 'manifest has d=capabilities');
    assert(manifest.content === '', 'manifest content is empty');

    // 9: parsing / verification round-trip.
    const parsed = parseCapabilityManifest(manifest);
    assert(parsed !== null, 'a validly signed manifest parses successfully');
    assert(!!parsed && parsed.capabilities.length === 3, 'all cap tags are recovered');
    assert(hasCapability(parsed, 'ncc:05'), 'hasCapability finds an asserted capability');
    assert(!hasCapability(parsed, 'ncc:99'), 'hasCapability rejects an unasserted capability');

    // Tampered signature must fail verification (14.1 self-assertion still requires a valid sig).
    // Round-trip through JSON to strip nostr-tools' internal verified-cache symbol,
    // so the tampered copy is re-verified from scratch rather than reusing the
    // original event's cached "verified" result.
    const tampered: Event = JSON.parse(JSON.stringify(manifest));
    tampered.content = 'tampered';
    assert(parseCapabilityManifest(tampered) === null, 'a tampered event fails signature verification');

    // 9.1 replacement: newest created_at wins when resolving.
    const older = buildCapabilityManifest({
        secretKey: sk,
        capabilities: ['ncc:02'],
        createdAt: 1000
    });
    const newer = buildCapabilityManifest({
        secretKey: sk,
        capabilities: ['ncc:02', 'ncc:05', 'ncc:07'],
        createdAt: 2000
    });
    const pool = new MockPool([older, newer]) as any;
    const resolved = await resolveCapabilityManifest(pool, ['wss://mock'], pk);
    assert(!!resolved && resolved.createdAt === 2000, 'resolution keeps only the latest manifest');
    assert(!!resolved && resolved.capabilities.length === 3, 'resolved manifest carries the newest capability set');

    if (failures > 0) {
        console.error(`\n${failures} check(s) failed.`);
        process.exit(1);
    }
    console.log('\nAll checks passed.');
}

main();
