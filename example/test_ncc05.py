import asyncio
import unittest
import time
from nostr_sdk import Keys
from publisher import run as publish_run
from resolver import resolve as resolve_run

class TestNCC05(unittest.TestCase):
    def test_publish_and_resolve(self):
        """Test the basic direct resolution flow."""
        async def run_test():
            keys = Keys.generate()
            pk = keys.public_key().to_hex()
            test_relay = "wss://relay.damus.io"
            test_ip = "1.2.3.4"
            unique_d = f"test-basic-{int(time.time())}"
            
            print(f"\n[Basic Test] Using pk: {pk} and d: {unique_d}")
            await publish_run(provided_keys=keys, manual_ip=test_ip, relay=test_relay, d_tag=unique_d)
            await asyncio.sleep(2)
            payload = await resolve_run(provided_keys=keys, target_pk=pk, bootstrap_relay=test_relay, identifier=unique_d)
            
            self.assertIsNotNone(payload)
            self.assertTrue(any(test_ip in ep['uri'] for ep in payload['endpoints']))
            print("[Basic Test] Success!")

        asyncio.run(run_test())

    def test_gossip_discovery(self):
        """
        Test Gossip (NIP-65) resolution.
        1. Publish Relay List to Relay A.
        2. Publish NCC-05 record to Relay B.
        3. Resolve via Relay A only (Gossip enabled).
        """
        async def run_test():
            keys = Keys.generate()
            pk = keys.public_key().to_hex()
            relay_a = "wss://relay.damus.io"
            relay_b = "wss://nos.lol"
            test_ip = "9.9.9.9"
            unique_d = f"test-gossip-{int(time.time())}"
            
            print(f"\n[Gossip Test] Using pk: {pk} and d: {unique_d}")
            
            # 1. Publish Relay List to Relay A telling the world to look at Relay B
            print(f"[Gossip Test] Publishing Relay List to {relay_a} pointing to {relay_b}...")
            await publish_run(provided_keys=keys, relay=relay_a, relay_list=relay_b)
            await asyncio.sleep(2)
            
            # 2. Publish actual record to Relay B
            print(f"[Gossip Test] Publishing NCC-05 record to {relay_b} with d={unique_d}...")
            await publish_run(provided_keys=keys, manual_ip=test_ip, relay=relay_b, d_tag=unique_d)
            
            print("[Gossip Test] Waiting for relay propagation (10s)...")
            await asyncio.sleep(10)
            
            # 3. Resolve using Relay A as bootstrap
            # It must discover that the user is on Relay B and fetch the record from there.
            print(f"[Gossip Test] Resolving via {relay_a} with Gossip for d={unique_d}...")
            payload = await resolve_run(provided_keys=keys, target_pk=pk, bootstrap_relay=relay_a, gossip=True, identifier=unique_d)
            
            self.assertIsNotNone(payload, "Gossip resolution failed to find payload")
            self.assertTrue(any(test_ip in ep['uri'] for ep in payload['endpoints']))
            print("[Gossip Test] Success! Discovered record via Gossip path.")

        asyncio.run(run_test())

if __name__ == "__main__":
    unittest.main()
