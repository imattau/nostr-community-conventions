import time
from typing import Optional, Dict, List
from .mock_relay import MockRelay


class ServiceResolver:
    def __init__(self, relay: MockRelay, trusted_ca_pubkeys: List[str] = None):
        self.relay = relay
        self.trusted_ca_pubkeys = trusted_ca_pubkeys or []

    def resolve(self,
                pubkey: str,
                service_id: str,
                require_attestation: bool = False) -> Optional[Dict]:
        # 1. Query relay for the current Service Record
        events = self.relay.query(pubkey, 30059, service_id)
        if not events:
            return None

        # 2. Verify signature and expiry
        service_event = events[0]
        if not service_event.verify():
            return None

        service_tags = {tag[0]: tag[1] for tag in service_event.tags}
        exp = service_tags.get("exp")
        if exp and int(exp) < int(time.time()):
            return None

        # 3. Fetch Certificate Attestations referencing that record
        attestations = self.relay.query(kind=30060)
        valid_attestations = []

        for att in attestations:
            att_tags = {tag[0]: tag[1] for tag in att.tags}
            # 4. Filter attestations by trusted certifier pubkeys and validity
            if (att_tags.get("e") == service_event.id and
                    att.pubkey in self.trusted_ca_pubkeys):

                if self._is_attestation_valid(att, att_tags):
                    valid_attestations.append(att_tags)

        # 5. Apply local policy requirements
        if require_attestation and not valid_attestations:
            print(f"Policy Failure: No trusted attestations for {service_id}")
            return None

        return {
            "endpoint": service_tags.get("u"),
            "fingerprint": service_tags.get("k"),
            "attestations": valid_attestations,
            "event_id": service_event.id
        }

    def _is_attestation_valid(self, event, tags) -> bool:
        now = int(time.time())

        # Check signatures
        if not event.verify():
            return False

        # Check nbf (not before) and exp (expiry)
        if "nbf" in tags and int(tags["nbf"]) > now:
            return False
        if "exp" in tags and int(tags["exp"]) < now:
            return False

        # Check for Revocations (Kind 30061)
        revocations = self.relay.query(kind=30061)
        for rev in revocations:
            rev_tags = {tag[0]: tag[1] for tag in rev.tags}
            if rev_tags.get("e") == event.id and rev.pubkey == event.pubkey:
                print(f"Attestation {event.id[:8]} revoked by CA")
                return False

        return True

    def verify_endpoint(self,
                        resolved_service: Dict,
                        actual_fingerprint: str) -> bool:
        return resolved_service["fingerprint"] == actual_fingerprint
