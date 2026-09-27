/**
 * Spec-compliance smoke test for ncc-13-js.
 * Exercises build -> parse -> resolve -> dependency/conflict/artefact
 * selection against in-memory fixtures, with no network access required.
 */

import { generateSecretKey, getPublicKey, Event, finalizeEvent, UnsignedEvent } from 'nostr-tools';
import {
    buildReleaseArtifactSet,
    parseRelease,
    resolveCurrentRelease,
    effectiveChannel,
    compareVersions,
    satisfiesConstraint,
    satisfiesConstraints,
    parseVersionConstraint,
    evaluateDependencies,
    evaluateConflicts,
    indexInstalled,
    selectArtifact,
    formatAddress,
    releaseIdentifier,
    KIND_SOFTWARE_APPLICATION,
    KIND_RELEASE_ARTIFACT_SET,
    KIND_FILE_METADATA,
    KIND_GIT_REPOSITORY,
    NCC13Error,
    NCC13ArgumentError
} from './index.js';

let failures = 0;
function assert(cond: boolean, message: string) {
    if (!cond) {
        failures++;
        console.error(`FAIL: ${message}`);
    } else {
        console.log(`ok: ${message}`);
    }
}

function makeFile(secretKey: Uint8Array, tags: string[][]): Event {
    const unsigned: UnsignedEvent = {
        kind: KIND_FILE_METADATA,
        pubkey: getPublicKey(secretKey),
        created_at: 1_000_000,
        tags,
        content: ''
    };
    return finalizeEvent(unsigned, secretKey);
}

function main() {
    const publisherSk = generateSecretKey();
    const publisherPk = getPublicKey(publisherSk);
    const runtimePublisherPk = getPublicKey(generateSecretKey());
    const legacyPublisherPk = getPublicKey(generateSecretKey());

    const appAddress = formatAddress(KIND_SOFTWARE_APPLICATION, publisherPk, 'com.example.app');
    const runtimeAddress = formatAddress(KIND_SOFTWARE_APPLICATION, runtimePublisherPk, 'com.example.runtime');
    const legacyAddress = formatAddress(KIND_SOFTWARE_APPLICATION, legacyPublisherPk, 'com.example.legacy');
    const repoAddress = formatAddress(KIND_GIT_REPOSITORY, publisherPk, 'example-app');

    // §6: building a release with a malformed application address is rejected.
    let threw = false;
    try {
        buildReleaseArtifactSet({ secretKey: publisherSk, applicationAddress: 'not-an-address', version: '1.0.0' });
    } catch (e) {
        threw = e instanceof NCC13ArgumentError;
    }
    assert(threw, 'building a release with a malformed application address is rejected');

    // §22: a commit without a source repository is rejected.
    threw = false;
    try {
        buildReleaseArtifactSet({
            secretKey: publisherSk,
            applicationAddress: appAddress,
            version: '1.0.0',
            commit: '7f83b1657ff1fc53b92dc18148a1d65dfa13514f'
        });
    } catch (e) {
        threw = e instanceof NCC13ArgumentError;
    }
    assert(threw, 'a commit declared without a source repository is rejected');

    // §5/§6/§21/§22/§24: build a full release matching the spec's worked example.
    const release1 = buildReleaseArtifactSet({
        secretKey: publisherSk,
        applicationAddress: appAddress,
        version: '1.4.2',
        versionScheme: 'semver',
        channel: 'stable',
        source: repoAddress,
        commit: '7f83b1657ff1fc53b92dc18148a1d65dfa13514f',
        requires: [{ address: runtimeAddress, constraint: '>=2.0.0' }],
        conflicts: [{ address: legacyAddress, constraint: '<2.0.0' }],
        createdAt: 1_000_000
    });
    assert(release1.kind === KIND_RELEASE_ARTIFACT_SET, 'release uses kind 30063');
    assert(
        release1.tags.find((t) => t[0] === 'd')?.[1] === releaseIdentifier('com.example.app', '1.4.2'),
        'release d tag follows the recommended <application-id>@<version> form (§5)'
    );

    const parsed1 = parseRelease(release1);
    assert(parsed1 !== null, 'a validly signed release parses successfully');
    assert(parsed1!.applicationAddress === appAddress, 'parsed release resolves the parent application address');
    assert(parsed1!.versionScheme === 'semver', 'parsed release carries the declared version scheme');
    assert(effectiveChannel(parsed1!) === 'stable', 'parsed release carries the declared channel');
    assert(parsed1!.source === repoAddress && parsed1!.commit?.length === 40, 'parsed release carries source + commit provenance');

    // §8.4: a release with no version_scheme tag defaults to opaque.
    const releaseOpaque = buildReleaseArtifactSet({
        secretKey: publisherSk,
        applicationAddress: appAddress,
        version: 'phoenix-7',
        createdAt: 900_000
    });
    const parsedOpaque = parseRelease(releaseOpaque)!;
    assert(parsedOpaque.versionScheme === 'opaque', 'a release with no version_scheme tag is treated as opaque (§8.4)');

    // §8.3: opaque versions must not be ordered.
    threw = false;
    try {
        compareVersions('phoenix-7', 'phoenix-8', 'opaque');
    } catch (e) {
        threw = e instanceof NCC13Error;
    }
    assert(threw, 'comparing opaque versions throws rather than guessing an order (§8.3)');

    // §8.1: semver ordering, including prerelease precedence.
    assert(compareVersions('1.4.2', '1.4.1', 'semver') > 0, 'semver: 1.4.2 > 1.4.1');
    assert(compareVersions('2.0.0-beta', '2.0.0', 'semver') < 0, 'semver: a prerelease has lower precedence than the release');
    assert(compareVersions('1.5.0', '1.4.2', 'semver') > 0, 'semver: minor version increments order correctly');

    // §13: cumulative constraints (>=2.0.0 AND <3.0.0).
    const constraints = ['>=2.0.0', '<3.0.0'].map((c) => parseVersionConstraint(c)!);
    assert(satisfiesConstraints('2.5.0', constraints, 'semver'), '2.5.0 satisfies >=2.0.0 AND <3.0.0');
    assert(!satisfiesConstraints('3.0.0', constraints, 'semver'), '3.0.0 fails the cumulative constraint (§13)');
    assert(satisfiesConstraint('2.0.0', parseVersionConstraint('=2.0.0')!, 'semver'), 'exact-match constraint holds');

    // §9.1/§9: default channel and channel round-trip.
    const releaseNoChannel = buildReleaseArtifactSet({
        secretKey: publisherSk,
        applicationAddress: appAddress,
        version: '1.5.0',
        versionScheme: 'semver',
        createdAt: 1_100_000
    });
    assert(effectiveChannel(parseRelease(releaseNoChannel)!) === 'stable', 'a release with no channel tag defaults to stable (§9.1)');

    const releaseBeta = buildReleaseArtifactSet({
        secretKey: publisherSk,
        applicationAddress: appAddress,
        version: '1.5.0',
        versionScheme: 'semver',
        channel: 'beta',
        createdAt: 1_150_000
    });
    assert(parseRelease(releaseBeta)!.channel === 'beta', 'an unknown/custom channel is preserved as-is (§9)');

    // §29: addressable-event replacement resolves to the newest release.
    const current = resolveCurrentRelease([parsed1!, parseRelease(releaseNoChannel)!]);
    assert(current!.event.id === releaseNoChannel.id, 'the later created_at wins under addressable-event replacement (§29)');

    // §10-§12: dependency and conflict evaluation.
    const installed = indexInstalled([
        { applicationAddress: runtimeAddress, version: '2.3.0', versionScheme: 'semver' },
        { applicationAddress: legacyAddress, version: '1.9.0', versionScheme: 'semver' }
    ]);
    const depEval = evaluateDependencies(parsed1!, installed);
    assert(depEval.allRequiredSatisfied, 'an installed runtime satisfying >=2.0.0 satisfies the requires declaration');

    const conflictEval = evaluateConflicts(parsed1!, installed);
    assert(conflictEval[0].conflicting, 'an installed legacy package matching <2.0.0 is reported as conflicting (§12)');

    const installedTooOld = indexInstalled([{ applicationAddress: runtimeAddress, version: '1.0.0', versionScheme: 'semver' }]);
    assert(
        !evaluateDependencies(parsed1!, installedTooOld).allRequiredSatisfied,
        'an installed runtime below the required constraint fails dependency evaluation'
    );
    assert(
        !evaluateDependencies(parsed1!, indexInstalled([])).allRequiredSatisfied,
        'a missing required dependency fails dependency evaluation'
    );

    // §11: an unmet optional dependency does not affect allRequiredSatisfied.
    const releaseWithOptional = buildReleaseArtifactSet({
        secretKey: publisherSk,
        applicationAddress: appAddress,
        version: '1.4.3',
        versionScheme: 'semver',
        requires: [{ address: runtimeAddress, constraint: '>=2.0.0' }],
        optional: [{ address: legacyAddress, constraint: '>=5.0.0' }],
        createdAt: 1_200_000
    });
    const optEval = evaluateDependencies(parseRelease(releaseWithOptional)!, installed);
    assert(optEval.allRequiredSatisfied, 'an unmet optional dependency does not block installability (§11)');
    assert(!optEval.optional[0].satisfied, 'the unmet optional dependency is still reported as unsatisfied');

    // Tampered signature must fail verification.
    const tampered: Event = JSON.parse(JSON.stringify(release1));
    tampered.content = 'tampered';
    assert(parseRelease(tampered) === null, 'a tampered release fails signature verification');

    // §15-§20: artefact selection by os/arch/format.
    const linuxAmd64Deb = makeFile(publisherSk, [
        ['url', 'https://example.com/app_1.4.2_amd64.deb'],
        ['os', 'linux'],
        ['arch', 'amd64'],
        ['format', 'deb']
    ]);
    const linuxArm64Deb = makeFile(publisherSk, [
        ['url', 'https://example.com/app_1.4.2_arm64.deb'],
        ['os', 'linux'],
        ['arch', 'arm64'],
        ['format', 'deb']
    ]);
    const linuxAmd64TarGz = makeFile(publisherSk, [
        ['url', 'https://example.com/app_1.4.2_amd64.tar.gz'],
        ['os', 'linux'],
        ['arch', 'amd64'],
        ['format', 'tar.gz']
    ]);
    const windowsExe = makeFile(publisherSk, [
        ['url', 'https://example.com/app_1.4.2_amd64.exe'],
        ['os', 'windows'],
        ['arch', 'amd64'],
        ['format', 'exe']
    ]);
    const anyWasm = makeFile(publisherSk, [
        ['url', 'https://example.com/app_1.4.2.wasm'],
        ['os', 'any'],
        ['arch', 'any'],
        ['format', 'wasm']
    ]);

    const files = [linuxAmd64Deb, linuxArm64Deb, linuxAmd64TarGz, windowsExe, anyWasm];

    const selectedArm64 = selectArtifact(files, { os: 'linux', arch: 'arm64', formats: ['deb', 'tar.gz'] });
    assert(selectedArm64?.event.id === linuxArm64Deb.id, 'artefact selection picks the matching linux/arm64/deb build (§19)');

    const selectedAmd64PreferTarGz = selectArtifact(files, { os: 'linux', arch: 'amd64', formats: ['tar.gz'] });
    assert(
        selectedAmd64PreferTarGz?.event.id === linuxAmd64TarGz.id,
        'artefact selection honours the local format preference over another compatible format'
    );

    const selectedGenericPreference = selectArtifact([anyWasm, linuxAmd64Deb], {
        os: 'linux',
        arch: 'amd64',
        formats: ['deb']
    });
    assert(
        selectedGenericPreference?.event.id === linuxAmd64Deb.id,
        'a specific compatible artefact is preferred over a generic any/any one when both match (§20)'
    );

    const noneForRiscv = selectArtifact(files, { os: 'linux', arch: 'riscv64' });
    assert(
        noneForRiscv !== null && noneForRiscv.event.id === anyWasm.id,
        'an unmatched architecture falls back only to an explicitly any/any artefact, never a mismatched one'
    );

    const noneAtAll = selectArtifact([linuxAmd64Deb, windowsExe], { os: 'macos', arch: 'arm64' });
    assert(noneAtAll === null, 'no compatible artefact returns null rather than an incorrect match');

    if (failures > 0) {
        console.error(`\n${failures} check(s) failed.`);
        process.exit(1);
    }
    console.log('\nAll checks passed.');
}

main();
