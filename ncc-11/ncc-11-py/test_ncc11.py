"""
Spec-compliance smoke test for ncc-11-py.

Exercises build -> parse -> decrypt -> combine -> resolve entirely offline,
against plain lists of events. No network access required.
"""

import json
import unittest

from nostr_sdk import Keys

from ncc11 import (
    KIND_TRUST_POLICY,
    RULE_KEYS,
    NCC11ArgumentError,
    build_trust_policy,
    combine_policy,
    decrypt_private_policy,
    get_max_stale_age_seconds,
    get_rule,
    get_transport_rule,
    is_certifier_trusted,
    parse_trust_policy,
    resolve_current_policy_event,
    resolve_effective_policy,
    transport_rule_key,
)


class TestNCC11(unittest.TestCase):
    def setUp(self):
        self.owner = Keys.generate()
        self.certifier_a = Keys.generate()
        self.certifier_b = Keys.generate()

    def test_rejects_a_policy_with_no_rules(self):
        # section 5.3
        with self.assertRaises(NCC11ArgumentError):
            build_trust_policy(self.owner, "default")

    def test_rejects_a_policy_without_a_policy_id(self):
        # section 5.2
        with self.assertRaises(NCC11ArgumentError):
            build_trust_policy(
                self.owner, "", public_rules=[(RULE_KEYS["KEY_PINNING"], "require")]
            )

    def test_build_and_parse_a_public_policy(self):
        # sections 5, 6, 10
        policy = build_trust_policy(
            self.owner,
            "default",
            public_rules=[
                (RULE_KEYS["KEY_PINNING"], "require"),
                (RULE_KEYS["ATTESTATION"], "require"),
                (RULE_KEYS["STALE_FALLBACK"], "allow"),
                (RULE_KEYS["MAX_STALE_AGE"], "3600"),
                (transport_rule_key("https"), "allow"),
                (transport_rule_key("http"), "deny"),
            ],
            public_trusted_certifiers=[self.certifier_a.public_key().to_hex()],
            created_at=1_000_000,
        )
        self.assertEqual(policy.kind().as_u16(), KIND_TRUST_POLICY)
        self.assertEqual(policy.content(), "")

        parsed = parse_trust_policy(policy)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed.policy_id, "default")

        effective = combine_policy(parsed)
        self.assertEqual(get_rule(effective, RULE_KEYS["KEY_PINNING"]), "require")
        self.assertTrue(is_certifier_trusted(effective, self.certifier_a.public_key().to_hex()))
        self.assertFalse(is_certifier_trusted(effective, self.certifier_b.public_key().to_hex()))
        self.assertEqual(get_transport_rule(effective, "https"), "allow")
        self.assertEqual(get_transport_rule(effective, "http"), "deny")
        self.assertIsNone(get_transport_rule(effective, "onion"))  # section 12: not inferred
        self.assertEqual(get_max_stale_age_seconds(effective), 3600)
        self.assertFalse(effective.private_content_applied)

    def test_tampered_signature_fails_verification(self):
        policy = build_trust_policy(
            self.owner, "default", public_rules=[(RULE_KEYS["KEY_PINNING"], "require")]
        )
        raw = json.loads(policy.as_json())
        raw["content"] = "tampered"
        from nostr_sdk import Event

        tampered = Event.from_json(json.dumps(raw))
        self.assertIsNone(parse_trust_policy(tampered))

    def test_unknown_rule_key_is_preserved_as_opaque_data(self):
        # section 24
        policy = build_trust_policy(
            self.owner,
            "default",
            public_rules=[
                (RULE_KEYS["KEY_PINNING"], "require"),
                ("ncc:27:future-behaviour", "require"),
            ],
        )
        parsed = parse_trust_policy(policy)
        self.assertIsNotNone(parsed)
        effective = combine_policy(parsed)
        self.assertEqual(get_rule(effective, "ncc:27:future-behaviour"), "require")

    def test_conflicting_public_rules_resolve_as_unresolved(self):
        # section 23: not picked by tag order
        policy = build_trust_policy(
            self.owner,
            "default",
            public_rules=[
                (RULE_KEYS["OPERATOR_ACTIONS"], "allow"),
                (RULE_KEYS["OPERATOR_ACTIONS"], "deny"),
            ],
        )
        effective = combine_policy(parse_trust_policy(policy))
        self.assertIsNone(get_rule(effective, RULE_KEYS["OPERATOR_ACTIONS"]))

    def test_private_content_round_trips_and_combines(self):
        # sections 16, 17
        policy = build_trust_policy(
            self.owner,
            "default",
            public_rules=[(RULE_KEYS["KEY_PINNING"], "require")],
            public_trusted_certifiers=[self.certifier_a.public_key().to_hex()],
            private_rules=[
                (transport_rule_key("onion"), "allow"),
                (RULE_KEYS["OPERATOR_ACTIONS"], "deny"),
            ],
            private_trusted_certifiers=[self.certifier_b.public_key().to_hex()],
        )
        self.assertGreater(len(policy.content()), 0)

        parsed = parse_trust_policy(policy)
        decrypted = decrypt_private_policy(policy, self.owner)
        self.assertIsNotNone(decrypted)
        self.assertEqual(decrypted.rules.get(transport_rule_key("onion")), "allow")

        effective = combine_policy(parsed, decrypted)
        self.assertTrue(effective.private_content_applied)
        self.assertEqual(get_rule(effective, RULE_KEYS["KEY_PINNING"]), "require")
        self.assertEqual(get_transport_rule(effective, "onion"), "allow")
        self.assertTrue(is_certifier_trusted(effective, self.certifier_b.public_key().to_hex()))

    def test_private_rule_overrides_public_rule_for_same_key(self):
        # section 17
        policy = build_trust_policy(
            self.owner,
            "default",
            public_rules=[(RULE_KEYS["OPERATOR_ACTIONS"], "allow")],
            private_rules=[(RULE_KEYS["OPERATOR_ACTIONS"], "deny")],
        )
        parsed = parse_trust_policy(policy)
        decrypted = decrypt_private_policy(policy, self.owner)
        effective = combine_policy(parsed, decrypted)
        self.assertEqual(get_rule(effective, RULE_KEYS["OPERATOR_ACTIONS"]), "deny")

        # without decryption, only the public rule is visible.
        undecrypted = combine_policy(parsed, None)
        self.assertEqual(get_rule(undecrypted, RULE_KEYS["OPERATOR_ACTIONS"]), "allow")
        self.assertFalse(undecrypted.private_content_applied)

    def test_decrypting_with_the_wrong_key_fails_safely(self):
        policy = build_trust_policy(
            self.owner, "default", private_rules=[(RULE_KEYS["OPERATOR_ACTIONS"], "deny")]
        )
        wrong_key = Keys.generate()
        self.assertIsNone(decrypt_private_policy(policy, wrong_key))

    def test_addressable_event_replacement(self):
        # section 18
        older = build_trust_policy(
            self.owner, "default", public_rules=[(RULE_KEYS["KEY_PINNING"], "prefer")], created_at=1_000_000
        )
        newer = build_trust_policy(
            self.owner, "default", public_rules=[(RULE_KEYS["KEY_PINNING"], "require")], created_at=1_200_000
        )
        current = resolve_current_policy_event([older, newer])
        self.assertEqual(current.id().to_hex(), newer.id().to_hex())

    def test_named_policies_are_distinct_addressable_events(self):
        # section 19
        strict_policy = build_trust_policy(
            self.owner,
            "strict",
            public_rules=[(RULE_KEYS["KEY_PINNING"], "require"), (RULE_KEYS["STALE_FALLBACK"], "deny")],
        )
        parsed = parse_trust_policy(strict_policy)
        self.assertEqual(parsed.policy_id, "strict")

    def test_resolve_effective_policy_end_to_end(self):
        # section 31
        older = build_trust_policy(
            self.owner, "default", public_rules=[(RULE_KEYS["KEY_PINNING"], "prefer")], created_at=1_000_000
        )
        newer = build_trust_policy(
            self.owner, "default", public_rules=[(RULE_KEYS["KEY_PINNING"], "require")], created_at=1_200_000
        )
        mixed = build_trust_policy(
            self.owner,
            "default",
            public_rules=[(RULE_KEYS["KEY_PINNING"], "require")],
            private_rules=[(transport_rule_key("onion"), "allow")],
            created_at=1_100_000,
        )

        resolved = resolve_effective_policy([older, newer, mixed], "default", keys=self.owner)
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved.event.id().to_hex(), newer.id().to_hex())

        resolved_no_key = resolve_effective_policy([mixed], "default", keys=None)
        self.assertIsNotNone(resolved_no_key)
        self.assertFalse(resolved_no_key.private_content_applied)
        self.assertEqual(get_rule(resolved_no_key, RULE_KEYS["KEY_PINNING"]), "require")

    def test_resolve_effective_policy_returns_none_when_no_match(self):
        # section 21: never a guessed policy
        policy = build_trust_policy(
            self.owner, "default", public_rules=[(RULE_KEYS["KEY_PINNING"], "require")]
        )
        self.assertIsNone(resolve_effective_policy([policy], "unknown-profile"))
        self.assertIsNone(resolve_effective_policy([], "default"))


if __name__ == "__main__":
    unittest.main()
