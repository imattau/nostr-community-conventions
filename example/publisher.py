import json
import time
import asyncio
import argparse
import socket
import getpass
import requests
from nostr_sdk import (
    Keys, EventBuilder, Tag, Kind,
    NostrSigner, nip44_encrypt, Nip44Version, RelayUrl
)


def get_local_public_ipv6():
    """Try to find a global IPv6 address on local interfaces."""
    try:
        s = socket.socket(socket.AF_INET6, socket.SOCK_DGRAM)
        s.connect(("2001:4860:4860::8888", 80))
        local_ip = s.getsockname()[0]
        s.close()
        if local_ip and not local_ip.startswith(('fe80:', '::1', 'fd', 'fc')):
            return local_ip
    except Exception:
        pass
    return None


def get_public_ip_external():
    """Fallback: Ask a third party."""
    try:
        return requests.get('https://api.ipify.org', timeout=5).text
    except Exception:
        return None


def get_auto_onion_address(control_port=9051, service_port=8080):
    """Automatically create an ephemeral hidden service and get address."""
    try:
        from stem.control import Controller
        with Controller.from_port(port=control_port) as controller:
            controller.authenticate()  # Assumes cookie or no password
            response = controller.create_ephemeral_hidden_service(
                {service_port: 8080}, await_publication=True
            )
            return response.service_id + ".onion"
    except Exception as e:
        print(f"Tor Automation Error: {e}")
        return None


async def run(provided_keys=None, manual_ip=None, relay=None,
              relay_list=None, d_tag="addr"):
    # Setup argparse if not called from a test
    if provided_keys is None:
        parser = argparse.ArgumentParser(description="NCC-05 Publisher PoC")
        parser.add_argument("--nsec", action="store_true",
                            help="Use existing nsec (interactive)")
        parser.add_argument("--live", action="store_true",
                            help="Use real IP and real relays")
        parser.add_argument("--ip", help="Manually specify the public IP")
        parser.add_argument("--onion", help="Add a Tor .onion address")
        parser.add_argument("--auto-onion", action="store_true",
                            help="Automatically create a Tor hidden service")
        parser.add_argument("--relay", help="Set a specific relay")
        parser.add_argument("--relay-list", help="Comma-separated NIP-65 "
                            "relays")
        parser.add_argument("--proxy", help="SOCKS5 proxy (e.g. "
                            "127.0.0.1:9050)")
        parser.add_argument("--recipient", help="Hex pubkey of the recipient "
                            "(optional, defaults to self)")
        parser.add_argument("--identifier", default="addr",
                            help="The 'd' tag identifier")
        args = parser.parse_args()
        id_tag = args.identifier
        recipient_pk = args.recipient
    else:
        args = argparse.Namespace(nsec=False, live=False, ip=manual_ip,
                                  onion=None, auto_onion=False, relay=relay,
                                  relay_list=relay_list,
                                  proxy=None, recipient=None)
        id_tag = d_tag
        recipient_pk = None

    # 1. Setup Keys
    if args.nsec:
        nsec_input = getpass.getpass("Enter your nsec: ")
        keys = Keys.parse(nsec_input)
        print(f"Using keys for pubkey: {keys.public_key().to_hex()}")
    elif provided_keys:
        keys = provided_keys
    else:
        keys = Keys.generate()
        print(f"Generated Keys: {keys.public_key().to_hex()}")

    # 2. Determine IP/Onion
    endpoints = []
    
    # Manual Onion
    if args.onion:
        endpoints.append({
            "type": "tcp",
            "uri": f"{args.onion}:8080",
            "priority": 5,
            "family": "onion"
        })
        print(f"Adding Onion endpoint: {args.onion}")

    # Auto Onion
    if args.auto_onion:
        print("Attempting to create Tor Hidden Service...")
        onion_addr = get_auto_onion_address()
        if onion_addr:
            endpoints.append({
                "type": "tcp",
                "uri": f"{onion_addr}:8080",
                "priority": 1, # Prefer auto-onion
                "family": "onion"
            })
            print(f"Created ephemeral Onion: {onion_addr}")

    if args.ip:
        ip = args.ip
    else:
        ip = get_local_public_ipv6()
        if not ip and args.live:
            ip = get_public_ip_external()

    if ip:
        endpoints.append({
            "type": "tcp",
            "uri": f"[{ip}]:8080" if ":" in ip else f"{ip}:8080",
            "priority": 10,
            "family": "ipv6" if ":" in ip else "ipv4"
        })
        print(f"Adding IP endpoint: {ip}")

    # 3. Setup Client with Proxy
    from nostr_sdk import ClientBuilder, ClientOptions, Connection, \
        ConnectionMode
    signer = NostrSigner.keys(keys)
    builder = ClientBuilder().signer(signer)

    if args.proxy:
        print(f"Routing through proxy: {args.proxy}")
        conn = Connection().mode(ConnectionMode.PROXY).addr(args.proxy)
        opts = ClientOptions().connection(conn)
        builder = builder.opts(opts)

    client = builder.build()

    relay_url = args.relay if args.relay else \
        ("wss://relay.damus.io" if args.live else "ws://localhost:8080")

    await client.add_relay(RelayUrl.parse(relay_url))
    await client.connect()

    # 4. Optional: NIP-65
    if args.relay_list:
        print(f"Publishing relay list: {args.relay_list}")
        relay_map = {RelayUrl.parse(r.strip()): None
                     for r in args.relay_list.split(",")}
        await client.send_event(
            EventBuilder.relay_list(relay_map).sign_with_keys(keys)
        )

    # 5. Payload & Publish
    payload = {
        "v": 1,
        "ttl": 600,
        "updated_at": int(time.time()),
        "endpoints": endpoints,
        "notes": "NCC-05 Tor Auto PoC"
    }
    
    # Encrypt (NIP-44)
    from nostr_sdk import PublicKey as NSPublicKey
    encryption_target = NSPublicKey.parse(recipient_pk) if recipient_pk \
        else keys.public_key()

    encrypted_content = nip44_encrypt(
        keys.secret_key(), encryption_target,
        json.dumps(payload), Nip44Version.V2
    )
    
    event = (EventBuilder(Kind(30058), encrypted_content)
             .tags([Tag.parse(["d", id_tag])])
             .sign_with_keys(keys))

    print(f"Publishing event {event.id().to_hex()}...")
    await client.send_event(event)
    print("Success!")


if __name__ == "__main__":
    asyncio.run(run())