import { createHash } from 'crypto';
import {
  ElectionOperator,
  RegistrationChallenge,
  RegistrationSolution,
  SecureVault,
  createElectionKeyPair,
  VoteEvent,
} from '../src';

const endsAt = Math.floor(Date.now() / 1000) + 3600;

const publicOperator = new ElectionOperator(
  {
    title: 'Open NCC-03 Election',
    options: [
      { id: 'Alpha', label: 'Alpha option' },
      { id: 'Beta', label: 'Beta option' },
    ],
    endsAt,
    rules: 'Proof-of-work registration keeps bots at bay.',
  },
  { registrationOptions: { difficulty: 1, ttlSeconds: 300 } }
);

const solveChallenge = (challenge: RegistrationChallenge): RegistrationSolution => {
  const target = '0'.repeat(challenge.difficulty);
  let counter = 0;
  while (true) {
    const nonce = `demo-${counter}`;
    const digest = createHash('sha256').update(challenge.seed + nonce).digest('hex');
    if (digest.startsWith(target)) {
      return { challengeId: challenge.id, nonce };
    }
    counter += 1;
  }
};

const challenge1 = publicOperator.issueRegistrationChallenge('pubkey-1');
const solution1 = solveChallenge(challenge1);
console.log('pubkey-1 registration', publicOperator.registerForElection('pubkey-1', solution1));

const challenge2 = publicOperator.issueRegistrationChallenge('pubkey-2');
const solution2 = solveChallenge(challenge2);
console.log('pubkey-2 registration', publicOperator.registerForElection('pubkey-2', solution2));

console.log(
  'outsider registration failure',
  publicOperator.registerForElection('outsider', { challengeId: 'missing', nonce: 'x' })
);

const publicElection = publicOperator.election;

const votes: { pubkey: string; choice: string }[] = [
  { pubkey: 'pubkey-1', choice: 'Alpha' },
  { pubkey: 'pubkey-2', choice: 'Beta' },
  { pubkey: 'pubkey-1', choice: 'Beta' },
];

for (const vote of votes) {
  publicElection.addVote(
    new VoteEvent({
      pubkey: vote.pubkey,
      choice: vote.choice,
      electionId: publicOperator.definition.identifier,
    })
  );
}

console.log('Public election tally:', publicElection.tally());

const closedOperator = new ElectionOperator(
  {
    title: 'Closed NCC-03 Election',
    options: [
      { id: 'Yes', label: 'Yes' },
      { id: 'No', label: 'No' },
    ],
    endsAt,
    rules: 'Invite-only + manual approvals.',
  },
  { registrationOptions: { difficulty: 2, ttlSeconds: 120 }, mode: 'closed' }
);

try {
  closedOperator.issueRegistrationChallenge('spoof');
} catch (error) {
  console.log('Closed elections do not allow open challenges:', (error as Error).message);
}

const inviteToken = closedOperator.issueInvite('invitee');
console.log('Invite token (encrypted DM):', inviteToken);
console.log('Invite acceptance:', closedOperator.acceptInvite('invitee', inviteToken));
closedOperator.manualAdd('manual-voter');

const closedElection = closedOperator.election;
closedElection.addVote(
  new VoteEvent({
    pubkey: 'invitee',
    choice: 'Yes',
    electionId: closedOperator.definition.identifier,
  })
);
closedElection.addVote(
  new VoteEvent({
    pubkey: 'manual-voter',
    choice: 'No',
    electionId: closedOperator.definition.identifier,
  })
);

const auditEvent = closedOperator.generateAuditEvent();
console.log('Closed audit valid?', closedOperator.verifyAuditEvent(auditEvent));
console.log('Closed election tally:', closedElection.tally());

const vaultPair = createElectionKeyPair();
const { vault } = SecureVault.create(vaultPair.nsec, 'vault-secret');
const vaultOperator = new ElectionOperator(
  {
    title: 'Vault-secured Election',
    options: [
      { id: 'Up', label: 'Yes' },
      { id: 'Down', label: 'No' },
    ],
    endsAt,
    rules: 'Signed through secure vault.',
  },
  { keyPair: vaultPair, signer: vault, registrationOptions: { difficulty: 1, ttlSeconds: 60 }, mode: 'public' }
);

const vaultChallenge = vaultOperator.issueRegistrationChallenge('vault-voter');
const vaultSolution = solveChallenge(vaultChallenge);
vaultOperator.registerForElection('vault-voter', vaultSolution);

vaultOperator.election.addVote(
  new VoteEvent({
    pubkey: 'vault-voter',
    electionId: vaultOperator.definition.identifier,
    choice: 'Up',
  })
);

console.log('Vaulted election tally:', vaultOperator.election.tally());
vault.destroy();
