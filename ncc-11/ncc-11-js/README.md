# ncc-11-js

Minimal reference implementation of [NCC-11: Portable Trust Policy](../README.md) in TypeScript, built on [`nostr-tools`](https://github.com/nbd-wtf/nostr-tools).

It only builds, parses, decrypts, and resolves kind:30067 policy documents. Applying a resolved policy's rules to real NCC-02/05/09/10 data is the caller's responsibility — this library deliberately has no dependency on `ncc-02-js`, `ncc-05-js`, `ncc-09-js`, or `ncc-10-js` (NCC-11 §31 steps 10-12).

## Install

```bash
npm install
npm run build
```

## Usage

### Publish a public policy

```ts
import { SimplePool, generateSecretKey } from 'nostr-tools';
import { publishTrustPolicy, RULE_KEYS, transportRuleKey } from 'ncc-11-js';

const ownerSk = generateSecretKey();
const pool = new SimplePool();

await publishTrustPolicy(pool, ['wss://relay.example'], {
  secretKey: ownerSk,
  policyId: 'default',
  publicRules: [
    [RULE_KEYS.KEY_PINNING, 'require'],
    [RULE_KEYS.ATTESTATION, 'require'],
    [RULE_KEYS.STALE_FALLBACK, 'allow'],
    [RULE_KEYS.MAX_STALE_AGE, '3600'],
    [transportRuleKey('https'), 'allow'],
    [transportRuleKey('http'), 'deny']
  ],
  publicTrustedCertifiers: ['<certifier-pubkey-hex>']
});
```

### Publish a policy with private rules (§16)

Private rules and trusted-certifier entries are JSON-encoded as tag-shaped arrays and NIP-44 encrypted to the policy owner's own pubkey, following the NIP-51 private-list pattern.

```ts
await publishTrustPolicy(pool, ['wss://relay.example'], {
  secretKey: ownerSk,
  policyId: 'default',
  publicRules: [[RULE_KEYS.KEY_PINNING, 'require']],
  privateRules: [
    [transportRuleKey('onion'), 'allow'],
    [RULE_KEYS.OPERATOR_ACTIONS, 'deny']
  ],
  privateTrustedCertifiers: ['<sensitive-certifier-pubkey-hex>']
});
```

### Client: resolve the current effective policy (§31)

```ts
import { resolveTrustPolicy, getRule, getTransportRule, isCertifierTrusted, RULE_KEYS } from 'ncc-11-js';

const policy = await resolveTrustPolicy(pool, ['wss://relay.example'], {
  ownerPubkey: '<policy-owner-pubkey-hex>',
  policyId: 'default',
  // Omit secretKey when resolving someone else's policy — only its owner can decrypt private content.
  secretKey: ownerSk
});

if (policy) {
  getRule(policy, RULE_KEYS.KEY_PINNING);       // 'require' | 'prefer' | undefined
  getTransportRule(policy, 'onion');            // 'allow' | 'deny' | undefined
  isCertifierTrusted(policy, someCertifierPk);  // boolean
}
```

An absent rule means the policy expresses no preference (§21) — it is not the same as `allow` or `deny`. Fall back to the relevant protocol requirement, a local default, or user interaction, and remember that a client MAY always apply a stricter local security rule (§22).

### Working with raw events directly

```ts
import { parseTrustPolicy, decryptPrivatePolicy, combinePolicy, resolveCurrentPolicyEvent } from 'ncc-11-js';

const candidates = rawEvents
  .map(parseTrustPolicy)
  .filter((p): p is NonNullable<typeof p> => p !== null && p.policyId === 'default');

const currentEvent = resolveCurrentPolicyEvent(candidates.map((p) => p.event));
const current = candidates.find((p) => p.event.id === currentEvent?.id);

if (current) {
  const privateSet = decryptPrivatePolicy(current.event, ownerSk); // null if undecryptable/absent
  const effective = combinePolicy(current, privateSet);
}
```

## API

- `buildTrustPolicy(opts)` / `publishTrustPolicy(pool, relays, opts)` — build/sign/publish a kind:30067 event, encrypting `privateRules`/`privateTrustedCertifiers` into `content` when given (§5, §16).
- `parseTrustPolicy(event)` — verify signature and structure, and read public rules/certifiers from tags; returns `null` for anything non-conforming.
- `decryptPrivatePolicy(event, secretKey)` — NIP-44 decrypt and parse the private tag array from `content`; returns `null` if absent, undecryptable, or malformed.
- `combinePolicy(parsed, privateSet?)` — merge public and (optional) decrypted private rules per §17, with private rules taking precedence.
- `resolveCurrentPolicyEvent(candidates)` — apply NIP-01 addressable-event replacement semantics across events sharing `kind + pubkey + d` (§18).
- `resolveTrustPolicy(pool, relays, opts)` — full client resolution procedure (§31): fetch, resolve current, parse, decrypt when a `secretKey` is supplied, and combine.
- `getRule(policy, key)`, `isCertifierTrusted(policy, pubkey)`, `getTransportRule(policy, scheme)`, `getMaxStaleAgeSeconds(policy)` — typed readers over an `EffectivePolicy`, all returning `undefined`/`false` rather than guessing when a rule is unspecified (§21) or unresolved (§23).
- `RULE_KEYS`, `transportRuleKey(scheme)` — the core NCC-11 policy key constants (§9, §10.1, §11-14).

Contradictory public rules for the same key resolve as unresolved rather than being picked by tag order (§23), and unrecognised policy keys are preserved as opaque data rather than rejected (§24).

Run `npm test` for a spec-compliance smoke test covering building, parsing, private-content decryption, public/private combination, conflict handling, addressable-event replacement, and full client resolution.
