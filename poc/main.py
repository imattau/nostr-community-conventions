from pynostr.key import PrivateKey
from poc.mock_relay import MockRelay
from poc.publisher import ServicePublisher, CertificateAuthority
from poc.resolver import ServiceResolver


def run_poc():
    print("--- NCC-02 Full Specification PoC ---")
    relay = MockRelay()

    # 1. Setup Identities
    owner_sk = PrivateKey()
    owner_pk = owner_sk.public_key.hex()

    ca_sk = PrivateKey()
    ca_pk = ca_sk.public_key.hex()

    # 2. Service Owner publishes record
    publisher = ServicePublisher(owner_sk.hex(), relay)
    service_id = "vault"
    endpoint = "https://vault.internal"
    fingerprint = "fp_12345"

    print(f"Owner ({owner_pk[:8]}) publishing service '{service_id}'...")
    service_event = publisher.publish_service_record(
        service_id, endpoint, fingerprint
    )

    # 3. CA issues an Attestation
    ca = CertificateAuthority(ca_sk.hex(), relay)
    print(f"CA ({ca_pk[:8]}) issuing attestation for service...")
    att_event = ca.issue_attestation(owner_pk, service_id, service_event.id)

    # 4. Client Resolves (with Trust Policy)
    print("\n[Client Resolution - Success Case]")
    # Client trusts this specific CA
    resolver = ServiceResolver(relay, trusted_ca_pubkeys=[ca_pk])

    # Resolving with mandatory attestation
    resolved = resolver.resolve(owner_pk, service_id, require_attestation=True)
    if resolved:
        print(f"SUCCESS: Resolved {resolved['endpoint']} "
              f"with {len(resolved['attestations'])} trusted attestation(s).")

    # 5. Demonstrate Revocation
    print("\n[Client Resolution - Revocation Case]")
    print(f"CA revoking attestation {att_event.id[:8]}...")
    ca.revoke_attestation(att_event.id, reason="Security audit failed")

    resolved_after_rev = resolver.resolve(
        owner_pk, service_id, require_attestation=True
    )
    if not resolved_after_rev:
        print("SUCCESS: Resolver correctly rejected revoked attestation.")

    # 6. Demonstrate Trust Policy (Untrusted CA)
    print("\n[Client Resolution - Untrusted CA Case]")
    stranger_sk = PrivateKey()
    stranger_ca = CertificateAuthority(stranger_sk.hex(), relay)
    stranger_ca.issue_attestation(
        owner_pk, service_id, service_event.id
    )

    # Resolver still only trusts ca_pk
    resolved_stranger = resolver.resolve(
        owner_pk, service_id, require_attestation=True
    )
    if not resolved_stranger:
        print("SUCCESS: Resolver rejected attestation from unknown CA.")


if __name__ == "__main__":
    run_poc()
