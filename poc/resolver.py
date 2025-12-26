import time
from typing import Optional, Dict, List
try:
    from .mock_relay import MockRelay
except ImportError:
    from mock_relay import MockRelay


class NCC02Error(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class ServiceResolver:
    def __init__(self, relay: MockRelay, trusted_ca_pubkeys: Optional[List[str]] = None):
        self.relay = relay
        self.trusted_ca_pubkeys = trusted_ca_pubkeys or []

    def resolve(self,
                pubkey: str,
                service_id: str,
                require_attestation: bool = False,
                min_level: Optional[str] = None,
                standard: str = "nostr-service-trust-v0.1") -> Dict:
        # 1. Query relay for the current Service Record
        events = self.relay.query(pubkey, 30059, service_id)
        if not events:
            raise NCC02Error("NOT_FOUND", f"No record for {service_id}")

        # 2. Verify signature and expiry
        # Stable tie-breaking: Sort by created_at DESC, then ID ASC
        service_event = sorted(
            events,
            key=lambda e: (-e.created_at, e.id)
        )[0]

        if not service_event.verify():
            raise NCC02Error("INVALID_SIGNATURE", "Service record invalid")

        service_tags = {tag[0]: tag[1] for tag in service_event.tags}
        
        # u, k, and exp are required
        if not all(k in service_tags for k in ["u", "k", "exp"]):
            raise NCC02Error("MALFORMED_RECORD", "Missing required tags")

        exp = service_tags.get("exp")
        if exp and int(exp) < int(time.time()):
            raise NCC02Error("EXPIRED", "Service record expired")

        # 3. Fetch and Cross-Validate Attestations
        attestations = self.relay.query(kind=30060)
        revocations = self.relay.query(kind=30061)
        valid_attestations = []

        for att in attestations:
            if att.pubkey in self.trusted_ca_pubkeys:
                att_tags = {tag[0]: tag[1] for tag in att.tags}

                # Refinement: Cross-validate subj, srv, and std
                if att_tags.get("subj") != pubkey:
                    continue
                if att_tags.get("srv") != service_id:
                    continue
                if standard and att_tags.get("std") != standard:
                    continue

                # Refinement: Trust Level Filtering
                if min_level and not self._is_level_sufficient(
                    att_tags.get("lvl"), min_level
                ):
                    continue

                if self._is_attestation_valid(att, att_tags, revocations):
                    valid_attestations.append(att_tags)

        # 5. Apply local policy requirements
        if require_attestation and not valid_attestations:
            raise NCC02Error("POLICY_FAILURE", "No trusted attestations found")

        return {
            "endpoint": service_tags.get("u"),
            "fingerprint": service_tags.get("k"),
            "attestations": valid_attestations,
            "event_id": service_event.id
        }

    def _is_level_sufficient(self, actual: Optional[str],
                             required: str) -> bool:
        levels = {"self": 0, "verified": 1, "hardened": 2}
        return levels.get(actual or "", -1) >= levels.get(required, 0)

    def _is_attestation_valid(self, event, tags, revocations) -> bool:
        now = int(time.time())
        if not event.verify():
            return False
        if "nbf" in tags and int(tags["nbf"]) > now:
            return False
        if "exp" in tags and int(tags["exp"]) < now:
            return False

        for rev in revocations:
            rev_tags = {tag[0]: tag[1] for tag in rev.tags}
            if rev_tags.get("e") == event.id and rev.pubkey == event.pubkey:
                # Security Fix: MUST verify revocation signature
                if rev.verify():
                    return False
        return True

    def verify_endpoint(self, resolved_service: Dict,
                        actual_fingerprint: str) -> bool:
        return resolved_service["fingerprint"] == actual_fingerprint