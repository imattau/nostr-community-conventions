# ncc-08-js

Minimal reference implementation of [NCC-08: Service Identity Rotation and Handover](../README.md) in TypeScript, built on [`nostr-tools`](https://github.com/nbd-wtf/nostr-tools).

## Install

```bash
npm install
npm run build
```

## Usage

### Predecessor: propose a handover

```ts
import { SimplePool, generateSecretKey } from 'nostr-tools';
import { publishHandoverProposal } from 'ncc-08-js';

const predecessorSk = generateSecretKey();
const pool = new SimplePool();

const proposal = await publishHandoverProposal(pool, ['wss://relay.example'], {
  secretKey: predecessorSk,
  service: 'relay',
  successorPubkey: '<successor-pubkey-hex>',
  effective: Math.floor(Date.now() / 1000) + 86400, // effective in 24h
  expires: Math.floor(Date.now() / 1000) + 7 * 86400,
  reason: 'planned service key rotation'
});
```

### Successor: accept the handover

```ts
import { publishHandoverAcceptance } from 'ncc-08-js';

await publishHandoverAcceptance(pool, ['wss://relay.example'], {
  secretKey: successorSk,
  proposal // the exact proposal event returned/observed above
});
```

### Validate a proposal/acceptance pair

```ts
import { parseHandoverProposal, parseHandoverAcceptance, validateHandoverPair, handoverState } from 'ncc-08-js';

const parsedProposal = parseHandoverProposal(proposalEvent);
const parsedAcceptance = parseHandoverAcceptance(acceptanceEvent);

if (parsedProposal && parsedAcceptance) {
  const { valid, errors } = validateHandoverPair(parsedProposal, parsedAcceptance);
  if (valid) {
    console.log(handoverState(parsedProposal, parsedAcceptance)); // 'accepted' | 'effective'
  }
}
```

### Resolve a service's current identity

```ts
import { resolveHandoverChain } from 'ncc-08-js';

const result = await resolveHandoverChain(pool, ['wss://relay.example'], startingPubkey, 'relay');

switch (result.status) {
  case 'resolved':
  case 'no_successor':
    console.log('current service identity:', result.current);
    break;
  case 'conflict':
    console.log('conflicting completed handovers for', result.current);
    break;
  case 'loop':
    console.log('handover loop detected at', result.current);
    break;
}
```

## What this implements

- `buildHandoverProposal` / `publishHandoverProposal` — construct and sign a `kind:1070` Handover Proposal with `role=predecessor` (NCC-08 §8), rejecting a malformed successor pubkey or an `effective`/`expires` ordering that violates §11.2.
- `buildHandoverAcceptance` / `publishHandoverAcceptance` — construct and sign a `kind:1070` Handover Acceptance from the exact proposal event (§9), rejecting acceptance by the wrong key, before the proposal, or after it expires.
- `parseHandoverProposal` / `parseHandoverAcceptance` — verify an event's signature and structure, returning `null` for anything that isn't a conformant proposal/acceptance rather than throwing.
- `validateHandoverPair` — the full 11-point checklist from §10, returning every failing rule rather than only the first.
- `handoverEffectiveTime` / `handoverState` — effective-time resolution and the proposed/accepted/effective state machine from §§11-12.
- `resolveHandoverChain` — the client resolution algorithm from §27: follows effective handovers hop by hop, detects loops (§14) and conflicting completed handovers from the same predecessor (§15), and stops at `maxHops` as a local policy limit.

This library intentionally does not implement key recovery, delegated signing, or any automatic migration of NCC-02/NCC-05/NCC-07 records — those are explicitly out of scope for NCC-08 (§§3, 16-20, 24).

## Tests

```bash
npm install
npm test
```

The test suite runs entirely in-memory (a mock relay pool) and checks the build/sign/parse/verify/validate/resolve round trip against the spec, including effective-time semantics, expiry rejection, loop detection, and conflict detection.
