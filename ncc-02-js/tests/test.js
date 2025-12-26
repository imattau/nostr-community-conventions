import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { NCC02Builder, NCC02Resolver, MockRelay } from '../src/index.js';

async function runTest() {
  console.log('--- NCC-02 JS Library Test ---');

  const relay = new MockRelay();

  // 1. Setup Identities
  const ownerSk = generateSecretKey();
  const ownerPk = getPublicKey(ownerSk);

  const caSk = generateSecretKey();
  const caPk = getPublicKey(caSk);

  const ownerBuilder = new NCC02Builder(ownerSk);
  const caBuilder = new NCC02Builder(caSk);

  // 2. Publish Service Record
  console.log('Publishing service record...');
  const serviceId = 'api';
  const serviceEvent = ownerBuilder.createServiceRecord(
    serviceId,
    'https://api.test',
    'sha256:fp123'
  );
  await relay.publish(serviceEvent);

  // 3. Issue Attestation
  console.log('Issuing CA attestation...');
  const attEvent = caBuilder.createAttestation(ownerPk, serviceId, serviceEvent.id);
  await relay.publish(attEvent);

  // 4. Resolve Service
  console.log('Resolving service (Success Case)...');
  const resolver = new NCC02Resolver(relay, [caPk]);
  const resolved = await resolver.resolve(ownerPk, serviceId, { requireAttestation: true });

  if (resolved && resolved.endpoint === 'https://api.test' && resolved.attestations.length === 1) {
    console.log('✅ Success: Resolved with trusted attestation');
  } else {
    console.error('❌ Failure: Resolution failed', resolved);
    process.exit(1);
  }

  // 5. Revocation
  console.log('Revoking attestation...');
  const revEvent = caBuilder.createRevocation(attEvent.id, 'Test Revocation');
  await relay.publish(revEvent);

  const resolvedAfterRev = await resolver.resolve(ownerPk, serviceId, { requireAttestation: true });
  if (!resolvedAfterRev) {
    console.log('✅ Success: Resolver correctly rejected revoked attestation');
  } else {
    console.error('❌ Failure: Resolver should have rejected revoked attestation');
    process.exit(1);
  }

  console.log('\n--- All tests passed! ---');
}

runTest().catch(console.error);
