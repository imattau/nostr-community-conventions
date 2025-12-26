import json
import time
import asyncio
import argparse
import getpass
from datetime import timedelta
from nostr_sdk import (
    Keys, Client, Filter, Kind, NostrSigner,
    nip44_decrypt, RelayUrl, PublicKey,
    ClientOptions, GossipOptions, GossipRelayLimits,
    Connection, ConnectionMode
)


async def resolve(provided_keys=None, target_pk=None, bootstrap_relay=None):
    if provided_keys is None:
        parser = argparse.ArgumentParser(description="NCC-05 Resolver PoC")
        parser.add_argument("--nsec", action="store_true", help="Prompt for nsec")
        parser.add_argument("--pubkey", help="The hex public key to resolve")
        parser.add_argument("--live", action="store_true", help="Use real relays")
        parser.add_argument("--relay", help="Bootstrap relay")
        parser.add_argument("--gossip", action="store_true", help="Enable Gossip")
        parser.add_argument("--proxy", help="SOCKS5 proxy (e.g. 127.0.0.1:9050)")
        args = parser.parse_args()

        if not args.nsec:
            print("Error: --nsec is required.")
            return None

        keys = Keys.parse(getpass.getpass("Enter your nsec: "))
        target_pubkey_hex = args.pubkey if args.pubkey else \
            keys.public_key().to_hex()
        gossip_enabled = args.gossip
        proxy_addr = args.proxy
        relay_arg = args.relay
        live_mode = args.live
    else:
        keys = provided_keys
        target_pubkey_hex = target_pk if target_pk else \
            keys.public_key().to_hex()
        gossip_enabled = False
        proxy_addr = None
        relay_arg = bootstrap_relay
        live_mode = False

    # Setup Client
    from nostr_sdk import ClientBuilder
    builder = ClientBuilder().signer(NostrSigner.keys(keys))
    
    opts = ClientOptions()
    if gossip_enabled:
        limits = GossipRelayLimits(2, 2, 1, 1, 0)
        opts = opts.gossip(GossipOptions(limits=limits))
    
    if proxy_addr:
        print(f"Routing through proxy: {proxy_addr}")
        conn = Connection().mode(ConnectionMode.PROXY).addr(proxy_addr)
        opts = opts.connection(conn)

    client = builder.opts(opts).build()
    
    if relay_arg:
        relay_url = relay_arg
    else:
        relay_url = "wss://relay.damus.io" if live_mode \
            else "ws://localhost:8080"

    print(f"Bootstrap Relay: {relay_url}")
    print(f"Target Pubkey: {target_pubkey_hex}")

    await client.add_relay(RelayUrl.parse(relay_url))
    await client.connect()

    f = Filter().author(PublicKey.parse(target_pubkey_hex)) \
        .kind(Kind(30058)).identifier("addr").limit(1)
    
    print("Fetching event...")
    events_obj = await client.fetch_events(f, timedelta(seconds=15))
    events = events_obj.to_vec()
    
    if not events:
        print("No record found.")
        return None

    latest_event = events[0]
    try:
        decrypted = nip44_decrypt(
            keys.secret_key(),
            latest_event.author(),
            latest_event.content()
        )
        payload = json.loads(decrypted)
        
        print("\n--- NCC-05 Resolution Result ---")
        for ep in payload.get('endpoints', []):
            print(f"  - {ep.get('type')}://{ep.get('uri')} "
                  f"({ep.get('family')})")
        print("---------------------------------")
        return payload
    except Exception as e:
        print(f"Decryption failed: {e}")
        return None

if __name__ == "__main__":
    asyncio.run(resolve())
