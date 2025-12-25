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


async def resolve():
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
        return

    keys = Keys.parse(getpass.getpass("Enter your nsec: "))
    target_pubkey_hex = args.pubkey if args.pubkey else keys.public_key().to_hex()

    # Setup Options
    opts = ClientOptions()
    if args.gossip:
        limits = GossipRelayLimits(2, 2, 1, 1, 0)
        opts = opts.gossip(GossipOptions(limits=limits))
    
    if args.proxy:
        print(f"Routing through proxy: {args.proxy}")
        conn = Connection().mode(ConnectionMode.PROXY).addr(args.proxy)
        opts = opts.connection(conn)

    client = Client(NostrSigner.keys(keys), opts)
    relay_url = args.relay if args.relay else \
        ("wss://relay.damus.io" if args.live else "ws://localhost:8080")

    await client.add_relay(RelayUrl.parse(relay_url))
    await client.connect()

    f = Filter().author(PublicKey.parse(target_pubkey_hex)).kind(Kind(30058)).identifier("addr").limit(1)
    
    print("Fetching event...")
    events_obj = await client.fetch_events(f, timedelta(seconds=15))
    events = events_obj.to_vec()
    
    if not events:
        print("No record found.")
        return

    latest_event = events[0]
    try:
        decrypted = nip44_decrypt(keys.secret_key(), latest_event.author(), latest_event.content())
        payload = json.loads(decrypted)
        
        print("\n--- NCC-05 Resolution Result ---")
        for ep in payload.get('endpoints', []):
            print(f"  - {ep.get('type')}://{ep.get('uri')} ({ep.get('family')})")
        print("---------------------------------")
    except Exception as e:
        print(f"Decryption failed: {e}")

if __name__ == "__main__":
    asyncio.run(resolve())
