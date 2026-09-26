"""
NCC-11: Portable Trust Policy

This library implements the NCC-11 convention for building, parsing, and
resolving signed kind:30067 trust-policy events: a portable format that
lets a Nostr identity express how it wants supporting clients and
runtimes to evaluate the facts and assertions published by other NCCs
(NCC-02, NCC-05, NCC-07, NCC-09, NCC-10), without those conventions
themselves changing (NCC-11 section 2).

NCC-11 deliberately does not depend on any ncc-02/05/09/10 Python
implementation: this library only builds, parses, decrypts, and resolves
policy documents. Applying a resolved policy's rules to real service data
is the caller's responsibility (NCC-11 section 31, steps 10-12).

Built on the `nostr-sdk` package (Rust `nostr` bindings) already used
elsewhere in this repository.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

from nostr_sdk import Event, EventBuilder, Filter, Keys, Kind, Tag, Timestamp

KIND_TRUST_POLICY = 30067

# Well-known policy keys defined directly by NCC-11 (sections 9, 10.1, 11-14).
RULE_KEY_PINNING = "ncc:02:key-pinning"
RULE_ATTESTATION = "ncc:02:attestation"
RULE_STALE_FALLBACK = "ncc:05:stale-fallback"
RULE_MAX_STALE_AGE = "ncc:05:max-stale-age"
RULE_OPERATOR_ACTIONS = "ncc:09:operator-actions"
RULE_OPERATOR_STATE = "ncc:10:operator-state"

RULE_KEYS = {
    "KEY_PINNING": RULE_KEY_PINNING,
    "ATTESTATION": RULE_ATTESTATION,
    "STALE_FALLBACK": RULE_STALE_FALLBACK,
    "MAX_STALE_AGE": RULE_MAX_STALE_AGE,
    "OPERATOR_ACTIONS": RULE_OPERATOR_ACTIONS,
    "OPERATOR_STATE": RULE_OPERATOR_STATE,
}

_HEX_PUBKEY_RE = re.compile(r"^[0-9a-f]{64}$")


def transport_rule_key(scheme: str) -> str:
    """Build the `ncc:05:transport:<scheme>` policy key for a transport (NCC-11 section 12)."""
    return f"ncc:05:transport:{scheme}"


# --- Errors ---


class NCC11Error(Exception):
    pass


class NCC11ArgumentError(NCC11Error):
    pass


# --- Shared rule types ---

# A ("<policy-key>", "<value>") pair, as published in a ["rule", key, value] tag.
RuleTuple = Tuple[str, str]


@dataclass
class RawRuleSet:
    """Rules and trusted certifiers folded from a flat list of tag-shaped arrays.

    A rule key mapped to `None` had conflicting values (NCC-11 section 23)
    and is therefore unresolved.
    """

    rules: Dict[str, Optional[str]] = field(default_factory=dict)
    trusted_certifiers: Set[str] = field(default_factory=set)


def _fold_tags(tags: List[List[str]]) -> RawRuleSet:
    """Fold ["rule", k, v] / ["trust", "certifier", pk] tag-shaped arrays into a RawRuleSet."""
    rule_set = RawRuleSet()
    for tag in tags:
        if len(tag) >= 3 and tag[0] == "rule":
            key, value = tag[1], tag[2]
            if key in rule_set.rules:
                existing = rule_set.rules[key]
                if existing is not None and existing != value:
                    rule_set.rules[key] = None
            else:
                rule_set.rules[key] = value
        elif len(tag) >= 3 and tag[0] == "trust" and tag[1] == "certifier":
            rule_set.trusted_certifiers.add(tag[2])
    return rule_set


def _event_tag_vecs(event: Event) -> List[List[str]]:
    return [tag.to_vec() for tag in event.tags()]


# --- Building (sections 5, 6, 10, 16) ---


def _conversation_partner_for_self(keys: Keys):
    return keys.public_key()


def build_trust_policy(
    keys: Keys,
    policy_id: str,
    public_rules: Optional[List[RuleTuple]] = None,
    public_trusted_certifiers: Optional[List[str]] = None,
    private_rules: Optional[List[RuleTuple]] = None,
    private_trusted_certifiers: Optional[List[str]] = None,
    created_at: Optional[int] = None,
) -> Event:
    """Build and sign a kind:30067 trust-policy event per NCC-11 section 5.

    When `private_rules` or `private_trusted_certifiers` are given, they are
    JSON-encoded as tag-shaped arrays and NIP-44 encrypted to the policy
    owner's own pubkey, following the NIP-51 private-list pattern (section 16).
    """
    public_rules = public_rules or []
    public_trusted_certifiers = public_trusted_certifiers or []
    private_rules = private_rules or []
    private_trusted_certifiers = private_trusted_certifiers or []

    if not policy_id:
        raise NCC11ArgumentError('policy_id (the "d" tag) is required')

    has_any_rule = bool(
        public_rules or public_trusted_certifiers or private_rules or private_trusted_certifiers
    )
    if not has_any_rule:
        raise NCC11ArgumentError(
            "a policy must contain at least one recognised or extension rule, public or private (section 5.3)"
        )

    tags = [Tag.identifier(policy_id)]
    for key, value in public_rules:
        tags.append(Tag.parse(["rule", key, value]))
    for pubkey in public_trusted_certifiers:
        tags.append(Tag.parse(["trust", "certifier", pubkey]))

    content = ""
    if private_rules or private_trusted_certifiers:
        private_tags: List[List[str]] = []
        for key, value in private_rules:
            private_tags.append(["rule", key, value])
        for pubkey in private_trusted_certifiers:
            private_tags.append(["trust", "certifier", pubkey])
        content = keys.nip44_encrypt(_conversation_partner_for_self(keys), json.dumps(private_tags))

    builder = EventBuilder(Kind(KIND_TRUST_POLICY), content).tags(tags)
    if created_at is not None:
        builder = builder.custom_created_at(Timestamp.from_secs(created_at))

    return builder.finalize(keys)


# --- Parsing (sections 5, 6, 10) ---


@dataclass
class ParsedPolicy:
    event: Event
    owner_pubkey: str
    policy_id: str
    created_at: int
    public: RawRuleSet


def parse_trust_policy(event: Event) -> Optional[ParsedPolicy]:
    """Parse and verify a raw event as an NCC-11 trust policy.

    Returns `None` (rather than raising) for anything that doesn't
    structurally conform, matching the parse style used by other
    ncc-*-js/py reference libraries.
    """
    if event.kind().as_u16() != KIND_TRUST_POLICY:
        return None
    if not event.verify():
        return None

    tags = _event_tag_vecs(event)
    policy_id = next((t[1] for t in tags if t[0] == "d" and len(t) >= 2), None)
    if not policy_id:
        return None

    return ParsedPolicy(
        event=event,
        owner_pubkey=event.author().to_hex(),
        policy_id=policy_id,
        created_at=event.created_at().as_secs(),
        public=_fold_tags(tags),
    )


def decrypt_private_policy(event: Event, keys: Keys) -> Optional[RawRuleSet]:
    """Decrypt and parse the private policy content of an NCC-11 event (section 16).

    Returns `None` if there is no private content, or if it fails to
    decrypt or parse - callers should then fall back to public-only rules
    per section 17, without assuming those public rules are the complete
    policy.
    """
    if not event.content():
        return None

    try:
        plaintext = keys.nip44_decrypt(_conversation_partner_for_self(keys), event.content())
        parsed_tags = json.loads(plaintext)
        if not isinstance(parsed_tags, list):
            return None
        return _fold_tags(parsed_tags)
    except Exception:
        return None


# --- Combining public + private (section 17) ---


@dataclass
class EffectivePolicy:
    event: Event
    owner_pubkey: str
    policy_id: str
    created_at: int
    rules: Dict[str, str] = field(default_factory=dict)
    trusted_certifiers: Set[str] = field(default_factory=set)
    private_content_applied: bool = False


def combine_policy(parsed: ParsedPolicy, private_set: Optional[RawRuleSet] = None) -> EffectivePolicy:
    """Combine a parsed policy's public rules with its (optionally already
    decrypted) private rules, per section 17: a private rule takes
    precedence over a public rule for the same key. A public-only combine
    still safely ignores any publicly-conflicted key (section 23).
    """
    rules: Dict[str, str] = {k: v for k, v in parsed.public.rules.items() if v is not None}
    trusted_certifiers: Set[str] = set(parsed.public.trusted_certifiers)

    if private_set is not None:
        for key, value in private_set.rules.items():
            if value is not None:
                rules[key] = value
            else:
                rules.pop(key, None)
        trusted_certifiers |= private_set.trusted_certifiers

    return EffectivePolicy(
        event=parsed.event,
        owner_pubkey=parsed.owner_pubkey,
        policy_id=parsed.policy_id,
        created_at=parsed.created_at,
        rules=rules,
        trusted_certifiers=trusted_certifiers,
        private_content_applied=private_set is not None,
    )


# --- Addressable-event replacement (section 18) ---


def resolve_current_policy_event(candidates: List[Event]) -> Optional[Event]:
    """Resolve the current policy event among candidates sharing the same
    `kind + pubkey + d`, applying NIP-01 replacement semantics: the
    highest `created_at` wins, with the lowest event id breaking a tie
    (section 18).
    """
    if not candidates:
        return None

    current = candidates[0]
    for candidate in candidates[1:]:
        if candidate.created_at().as_secs() > current.created_at().as_secs():
            current = candidate
        elif candidate.created_at().as_secs() == current.created_at().as_secs():
            if candidate.id().to_hex() < current.id().to_hex():
                current = candidate
    return current


# --- Rule evaluation helpers (sections 21, 23, 24) ---


def get_rule(policy: EffectivePolicy, key: str) -> Optional[str]:
    """Read a resolved policy key, or `None` if unspecified (section 21) or
    unresolved (section 23). Unknown keys are treated the same way (section 24).
    """
    return policy.rules.get(key)


def is_certifier_trusted(policy: EffectivePolicy, pubkey: str) -> bool:
    """Whether `pubkey` is named as a trusted NCC-02 certifier in this
    policy (section 10). This does not itself validate any attestation.
    """
    return pubkey in policy.trusted_certifiers


def get_transport_rule(policy: EffectivePolicy, scheme: str) -> Optional[str]:
    """Read the `ncc:05:transport:<scheme>` rule for a given transport scheme (section 12)."""
    value = get_rule(policy, transport_rule_key(scheme))
    return value if value in ("allow", "deny") else None


def get_max_stale_age_seconds(policy: EffectivePolicy) -> Optional[int]:
    """Read `ncc:05:max-stale-age` as a non-negative integer, or `None` if
    absent or not a valid integer (section 11.1).
    """
    raw = get_rule(policy, RULE_MAX_STALE_AGE)
    if raw is None:
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if value >= 0 else None


# --- Client resolution over an already-fetched event set (section 31) ---


def resolve_effective_policy(
    events: List[Event], policy_id: str, keys: Optional[Keys] = None
) -> Optional[EffectivePolicy]:
    """Resolve the current NCC-11 policy for a given policy id from a set of
    already-fetched candidate events, decrypting private content when
    `keys` is supplied, following the client evaluation procedure of
    section 31 (steps 4-8). Returns `None` if no valid policy event matches.

    Callers using a live relay pool should fetch candidates first (e.g. via
    `fetch_trust_policy_events`) and pass the result here; this function
    itself performs no network I/O so it can be exercised in tests without
    a relay.
    """
    candidates = []
    for event in events:
        parsed = parse_trust_policy(event)
        if parsed is not None and parsed.policy_id == policy_id:
            candidates.append(event)

    current_event = resolve_current_policy_event(candidates)
    if current_event is None:
        return None

    parsed = parse_trust_policy(current_event)
    if parsed is None:
        return None

    private_set = decrypt_private_policy(current_event, keys) if keys is not None else None
    return combine_policy(parsed, private_set)


# --- Optional network helpers ---
#
# These thin wrappers are provided for convenience but perform real network
# I/O against a `nostr_sdk.Client`, so they are not covered by the offline
# unit tests in test_ncc11.py.


async def publish_trust_policy(client, keys: Keys, policy_id: str, **kwargs) -> Event:
    """Build, sign, and publish a trust-policy event via an already-connected
    `nostr_sdk.Client`. `kwargs` are forwarded to `build_trust_policy`.
    """
    event = build_trust_policy(keys, policy_id, **kwargs)
    await client.send_event(event)
    return event


async def fetch_trust_policy_events(client, owner_pubkey: str, policy_id: str, timeout_secs: int = 5):
    """Fetch candidate NCC-11 events for an owner/policy id via an
    already-connected `nostr_sdk.Client`.
    """
    from datetime import timedelta

    from nostr_sdk import PublicKey

    f = (
        Filter()
        .author(PublicKey.parse(owner_pubkey))
        .kind(Kind(KIND_TRUST_POLICY))
        .identifier(policy_id)
    )
    result = await client.fetch_events(f, timedelta(seconds=timeout_secs))
    return result.to_vec()


async def resolve_trust_policy(
    client, owner_pubkey: str, policy_id: str, keys: Optional[Keys] = None, timeout_secs: int = 5
) -> Optional[EffectivePolicy]:
    """Fetch and resolve the current NCC-11 policy for an owner/policy id via
    an already-connected `nostr_sdk.Client` (full section 31 procedure).
    """
    events = await fetch_trust_policy_events(client, owner_pubkey, policy_id, timeout_secs)
    return resolve_effective_policy(events, policy_id, keys)
