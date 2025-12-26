import json
import asyncio
import argparse
import getpass
from datetime import timedelta
from nostr_sdk import (
    Keys, Filter, Kind, NostrSigner,
    nip44_decrypt, RelayUrl, PublicKey,
    ClientOptions, GossipOptions, GossipRelayLimits,
    Connection, ConnectionMode
)


async def resolve(provided_keys=None, target_pk=None,
                  bootstrap_relay=None, gossip=False, identifier="addr"):
    if provided_keys is None:
        parser = argparse.ArgumentParser(description="NCC-05 Resolver PoC")
        parser.add_argument("--nsec", action="store_true", help="Prompt nsec")
        parser.add_argument("--pubkey", help="Hex public key to resolve")
        parser.add_argument("--live", action="store_true", help="Use real")
        parser.add_argument("--relay", help="Bootstrap relay")
        parser.add_argument("--gossip", action="store_true", help="Gossip")
        parser.add_argument("--proxy", help="SOCKS5 proxy")
        parser.add_argument("--identifier", default="addr",
                            help="The 'd' tag identifier")
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
        id_tag = args.identifier
    else:
        keys = provided_keys
        target_pubkey_hex = target_pk if target_pk else \
            keys.public_key().to_hex()
        gossip_enabled = gossip
        proxy_addr = None
        relay_arg = bootstrap_relay
        live_mode = False
        id_tag = identifier

    # Setup Client
    from nostr_sdk import ClientBuilder
    builder = ClientBuilder().signer(NostrSigner.keys(keys))

    opts = ClientOptions()
    if gossip_enabled:
        print("Gossip enabled. Discovering relay list for target...")
        limits = GossipRelayLimits(
            read_relays_per_user=2,
            write_relays_per_user=2,
            hint_relays_per_user=1,
            most_used_relays_per_user=1,
            nip17_relays=0
        )
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
        .kind(Kind(30058)).identifier(id_tag).limit(10)

    print("Fetching event...")
    # fetch_events with gossip will hunt for kind:10002 first
    events_obj = await client.fetch_events(f, timedelta(seconds=15))
    all_events = events_obj.to_vec()

    if not all_events:
        print("No record found.")
        return None

    # Sort to ensure we have the latest
    all_events.sort(key=lambda x: x.created_at().as_secs(), reverse=True)
    latest_event = all_events[0]
    print(f"Found event {latest_event.id().to_hex()} "
          f"created at {latest_event.created_at().as_secs()}")

    # 4. Decrypt
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
