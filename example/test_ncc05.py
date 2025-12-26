import asyncio
import unittest
from nostr_sdk import Keys
from publisher import run as publish_run
from resolver import resolve as resolve_run

class TestNCC05(unittest.TestCase):
    def test_publish_and_resolve(self):
        """Test the full flow: publish an NCC-05 record and resolve it."""
        async def run_test():
            # 1. Setup unique keys for this test
            keys = Keys.generate()
            pk = keys.public_key().to_hex()
            test_relay = "wss://relay.damus.io"
            test_ip = "1.2.3.4"
            
            print(f"\n[Test] Using pk: {pk}")
            
            # 2. Publish
            print("[Test] Publishing record...")
            await publish_run(provided_keys=keys, manual_ip=test_ip, relay=test_relay)
            
            # Wait a bit for the relay to process
            await asyncio.sleep(2)
            
            # 3. Resolve
            print("[Test] Resolving record...")
            payload = await resolve_run(provided_keys=keys, target_pk=pk, bootstrap_relay=test_relay)
            
            # 4. Verify
            self.assertIsNotNone(payload, "Failed to resolve payload")
            self.assertEqual(payload['v'], 1)
            
            # Find the endpoint we published
            found = False
            for ep in payload['endpoints']:
                if test_ip in ep['uri']:
                    found = True
                    break
            
            self.assertTrue(found, f"Published IP {test_ip} not found in resolved endpoints")
            print("[Test] Success! Resolved payload matches published data.")

        asyncio.run(run_test())

if __name__ == "__main__":
    unittest.main()
