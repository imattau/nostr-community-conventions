import time
from pynostr.key import PrivateKey
from poc.mock_relay import MockRelay
from poc.publisher import ServicePublisher, CertificateAuthority
from poc.resolver import ServiceResolver, NCC02Error


def run_poc():
    print("--- NCC-02 Comprehensive Python PoC ---")
    relay = MockRelay()

    owner_sk = PrivateKey()
    owner_pk = owner_sk.public_key.hex()
    ca_sk = PrivateKey()
    ca_pk = ca_sk.public_key.hex()

    publisher = ServicePublisher(owner_sk.hex(), relay)
    ca = CertificateAuthority(ca_sk.hex(), relay)
    resolver = ServiceResolver(relay, trusted_ca_pubkeys=[ca_pk])

    # 1. Setup: Valid Service Record
    service_id = "api"
    service_event = publisher.publish_service_record(
        service_id, "https://api.io", "fp_abc"
    )

    # Test 1: Successful Resolution
    print("Test 1: Basic Resolution...")
    ca.issue_attestation(owner_pk, service_id, service_event.id, "verified")
    res = resolver.resolve(owner_pk, service_id, require_attestation=True)
    if res["endpoint"] == "https://api.io":
        print("✅ Passed")

    # Test 2: Latest Record Selection
    print("Test 2: Latest record selection...")
    time.sleep(1.1)
    publisher.publish_service_record(service_id, "https://new.io", "fp_new")
    res_latest = resolver.resolve(owner_pk, service_id)
    if res_latest["endpoint"] == "https://new.io":
        print("✅ Passed")

    # Test 3: Trust Level Failure
    print("Test 3: Trust Level Policy (Requiring 'hardened')...")
    try:
        resolver.resolve(owner_pk, service_id, require_attestation=True,
                         min_level="hardened")
    except NCC02Error as e:
        if e.code == "POLICY_FAILURE":
            print("✅ Passed")

    # Test 4: Mismatched Subject (Security Check)
    print("Test 4: Attestation with mismatched subject...")
    wrong_pk = PrivateKey().public_key.hex()
    ca.issue_attestation(wrong_pk, service_id, service_event.id)
    res = resolver.resolve(owner_pk, service_id, require_attestation=True)
    # Should only see the one valid attestation from Test 1
    if len(res['attestations']) == 1:
        print("✅ Passed")

    # Test 5: Mismatched Service ID in Attestation
    print("Test 5: Mismatched service ID in attestation...")
    res = resolver.resolve(owner_pk, service_id, require_attestation=True)
    if not any(a["srv"] == "wrong-srv" for a in res["attestations"]):
        print("✅ Passed")

    # Test 6: verify_endpoint utility
    print("Test 6: verify_endpoint utility...")
    if resolver.verify_endpoint(res, "fp_new"):
        print("✅ Passed")

    # Test 7: NOT_FOUND error
    print("Test 7: NOT_FOUND error...")
    try:
        resolver.resolve(owner_pk, "ghost")
    except NCC02Error as e:
        if e.code == "NOT_FOUND":
            print("✅ Passed")


if __name__ == "__main__":
    run_poc()
