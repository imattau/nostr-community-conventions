# ncc-10-js

Minimal reference implementation of [NCC-10: Service Operational State](../README.md) in TypeScript, built on [`nostr-tools`](https://github.com/nbd-wtf/nostr-tools).

It intentionally has no dependency on `ncc-09-js`: whether an operator-published event is currently authorised is an NCC-09 question, kept separate from the NCC-10 operational-state question (NCC-10 §19). Wire in your own NCC-09 grant lookup — for example `ncc-09-js`'s `fetchAndValidateAuthority` — via the `isAuthorisedOperator` callback of `resolveServiceState`.

## Install

```bash
npm install
npm run build
```

## Usage

### Service: publish direct state

```ts
import { SimplePool, generateSecretKey } from 'nostr-tools';
import { publishDirectState } from 'ncc-10-js';

const serviceSk = generateSecretKey();
const pool = new SimplePool();

await publishDirectState(pool, ['wss://relay.example'], {
  secretKey: serviceSk,
  service: 'relay',
  state: 'maintenance',
  since: Math.floor(Date.now() / 1000),
  expectedUntil: Math.floor(Date.now() / 1000) + 3600,
  content: 'Scheduled database maintenance.'
});
```

### Authorised operator: publish state on the service's behalf

Requires an NCC-09 authority grant from the service naming the `ncc:10:publish` scope (see [`ncc-09-js`](../../ncc-09/ncc-09-js)).

```ts
import { publishOperatorState } from 'ncc-10-js';

await publishOperatorState(pool, ['wss://relay.example'], {
  secretKey: operatorSk,
  servicePubkey: '<service-pubkey-hex>',
  service: 'relay',
  state: 'degraded',
  since: Math.floor(Date.now() / 1000)
});
```

### Client: resolve the current declared state (NCC-10 §25)

```ts
import { resolveServiceState } from 'ncc-10-js';
import { fetchAndValidateAuthority } from 'ncc-09-js';

const resolution = await resolveServiceState(pool, ['wss://relay.example'], {
  servicePubkey: '<service-pubkey-hex>',
  service: 'relay',
  isAuthorisedOperator: async (operatorPubkey) => {
    const outcome = await fetchAndValidateAuthority(pool, ['wss://relay.example'], {
      principalPubkey: '<service-pubkey-hex>',
      service: 'relay',
      operatorPubkey,
      scope: 'ncc:10:publish'
    });
    return outcome?.result.valid ?? false;
  }
});

switch (resolution.status) {
  case 'direct':
  case 'operator':
    console.log(resolution.state.state); // 'operational' | 'degraded' | 'maintenance' | 'unavailable' | 'retiring'
    break;
  case 'conflict':
    // multiple authorised operators disagree — do not silently pick one (§20)
    break;
  case 'unknown':
    // no valid state found — do not infer 'operational' or 'unavailable' (§21)
    break;
}
```

### Working with raw events directly

```ts
import { parseDirectState, parseOperatorState, resolveCurrentState } from 'ncc-10-js';

const candidates = rawEvents
  .map(parseDirectState)
  .filter((s): s is NonNullable<typeof s> => s !== null);

const current = resolveCurrentState(candidates);
if (current) {
  console.log(current.state, current.since, current.expectedUntil);
}
```

## API

- `buildDirectState(opts)` / `publishDirectState(pool, relays, opts)` — build/sign/publish a service-authored kind:30065 event (§5).
- `buildOperatorState(opts)` / `publishOperatorState(pool, relays, opts)` — build/sign/publish an operator-authored kind:30065 event (§12).
- `parseDirectState(event)` / `parseOperatorState(event)` — verify signature and structure; return `null` for anything non-conforming rather than throwing.
- `resolveCurrentState(candidates)` — apply NIP-01 addressable-event replacement semantics (§10).
- `resolveServiceState(pool, relays, opts)` — full client resolution procedure (§25): prefer direct state, fall back to NCC-09-authorised operator state, report disagreeing operators as a conflict, otherwise `unknown`.

Run `npm test` for a spec-compliance smoke test covering direct/operator publication, replacement, operator authorisation, and conflicting-operator handling.
