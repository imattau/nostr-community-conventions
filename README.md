# Election and Voting Convention

**Convention Type:** Nostr Community Convention (NCC)  
**Convention ID:** NCC-03
**Status:** Draft  
**Category:** Governance  
**Version:** 0.2 (thin core)  
**License:** CC0-1.0  
**Related:** NCC-00, NIP-01, NIP-10, NIP-23, NIP-25, NIP-33

---

## 1. Overview

This Nostr Community Convention defines a minimal, interoperable model for
declaring elections and casting votes on Nostr using existing protocol
primitives.

This convention supports **open, attributable voting** only.

---

## 2. Goals

- Standardise how elections are declared
- Standardise how votes are expressed
- Enable reproducible counting from public data
- Avoid protocol or relay changes
- Remain safely ignorable by non-participating clients

---

## 3. Non-Goals

This convention does not define or enforce:
- Voter eligibility
- Vote weighting
- Sybil resistance
- Governance rules
- Secret or blind ballots
- Cryptographic voting systems

---

## 4. Minimal Compliance

A client is compliant with this convention if it:
1. Can render Election Definition events
2. Can publish Vote events
3. Counts at most one valid vote per pubkey per election within the voting window

---

## 5. Event Model

### 5.1 Election Definition Event

Declares the existence and parameters of an election.

**Election identifier**
- The library now treats a freshly generated `npub` as the canonical handle for the election. Publishing that key via a `p` tag lets clients discover and encrypt to the election directly, and every roll, invite, challenge, and audit is tied to the `npub`. The `d` tag remains present for NCC-03 compatibility, but adopters should prioritize the election `npub` as the signed, authoritative identifier. This key ensures votes/registration can be verified and resists spoofing because only whoever holds the matching `nsec` can produce valid definitions, rolls, or audits.

**Properties**
- Non-replaceable
- Public
- Canonical anchor for votes

**Required fields**
- Title or description
- One or more options
- Closing time

**Recommended tags**
- `d` — election identifier
- `option` — available choices
- `startsAt` — unix timestamp (optional)
- `endsAt` — unix timestamp (required)
- `rules` — human-readable summary (optional)
- `ref` — contextual reference (optional)

The Election Definition Event is the authoritative reference for all votes.

---

### 5.2 Vote Event

Represents a voter’s selection in an election.

**Properties**
- Signed by the voter’s pubkey
- References exactly one election
- Expresses one selected option

**Required tags**
- `e` — reference to Election Definition Event
- `d` — election identifier
- `choice` — selected option identifier

**Optional**
- Vote events MAY be parameterised replaceable events (NIP-33),
  using the election identifier as the parameter.

### 5.3 Audit Event

Election implementations that orchestrate themselves can publish Audit Events (kind `36999`) once votes are tallied. Each audit event contains the `d` election identifier, the electoral roll identifier, the summary hash over the tallied votes, and the total number of counted votes. Clients can recompute the hash from the described payload, verify the signature against the dedicated election `npub`, and therefore prove the published results were not tampered with.

---

## 6. Voting Window and Validity

A vote is valid if and only if:
1. It references a valid Election Definition Event
2. Its `created_at` timestamp is:
   - Greater than or equal to `startsAt` (if present)
   - Strictly less than `endsAt`
3. The selected option exists in the election definition

Votes outside the voting window MUST be ignored.

---

## 7. One Vote per Pubkey

For each election, only one vote per pubkey is counted.

If multiple valid votes from the same pubkey exist:
- The vote with the greatest `created_at` timestamp before `endsAt` is counted
- All earlier votes from that pubkey are ignored

If parameterised replaceable events (NIP-33) are used, the latest event
implicitly supersedes earlier ones.

---

## 8. Result Derivation (Non-Normative)

This convention does not mandate a counting algorithm.

Clients derive results by:
1. Collecting valid votes
2. Deduplicating by pubkey
3. Counting selections per option

Counting assumptions MUST be disclosed by the client or publisher.

---

## 9. Security Properties

This convention provides:
- Integrity via signatures
- Transparency via public events
- Auditability via replayable data

This convention does **not** provide:
- Vote secrecy
- Anonymity
- Coercion resistance
- Sybil resistance

---

## 10. Compatibility

This convention is compatible with:
- NIP-25 reactions (informal signalling)
- NIP-23 governance documents
- NIP-33 replaceable events
- Trust or eligibility conventions defined elsewhere

---

## 11. Extensions

Eligibility rules, relay enforcement, result publication,
auditing, and secret-voting coordination are defined in
non-normative appendices or companion conventions.

---

## 12. JavaScript / TypeScript Library

To make NCC-03 easier to adopt, there is a companion npm package that
exports `ElectionDefinition`, `VoteEvent`, and `Election` classes that
cover the entire election and voting lifecycle defined above. Events
and tallies are always emitted as kind `36998`, compliant with the
Election Definition and Vote requirements.

### Installation

```bash
npm install nostr-election-36998
```

### Example

```ts
import { ElectionDefinition, Election, VoteEvent } from 'nostr-election-36998';

const definition = new ElectionDefinition({
  pubkey: '02cafe...',
  title: 'Board Chair',
  options: [
    { id: 'yes', label: 'Yes' },
    { id: 'no', label: 'No' },
  ],
  endsAt: Math.floor(Date.now() / 1000) + 3600,
});

const election = new Election(definition);
election.addVote(
  new VoteEvent({
    pubkey: '03babe...',
    electionId: definition.identifier,
    choice: 'yes',
  })
);

console.log(election.tally());
```

### Electoral Roll

The companion library also exports an `ElectoralRoll` class that wraps a secure list-style event (kind `30000`). Rolls are the authoritative record of eligible `npub`s and can be attached to an `Election` so votes from outsiders are silently ignored.

```ts
import { ElectoralRoll } from 'nostr-election-36998';

const roll = new ElectoralRoll({
  pubkey: definition.pubkey,
  npubs: ['npub1…', 'npub2…'],
  note: 'Board members eligible to vote.',
});

election.setElectoralRoll(roll);
```

Roll events encode each member as a `p` tag, retain the `d` identifier, and allow notes/extra tags for metadata so clients can store them near elections.

### Registration

Every voter can register for an election by solving a lightweight verification challenge and having their `npub` added to the electoral roll. The `RegistrationManager` class issues proof-of-work challenges (difficulty + TTL) and adds qualified voters back into the same roll so `Election` keeps honoring NCC-03’s one-vote rule.

```ts
import { RegistrationManager } from 'nostr-election-36998';

const registration = new RegistrationManager(roll, { difficulty: 1, ttlSeconds: 300 });
election.setRegistrationManager(registration);

const challenge = election.issueRegistrationChallenge('npub1...');

// Client-side: the voter searches for a nonce that produces `sha256(seed + nonce)` starting with the announced number of zeroes.
const solution = { challengeId: challenge.id, nonce: 'demo-42' };
const result = election.registerForElection('npub1...', solution);
console.log(result.success ? 'Registration accepted' : result.reason);
```

`registerForElection` returns a `RegistrationResult` describing whether the voter was newly added or already marked eligible, so the UI can prompt for another challenge if needed.

The `RegistrationManager` also tracks challenge issuance so you can monitor reuse or throttle bots; pass `maxChallengesPerPubkey` to enforce a per-pubkey limit. Audit events include these stats plus a log of every manual add/invite/registration and the latest roll fingerprint, so clients can confirm the on-wire roll matches the signature and that no voters slipped in quietly.

#### Election modes

You can configure the manager for **public** (open) or **closed** (invite-only/private) elections via the `mode` option (exported as `ElectionMode`). Public elections remain accessible to anyone who solves the puzzle, while closed elections reject `issueRegistrationChallenge`/`registerForElection` calls and only accept invites or manual approvals. This allows the same classes to host both open community votes and tightly controlled governance ballots.

#### Invite-only flows

Operators can issue one-time tokens via `issueInvite` and send them over encrypted DMs to keep the election invite-only. The recipient replies with the token inside another encrypted DM and the operator calls `acceptInvite` to finalize their eligibility before the token expires.

```ts
const token = operator.issueInvite('npub-guest', 120);
// deliver `token` via encrypted DM, the voter replies with the same token
const inviteResult = operator.acceptInvite('npub-guest', replyToken);
```

#### Manual additions

Pre-approved voters can be added with `manualAdd`, giving the operator a way to seed the roll without any automated challenges while still keeping each change signed with the election `npub`.

```ts
operator.manualAdd('npub-official');
```

### Verification Options

The proof-of-work flow is one tool to slow automation; depending on your trust model you can combine or replace it with other strategies:

- **Proof-of-work (default)**: the library issues a small hash puzzle per `npub`, preventing trivial bots while remaining anonymous.
- **Signed challenges**: ask voters to sign a fresh message with their private key (or a delegated signer) to prove the pubkey is held, then verify the signature before adding them to the roll.
- **Human or third-party review**: register votes only after a short manual review window, or accept attestations from trusted relays/gatekeepers for high-stakes elections.
- **External CAPTCHA/identity provider**: integrate a web-based challenge or verified identity service before calling `issueRegistrationChallenge`, so only the verified humans see the puzzle.

Documenting which verification layers you used is essential, so downstream tallying clients can explain how `npub`s earned eligibility.

### Election Operator

The package also ships with an `ElectionOperator` class that keeps the election’s own key pair (npub/nsec), runs the registration-to-roll pipeline, and emits an audit proof. Each operator:

- signs the Election Definition, Electoral Roll, and Audit Event with the election `npub`,
- enforces registration challenges before mutating the roll,
- builds tallies and generates audit events (kind `36999`) containing a hash of the counted votes and roll snapshot.

```ts
import { ElectionOperator } from 'nostr-election-36998';

const operator = new ElectionOperator(
  {
    title: 'Self-sufficient Election',
    options: [
      { id: 'A', label: 'Choice A' },
      { id: 'B', label: 'Choice B' },
    ],
    endsAt: Math.floor(Date.now() / 1000) + 3600,
    rules: 'Automatic registration + audit event.',
  },
  { registrationOptions: { difficulty: 1 }, mode: 'public' }
);

const challenge = operator.issueRegistrationChallenge('npub-colleague');
// ... client solves the nonce ...

const audit = operator.generateAuditEvent();
console.log('Audit valid?', operator.verifyAuditEvent(audit));
```

Consumers can replay the audit event, recompute the hash, and verify its signature against the election `npub` to prove the organizer did not tamper with the results or roll. Audit payloads now bundle the most recent roll fingerprint plus a chronological `actions` log and `challengeStats`, so observers can see what voters were invited, registered, or manually added before the vote was tallied.

#### Signing backends

If you store the election `nsec` inside a vault, HSM, or remote signer, inject an implementation of the `ElectionSigner` interface (it just needs to return the public key and sign provided events). The operator continues to use the published `npub` for verification, but the private key material never leaves your secure runtime.

```ts
const signer: ElectionSigner = {
  getPublicKey: () => storedElectionNpub,
  sign: (event) => remoteVault.sign(event),
};

const operator = new ElectionOperator({ ... }, { signer, mode: 'closed' });
```

This lets the election remain self-sustaining while the organizer or infrastructure team handles the signing backend.

#### Built-in vault

For projects that need a lightweight on-disk vault, use `SecureVault`. It encrypts the `nsec` with a passphrase and returns a `VaultSeal` you can persist safely. Unlock it at runtime to get an `ElectionSigner` implementation without ever exposing the raw secret.

```ts
import { SecureVault, createElectionKeyPair } from 'nostr-election-36998';

const pair = createElectionKeyPair();
const { vault, seal } = SecureVault.create(pair.nsec, 'hunter2');

const operator = new ElectionOperator({ ... }, { signer: vault, keyPair: pair, mode: 'public' });

// later, load seal from storage
const recoveredVault = SecureVault.unlock(seal, 'hunter2');
const reopened = new ElectionOperator({ ... }, { signer: recoveredVault, keyPair: pair });
```

Call `vault.destroy()` after signing so the decrypted buffer is zeroed.

The package ships with TypeScript source, declaration files, and a simple
demo that compiles under `tsc`. Run `npm run test` after installing to
exercise the end-to-end workflow.

---
