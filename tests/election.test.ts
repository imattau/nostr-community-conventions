import assert from 'node:assert';
import { createHash } from 'crypto';
import {
  createElectionKeyPair,
  ElectionOperator,
  RegistrationChallenge,
  RegistrationSolution,
  SecureVault,
  VoteEvent,
} from '../src';

function solveChallenge(challenge: RegistrationChallenge): RegistrationSolution {
  const target = '0'.repeat(challenge.difficulty);
  let counter = 0;
  while (true) {
    const nonce = `test-${counter}`;
    const digest = createHash('sha256').update(challenge.seed + nonce).digest('hex');
    if (digest.startsWith(target)) {
      return { challengeId: challenge.id, nonce };
    }
    counter += 1;
  }
}

function expectSuccess(result: { success: boolean }) {
  assert.strictEqual(result.success, true, `Expected success but got ${JSON.stringify(result)}`);
}

(async () => {
  const endsAt = Math.floor(Date.now() / 1000) + 7200;

  const publicOperator = new ElectionOperator(
    {
      title: 'Public test election',
      options: [
        { id: 'A', label: 'Option A' },
        { id: 'B', label: 'Option B' },
      ],
      endsAt,
      rules: 'Open test',
    },
    { mode: 'public', registrationOptions: { difficulty: 1, ttlSeconds: 120 } }
  );

  const pubChallenge = publicOperator.issueRegistrationChallenge('pubkey-alpha');
  const pubSolution = solveChallenge(pubChallenge);
  expectSuccess(publicOperator.registerForElection('pubkey-alpha', pubSolution));

  const pubChallenge2 = publicOperator.issueRegistrationChallenge('pubkey-beta');
  const pubSolution2 = solveChallenge(pubChallenge2);
  expectSuccess(publicOperator.registerForElection('pubkey-beta', pubSolution2));

  publicOperator.election.addVote(
    new VoteEvent({
      pubkey: 'pubkey-alpha',
      choice: 'A',
      electionId: publicOperator.definition.identifier,
    })
  );
  publicOperator.election.addVote(
    new VoteEvent({
      pubkey: 'pubkey-beta',
      choice: 'B',
      electionId: publicOperator.definition.identifier,
    })
  );

  const publicTally = publicOperator.election.tally();
  assert.deepStrictEqual(publicTally.counts, { A: 1, B: 1 });
  assert.strictEqual(publicTally.total, 2);

  const closedOperator = new ElectionOperator(
    {
      title: 'Closed test election',
      options: [
        { id: 'Yes', label: 'Yes' },
        { id: 'No', label: 'No' },
      ],
      endsAt,
      rules: 'Closed test',
    },
    { mode: 'closed', registrationOptions: { difficulty: 2, ttlSeconds: 60 } }
  );

  const inviteToken = closedOperator.issueInvite('invite-pub');
  expectSuccess(closedOperator.acceptInvite('invite-pub', inviteToken));
  assert.strictEqual(closedOperator.manualAdd('manual-pub'), true);

  closedOperator.election.addVote(
    new VoteEvent({
      pubkey: 'invite-pub',
      choice: 'Yes',
      electionId: closedOperator.definition.identifier,
    })
  );
  closedOperator.election.addVote(
    new VoteEvent({
      pubkey: 'manual-pub',
      choice: 'No',
      electionId: closedOperator.definition.identifier,
    })
  );

  const closedTally = closedOperator.election.tally();
  assert.deepStrictEqual(closedTally.counts, { Yes: 1, No: 1 });
  assert.strictEqual(closedTally.total, 2);

  const auditEvent = closedOperator.generateAuditEvent();
  assert.strictEqual(closedOperator.verifyAuditEvent(auditEvent), true);
  const auditPayload = JSON.parse(auditEvent.content ?? '{}');
  assert.strictEqual(auditPayload.roll.fingerprint, closedOperator.roll.fingerprint());
  assert.ok(auditPayload.actions.some((action: any) => action.type === 'manual_add'));
  assert.ok(auditPayload.challengeStats);
  assert.ok(Object.keys(auditPayload.challengeStats).length >= 0);

  const vaultPair = createElectionKeyPair();
  const { vault } = SecureVault.create(vaultPair.nsec, 'test-pass');
  const vaultOperator = new ElectionOperator(
    {
      title: 'Vault election',
      options: [
        { id: 'Up', label: 'Up' },
        { id: 'Down', label: 'Down' },
      ],
      endsAt,
      rules: 'Vault-backed',
    },
    { mode: 'public', keyPair: vaultPair, signer: vault, registrationOptions: { difficulty: 1, ttlSeconds: 60 } }
  );

  const vaultChallenge = vaultOperator.issueRegistrationChallenge('vault-pub');
  const vaultSolution = solveChallenge(vaultChallenge);
  expectSuccess(vaultOperator.registerForElection('vault-pub', vaultSolution));

  vaultOperator.election.addVote(
    new VoteEvent({
      pubkey: 'vault-pub',
      choice: 'Down',
      electionId: vaultOperator.definition.identifier,
    })
  );

  assert.strictEqual(vaultOperator.election.tally().counts.Down, 1);
  vault.destroy();
  console.log('All election tests passed');
})();
