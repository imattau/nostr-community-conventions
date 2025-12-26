import asyncio
import unittest
import time
from nostr_sdk import Keys
from publisher import run as publish_run
from resolver import resolve as resolve_run


class TestNCC05Local(unittest.TestCase):
    def setUp(self):
        self.mock_relay = "ws://localhost:8080"

    def test_basic_resolution_local(self):
        """Test direct resolution against a local mock relay."""
        async def run_test():
            keys = Keys.generate()
            pk = keys.public_key().to_hex()
            test_ip = "127.0.0.1"
            unique_d = f"local-basic-{int(time.time())}"

            print(f"\n[Local Basic] Using pk: {pk}")
            # Use local relay
            await publish_run(
                provided_keys=keys, manual_ip=test_ip,
                relay=self.mock_relay, d_tag=unique_d
            )

            # Resolve from same local relay
            payload = await resolve_run(
                provided_keys=keys, target_pk=pk,
                bootstrap_relay=self.mock_relay, identifier=unique_d
            )

            self.assertIsNotNone(payload)
            self.assertTrue(any(test_ip in ep['uri']
                            for ep in payload['endpoints']))
            print("[Local Basic] Success!")

        asyncio.run(run_test())

    def test_gossip_local(self):
        """
        Test Gossip (NIP-65) against local mock relay.
        Note: True gossip discovery across multiple relays requires multiple
        mock relays. This test verifies that the resolver can find a record
        on the same relay using the discovery code path.
        """
        async def run_test():
            keys = Keys.generate()
            pk = keys.public_key().to_hex()
            test_ip = "10.0.0.1"
            unique_d = f"local-gossip-{int(time.time())}"

            print(f"\n[Local Gossip] Using pk: {pk}")

            # 1. Publish Relay List (pointing to itself)
            await publish_run(
                provided_keys=keys, relay=self.mock_relay,
                relay_list=self.mock_relay
            )

            # 2. Publish record
            await publish_run(
                provided_keys=keys, manual_ip=test_ip,
                relay=self.mock_relay, d_tag=unique_d
            )

            # 3. Resolve via discovery
            payload = await resolve_run(
                provided_keys=keys, target_pk=pk,
                bootstrap_relay=self.mock_relay, gossip=True,
                identifier=unique_d
            )

            self.assertIsNotNone(payload)
            self.assertTrue(any(test_ip in ep['uri']
                            for ep in payload['endpoints']))
            print("[Local Gossip] Success!")

        asyncio.run(run_test())


if __name__ == "__main__":
    unittest.main()
