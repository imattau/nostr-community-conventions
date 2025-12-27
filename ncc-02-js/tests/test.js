import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { NCC02Builder, NCC02Resolver, MockRelay } from '../dist/index.mjs';

async function runTests() {
  console.log('--- NCC-02 JS Comprehensive Test Suite ---');

  const relay = new MockRelay();
  const ownerSk = generateSecretKey();
  const ownerPk = getPublicKey(ownerSk);
  const caSk = generateSecretKey();
  const caPk = getPublicKey(caSk);

  const builder = new NCC02Builder(ownerSk);
  const caBuilder = new NCC02Builder(caSk);
  
  // Create a mock pool that interfaces with our MockRelay
  const mockPool = {
    subscribeMany: (relays, filters, callbacks) => {
      filters.forEach(async (filter) => {
        const events = await relay.query(filter);
        events.forEach((e) => callbacks.onevent(e));
        callbacks.oneose();
      });
      return { close: () => {} };
    }
  };

  const resolver = new NCC02Resolver(['ws://mock-relay.local'], { 
    pool: mockPool,
    trustedCAPubkeys: [caPk] 
  });

  // --- 1. Service Records & Replacement ---
  console.log('Test: Latest record selection...');
  const oldEvent = builder.createServiceRecord({
    serviceId: 'api',
    endpoint: 'https://old.io',
    fingerprint: 'fp_old'
  });
  oldEvent.created_at -= 100; 
  const newEvent = builder.createServiceRecord({
    serviceId: 'api',
    endpoint: 'https://new.io',
    fingerprint: 'fp_new'
  });
  
  await relay.publish(oldEvent);
  await relay.publish(newEvent);
  
  const resLatest = await resolver.resolve(ownerPk, 'api');
  if (resLatest.endpoint !== 'https://new.io') throw new Error('Failed to pick latest record');
  console.log('✅ Passed');

  // --- 2. Cross-Validation: Service ID ---
  console.log('Test: Mismatched service ID in attestation...');
  const vaultEvent = builder.createServiceRecord({
    serviceId: 'vault',
    endpoint: 'https://v.io',
    fingerprint: 'fp_v'
  });
  await relay.publish(vaultEvent);
  const badSrvAtt = caBuilder.createAttestation({
    subjectPubkey: ownerPk,
    serviceId: 'other-service',
    serviceEventId: vaultEvent.id
  });
  await relay.publish(badSrvAtt);
  
  try {
    await resolver.resolve(ownerPk, 'vault', { requireAttestation: true });
    throw new Error('Should have rejected attestation with wrong srv tag');
  } catch (e) {
    if (e.code === 'POLICY_FAILURE') console.log('✅ Passed');
    else throw e;
  }

  // --- 3. Time Validation: Not Before (NBF) ---
  console.log('Test: Future NBF (Not Before) validation...');
  const futureAtt = caBuilder.createAttestation({
    subjectPubkey: ownerPk,
    serviceId: 'vault',
    serviceEventId: vaultEvent.id
  });
  futureAtt.tags.find(t => t[0] === 'nbf')[1] = (Math.floor(Date.now() / 1000) + 1000).toString();
  const signedFutureAtt = finalizeEvent(futureAtt, caSk);
  await relay.publish(signedFutureAtt);
  
  try {
    await resolver.resolve(ownerPk, 'vault', { requireAttestation: true });
  } catch (e) {
    if (e.code === 'POLICY_FAILURE') console.log('✅ Passed');
    else throw e;
  }

  // --- 4. Endpoint Key Pinning ---
  console.log('Test: verifyEndpoint utility...');
  const resolved = await resolver.resolve(ownerPk, 'api');
  if (!resolver.verifyEndpoint(resolved, 'fp_new')) throw new Error('Verification failed');
  if (resolver.verifyEndpoint(resolved, 'WRONG_FP')) throw new Error('Verification should have failed');
  console.log('✅ Passed');

  // --- 5. Signature Failures ---
  console.log('Test: Invalid signature detection...');
  const corruptEvent = builder.createServiceRecord({
    serviceId: 'secure',
    endpoint: 'https://s.io',
    fingerprint: 'fp_s'
  });
  corruptEvent.content = 'HACKED'; 
  relay.events.push(corruptEvent); 
  
  try {
    await resolver.resolve(ownerPk, 'secure');
  } catch (e) {
    if (e.code === 'INVALID_SIGNATURE') console.log('✅ Passed');
    else throw e;
  }

  // --- 6. Missing Records ---
  console.log('Test: NOT_FOUND error code...');
  try {
    await resolver.resolve(ownerPk, 'non-existent');
  } catch (e) {
    if (e.code === 'NOT_FOUND') console.log('✅ Passed');
    else throw e;
  }

  // --- 7. Robustness: Malformed Data ---
  console.log('Test: Malformed record (missing tags)...');
  const brokenEvent = builder.createServiceRecord({
    serviceId: 'broken',
    endpoint: 'https://b.io',
    fingerprint: 'fp'
  });
  brokenEvent.tags = brokenEvent.tags.filter(t => t[0] !== 'u');
  const signedBroken = finalizeEvent(brokenEvent, ownerSk);
  await relay.publish(signedBroken);
  try {
    await resolver.resolve(ownerPk, 'broken');
  } catch (e) {
    if (e.code === 'MALFORMED_RECORD') console.log('✅ Passed (Detected missing URI)');
    else throw e;
  }

  console.log('Test: Malformed expiry (non-numeric)...');
  const badExpEvent = builder.createServiceRecord({
    serviceId: 'bad-exp',
    endpoint: 'https://e.io',
    fingerprint: 'fp'
  });
  badExpEvent.tags.find(t => t[0] === 'exp')[1] = 'not-a-number';
  const signedBadExp = finalizeEvent(badExpEvent, ownerSk);
  await relay.publish(signedBadExp);
  try {
    await resolver.resolve(ownerPk, 'bad-exp');
  } catch (e) {
    if (e.code === 'MALFORMED_RECORD') console.log('✅ Passed (Detected NaN expiry)');
    else throw e;
  }

  // --- 8. Relay Failures ---
  console.log('Test: Relay error handling...');
  const failingPool = {
    subscribeMany: () => { throw new Error('Network timeout'); }
  };
  const failingResolver = new NCC02Resolver(['ws://failing'], { pool: failingPool });
  try {
    await failingResolver.resolve(ownerPk, 'api');
  } catch (e) {
    if (e.code === 'RELAY_ERROR') console.log('✅ Passed (Wrapped relay error)');
    else throw e;
  }

  // --- 9. Security: Spoofed Revocation ---
  console.log('Test: Spoofed revocation (DoS protection)...');
  const secureId = 'secure-rev-bypass';
  const secureEvent = builder.createServiceRecord({
    serviceId: secureId,
    endpoint: 'https://s.io',
    fingerprint: 'fp_s'
  });
  await relay.publish(secureEvent);
  const secureAtt = caBuilder.createAttestation({
    subjectPubkey: ownerPk,
    serviceId: secureId,
    serviceEventId: secureEvent.id
  });
  await relay.publish(secureAtt);

  // Manually construct a fake revocation event that is NOT processed by finalizeEvent (to avoid cache)
  const spoofedRev = {
    kind: 30061,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['e', secureAtt.id]],
    content: 'Manual Spoof',
    pubkey: caPk, // Claim it's from CA
    id: '0000000000000000000000000000000000000000000000000000000000000000',
    sig: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
  };
  
  relay.events.push(spoofedRev);

  const resSpoof = await resolver.resolve(ownerPk, secureId, { requireAttestation: true });
  if (resSpoof && resSpoof.attestations.length === 1) {
    console.log('✅ Passed (Spoofed revocation ignored by resolver)');
  } else {
    throw new Error('Resolver failed to ignore spoofed revocation');
  }

  // --- 10. Security: Valid Revocation ---
  console.log('Test: Valid revocation...');
  const revEvent = caBuilder.createRevocation({ attestationId: secureAtt.id, reason: 'Key compromised' });
  await relay.publish(revEvent);
  
  // Case A: Attestation required -> should fail
  try {
    await resolver.resolve(ownerPk, secureId, { requireAttestation: true });
    throw new Error('Should have failed due to revoked attestation');
  } catch (e) {
    if (e.code !== 'POLICY_FAILURE') throw e;
  }

  // Case B: Attestation optional -> should succeed but with 0 attestations
  const resRevoked = await resolver.resolve(ownerPk, secureId, { requireAttestation: false });
  if (resRevoked && resRevoked.attestations.length === 0) {
    console.log('✅ Passed (Valid revocation honored)');
  } else {
    throw new Error('Resolver failed to honor valid revocation');
  }

  console.log('\n--- All comprehensive tests passed! ---');
}

runTests().catch(e => {
  console.error('❌ Test Suite Failed:', e);
  process.exit(1);
});