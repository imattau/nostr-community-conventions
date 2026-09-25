# ncc-09-js

Minimal reference implementation of [NCC-09: Scoped Operator Authority](../README.md) in TypeScript, built on [`nostr-tools`](https://github.com/nbd-wtf/nostr-tools).

## Install

```bash
npm install
npm run build
```

## Usage

### Principal: grant scoped authority

```ts
import { SimplePool, generateSecretKey } from 'nostr-tools';
import { publishAuthorityGrant } from 'ncc-09-js';

const serviceSk = generateSecretKey();
const pool = new SimplePool();

const grant = await publishAuthorityGrant(pool, ['wss://relay.example'], {
  secretKey: serviceSk,
  service: 'relay',
  operatorPubkey: '<operator-pubkey-hex>',
  scopes: ['pubkey:<namespace-pubkey>:maintenance-report'],
  expiration: Math.floor(Date.now() / 1000) + 30 * 86400 // 30 days
});
```

### Principal: revoke authority

```ts
import { publishRevocation } from 'ncc-09-js';

await publishRevocation(pool, ['wss://relay.example'], {
  secretKey: serviceSk,
  service: 'relay',
  operatorPubkey: '<operator-pubkey-hex>'
});
```

### Client: resolve and validate authority for an action

```ts
import { fetchAndValidateAuthority } from 'ncc-09-js';

const outcome = await fetchAndValidateAuthority(pool, ['wss://relay.example'], {
  principalPubkey: '<service-pubkey-hex>',
  service: 'relay',
  operatorPubkey: '<operator-pubkey-hex>',
  scope: 'pubkey:<namespace-pubkey>:maintenance-report'
});

if (outcome && outcome.result.valid) {
  // authorised: proceed with the action
} else {
  // no current grant, or it failed validation (outcome?.result.errors)
}
```

### Working with raw events directly

```ts
import { parseAuthorityGrant, resolveCurrentGrant, validateAuthorityGrant } from 'ncc-09-js';

const candidates = rawEvents
  .map(parseAuthorityGrant)
  .filter((g): g is NonNullable<typeof g> => g !== null);

const current = resolveCurrentGrant(candidates);
if (current) {
  const { valid, errors } = validateAuthorityGrant(current, {
    principalPubkey: servicePubkey,
    service: 'relay',
    operatorPubkey,
    scope: 'ncc:10:publish'
  });
}
```

## What this implements

- `buildAuthorityGrant` / `publishAuthorityGrant` — construct and sign a `kind:30064` Authority Grant (NCC-09 §6), enforcing the required-tags rules: a well-formed operator pubkey, exactly one `p` tag, at least one `scope` on an active grant, none on a revoked one (§15), and a sane `valid_from`/`expiration` ordering.
- `buildRevocation` / `publishRevocation` — convenience wrapper that builds a `status=revoked` grant with no scopes (§15).
- `authorityAddressId` — the recommended `<service-id>:<operator-pubkey-hex>` `d` tag format (§6.2).
- `parseAuthorityGrant` — verify an event's signature and structure, returning `null` for anything that isn't a conformant grant rather than throwing.
- `resolveCurrentGrant` — NIP-01 addressable-event replacement semantics over a set of candidate grants sharing the same address (§13, §29.5): highest `created_at` wins, event id breaks ties.
- `validateAuthorityGrant` — the full grant-validity checklist from §13 (principal, operator, service, status, scope, `valid_from`, `expiration`), returning every failing rule rather than only the first.
- `fetchAndValidateAuthority` — the end-to-end client procedure from §12: query relays for the service/operator address, resolve the current grant, and validate it for a requested scope.

This library intentionally does not implement scope semantics for any specific action, capability discovery, or access-control enforcement — those are explicitly out of scope for NCC-09 (§3) and belong to the specification that defines each scope (§8-§10).

## Tests

```bash
npm install
npm test
```

The test suite runs entirely in-memory (a mock relay pool) and checks the build/sign/parse/validate/resolve/fetch round trip against the spec, including scope replacement on update (§14), revocation (§15), expiry enforcement (§29.6), and service isolation (§5).
