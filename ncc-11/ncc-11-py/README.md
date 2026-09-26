# ncc-11-py

Minimal reference implementation of [NCC-11: Portable Trust Policy](../README.md) in Python, built on [`nostr-sdk`](https://pypi.org/project/nostr-sdk/) (the Python bindings for the Rust `nostr` crate).

It only builds, parses, decrypts, and resolves kind:30067 policy documents. Applying a resolved policy's rules to real NCC-02/05/09/10 data is the caller's responsibility — this library has no dependency on any other NCC's Python implementation (NCC-11 section 31, steps 10-12).

## Install

```bash
pip install -r requirements.txt
```

## Usage

### Publish a public policy

```python
import asyncio
from nostr_sdk import Client, Keys, NostrSigner, RelayUrl
from ncc11 import publish_trust_policy, RULE_KEYS, transport_rule_key

async def main():
    owner = Keys.generate()
    client = Client()
    await client.add_relay(RelayUrl.parse("wss://relay.example"))
    await client.connect()

    await publish_trust_policy(
        client,
        owner,
        "default",
        public_rules=[
            (RULE_KEYS["KEY_PINNING"], "require"),
            (RULE_KEYS["ATTESTATION"], "require"),
            (RULE_KEYS["STALE_FALLBACK"], "allow"),
            (RULE_KEYS["MAX_STALE_AGE"], "3600"),
            (transport_rule_key("https"), "allow"),
            (transport_rule_key("http"), "deny"),
        ],
        public_trusted_certifiers=["<certifier-pubkey-hex>"],
    )

asyncio.run(main())
```

### Publish a policy with private rules (section 16)

Private rules and trusted-certifier entries are JSON-encoded as tag-shaped arrays and NIP-44 encrypted to the policy owner's own pubkey, following the NIP-51 private-list pattern.

```python
await publish_trust_policy(
    client,
    owner,
    "default",
    public_rules=[(RULE_KEYS["KEY_PINNING"], "require")],
    private_rules=[
        (transport_rule_key("onion"), "allow"),
        (RULE_KEYS["OPERATOR_ACTIONS"], "deny"),
    ],
    private_trusted_certifiers=["<sensitive-certifier-pubkey-hex>"],
)
```

### Client: resolve the current effective policy (section 31)

```python
from ncc11 import resolve_trust_policy, get_rule, get_transport_rule, is_certifier_trusted, RULE_KEYS

policy = await resolve_trust_policy(
    client,
    owner_pubkey="<policy-owner-pubkey-hex>",
    policy_id="default",
    # Omit keys when resolving someone else's policy - only its owner can decrypt private content.
    keys=owner,
)

if policy:
    get_rule(policy, RULE_KEYS["KEY_PINNING"])       # 'require' | 'prefer' | None
    get_transport_rule(policy, "onion")              # 'allow' | 'deny' | None
    is_certifier_trusted(policy, some_certifier_pk)  # bool
```

An absent rule means the policy expresses no preference (section 21) — it is not the same as `allow` or `deny`. Fall back to the relevant protocol requirement, a local default, or user interaction, and remember that a client MAY always apply a stricter local security rule (section 22).

### Working with already-fetched events directly

`resolve_effective_policy` performs no network I/O, so it is easy to use with events you already have (e.g. from your own relay pool logic) and to unit test without a relay:

```python
from ncc11 import resolve_effective_policy

resolved = resolve_effective_policy(raw_events, policy_id="default", keys=owner)
if resolved:
    print(resolved.rules, resolved.trusted_certifiers)
```

## API

- `build_trust_policy(keys, policy_id, ...)` / `publish_trust_policy(client, keys, policy_id, ...)` — build/sign/publish a kind:30067 event, encrypting `private_rules`/`private_trusted_certifiers` into `content` when given (sections 5, 16).
- `parse_trust_policy(event)` — verify signature and structure, and read public rules/certifiers from tags; returns `None` for anything non-conforming.
- `decrypt_private_policy(event, keys)` — NIP-44 decrypt and parse the private tag array from `content`; returns `None` if absent, undecryptable, or malformed.
- `combine_policy(parsed, private_set=None)` — merge public and (optional) decrypted private rules per section 17, with private rules taking precedence.
- `resolve_current_policy_event(candidates)` — apply NIP-01 addressable-event replacement semantics across events sharing `kind + pubkey + d` (section 18).
- `resolve_effective_policy(events, policy_id, keys=None)` — pure (network-free) resolution over an already-fetched event list: filter, resolve current, parse, decrypt when `keys` is supplied, and combine (section 31, steps 4-8).
- `fetch_trust_policy_events(client, owner_pubkey, policy_id, timeout_secs=5)` / `resolve_trust_policy(client, owner_pubkey, policy_id, keys=None, timeout_secs=5)` — thin `nostr_sdk.Client` wrappers that fetch candidates and call `resolve_effective_policy` (full section 31 procedure). These perform real network I/O and are not covered by the offline unit tests.
- `get_rule(policy, key)`, `is_certifier_trusted(policy, pubkey)`, `get_transport_rule(policy, scheme)`, `get_max_stale_age_seconds(policy)` — typed readers over an `EffectivePolicy`, all returning `None`/`False` rather than guessing when a rule is unspecified (section 21) or unresolved (section 23).
- `RULE_KEYS`, `transport_rule_key(scheme)` — the core NCC-11 policy key constants (sections 9, 10.1, 11-14).

Contradictory public rules for the same key resolve as unresolved rather than being picked by tag order (section 23), and unrecognised policy keys are preserved as opaque data rather than rejected (section 24).

Run `python -m unittest test_ncc11 -v` for a spec-compliance smoke test covering building, parsing, private-content decryption, public/private combination and override precedence, conflict handling, unknown-rule preservation, addressable-event replacement, and full offline client resolution.
