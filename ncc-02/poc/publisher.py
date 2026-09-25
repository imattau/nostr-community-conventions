import time
import argparse
try:
    from .models import NostrEvent
    from .mock_relay import MockRelay
except ImportError:
    from models import NostrEvent
    from mock_relay import MockRelay


class ServicePublisher:
    def __init__(self, private_key: str, relay: MockRelay):
        from pynostr.key import PrivateKey
        self.sk = PrivateKey.from_hex(private_key)
        self.pk = self.sk.public_key.hex()
        self.relay = relay

    def publish_service_record(self,
                               service_id: str,
                               endpoint: str,
                               key_fingerprint: str,
                               expiry_days: int = 14):
        expiry_timestamp = int(time.time()) + (expiry_days * 24 * 60 * 60)

        tags = [
            ["d", service_id],
            ["u", endpoint],
            ["k", key_fingerprint],
            ["exp", str(expiry_timestamp)]
        ]

        # Kind 30059 as defined for NCC-02 Service Records
        event = NostrEvent(
            pubkey=self.pk,
            kind=30059,
            content=f"NCC-02 Service Record for {service_id}",
            tags=tags
        )
        event.sign(self.sk.hex())
        self.relay.publish(event)
        return event


class CertificateAuthority:
    def __init__(self, private_key: str, relay: MockRelay):
        from pynostr.key import PrivateKey
        self.sk = PrivateKey.from_hex(private_key)
        self.pk = self.sk.public_key.hex()
        self.relay = relay

    def issue_attestation(self,
                          subject_pubkey: str,
                          service_id: str,
                          service_event_id: str,
                          level: str = "verified",
                          valid_days: int = 30):
        now = int(time.time())
        expiry = now + (valid_days * 24 * 60 * 60)

        tags = [
            ["subj", subject_pubkey],
            ["srv", service_id],
            ["e", service_event_id],
            ["std", "nostr-service-trust-v0.1"],
            ["lvl", level],
            ["nbf", str(now)],
            ["exp", str(expiry)]
        ]

        # Kind 30060 for Attestations
        event = NostrEvent(self.pk, 30060, "NCC-02 Attestation", tags)
        event.sign(self.sk.hex())
        self.relay.publish(event)
        return event

    def revoke_attestation(self, attestation_id: str, reason: str = ""):
        tags = [["e", attestation_id]]
        if reason:
            tags.append(["reason", reason])

        # Kind 30061 for Revocations
        event = NostrEvent(self.pk, 30061, "NCC-02 Revocation", tags)
        event.sign(self.sk.hex())
        self.relay.publish(event)
        return event


def main():
    parser = argparse.ArgumentParser(description="NCC-02 Service Publisher (CLI)")
    parser.add_argument("--sk", required=True, help="Private key (hex)")
    parser.add_argument("--id", required=True, help="Service ID (d tag)")
    parser.add_argument("--u", required=True, help="Endpoint URI")
    parser.add_argument("--k", required=True, help="Key fingerprint")
    
    args = parser.parse_args()
    
    relay = MockRelay() 
    publisher = ServicePublisher(args.sk, relay)
    
    event = publisher.publish_service_record(args.id, args.u, args.k)
    print(f"Published Service Record: {event.id}")
    print(f"Tags: {event.tags}")


if __name__ == "__main__":
    main()