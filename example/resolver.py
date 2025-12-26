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

        if args.nsec:
            keys = Keys.parse(getpass.getpass("Enter your nsec: "))
        else:
            keys = None

        target_pubkey_hex = args.pubkey
        if not target_pubkey_hex and keys:
            target_pubkey_hex = keys.public_key().to_hex()

        if not target_pubkey_hex:
            print("Error: --pubkey (or --nsec) required.")
            return None

        gossip_enabled = args.gossip
        proxy_addr = args.proxy
        relay_arg = args.relay
        live_mode = args.live
        id_tag = args.identifier
    else:
        keys = provided_keys
        target_pubkey_hex = target_pk
        gossip_enabled = gossip
        proxy_addr = None
        relay_arg = bootstrap_relay
        live_mode = False
        id_tag = identifier

    # Setup Client
    from nostr_sdk import ClientBuilder
    if keys:
        builder = ClientBuilder().signer(NostrSigner.keys(keys))
    else:
        builder = ClientBuilder()

    opts = ClientOptions()
    if gossip_enabled:
        limits = GossipRelayLimits(
            read_relays_per_user=2, write_relays_per_user=2,
            hint_relays_per_user=1, most_used_relays_per_user=1, nip17_relays=0
        )
        opts = opts.gossip(GossipOptions(limits=limits))

    if proxy_addr:
        conn = Connection().mode(ConnectionMode.PROXY).addr(proxy_addr)
        opts = opts.connection(conn)

    client = builder.opts(opts).build()
    relay_url = relay_arg or ("wss://relay.damus.io" if live_mode
                              else "ws://localhost:8080")

    await client.add_relay(RelayUrl.parse(relay_url))
    await client.connect()

    f = Filter().author(PublicKey.parse(target_pubkey_hex)) \
        .kind(Kind(30058)).identifier(id_tag).limit(10)

    print(f"Fetching event for {target_pubkey_hex[:8]}...")
    events_obj = await client.fetch_events(f, timedelta(seconds=15))
    all_events = events_obj.to_vec()

    if not all_events:
        print("No record found.")
        return None

    all_events.sort(key=lambda x: x.created_at().as_secs(), reverse=True)
    latest_event = all_events[0]

    # 4. Decrypt or Parse
    try:
        content = latest_event.content()
        # If it looks like JSON, it might be plaintext
        if not (content.startswith('{') or content.startswith('[')):
            if not keys:
                print("Error: Event content is encrypted. Use --nsec.")
                return None
            content = nip44_decrypt(
                keys.secret_key(), latest_event.author(), content
            )

        payload = json.loads(content)
        print("\n--- NCC-05 Resolution Result ---")
        for ep in payload.get('endpoints', []):
            print(f"  - {ep.get('type')}://{ep.get('uri')} "
                  f"({ep.get('family')})")
        print("---------------------------------")
        return payload
    except Exception as e:
        print(f"Failed to process content: {e}")
        return None


if __name__ == "__main__":
    asyncio.run(resolve())
