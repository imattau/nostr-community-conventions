# NCC-06 Relay/Sidecar/Client Notes

## Purpose

- This project is a minimal NCC-06 realization built entirely in Node.js: the relay, sidecar publisher, and resolver/test harness are all JavaScript modules.
- The relay remains protocol-dumb (EVENT/REQ/CLOSE/EOSE) while `lib/relay.js` and `scripts/run-relay.js` expose a Node-based service that stores events and services NCC-02/NCC-05 filters.
- The sidecar maintains the relay identity and publishes NCC-02/NCC-05 (and optional attestations/revocations) using `ncc-02-js`/`nostr-tools`.
- `ncc06-sidecar/` hosts the publisher, and `ncc06-client/` remains the deterministic resolver that exercises NCC-06 resolution without moving trust into the relay.

## Key Learnings

1. **Identity references are not endpoints.**  
   - `wss://<npub>` is only a mnemonic identity reference. Clients must resolve NCC-02 (service record) to learn the fallback `u` and NCC-05 locators to discover the freshest `wss` endpoint; the relay itself never uses `wss://<npub>` as a listening URI.

2. **Sidecars own the service identity and metadata.**  
   - Store the service keypair (`serviceSk/servicePk/serviceNpub`) in sidecar config and reuse it to sign NCC-02/05 events.  
   - Publish NCC-02 with `d`, `u`, `k`, `exp`; keep the `k` placeholder consistent until you switch to real TLS fingerprints later.  
   - Publish NCC-05 with `ttl`, `updated_at`, and a prioritized endpoint list, giving `wss` entries higher priority but leaving fallback `ws`/onion entries for robustness.

3. **Relay needs both WS and WSS interfaces for tests.**  
   - A plain `ws://127.0.0.1:7000` suffices for discovery/filter testing, but `wss://127.0.0.1:7447` is necessary to exercise the `k` pinning workflow.  
   - TLS certificates are just opaque keys—locally generated for encryption, optionally bearing a SAN for 127.0.0.1—and their fingerprints are verified through NCC-02 `k`, not Web PKI.

4. **Client resolution path is deterministic.**  
  - Decode the npub from `serviceIdentityUri`, fetch NCC-02 + NCC-05 via REQ, verify `k` tags for `wss`, treat NCC-05 TTL/updated timestamps as authoritative, and fall back to NCC-02 when either NCC-05 is expired or no acceptable endpoint exists.  
  - Reject NCC-02 fallbacks whose `k` values still mismatch, then stop instead of attempting another endpoint.
  - NCC-05 trust is derived from the event signature: the resolver filters out any locator events whose `verifyEvent` fails or whose `pubkey` doesn’t match the service identity before using the payload, meaning a relay can’t spoof endpoints without compromising the service key. Keep the verification path intact whenever `ncc-05` is updated so this trust anchor is preserved and the client remains resilient to relay divergence.

5. **Developer visibility matters.**  
   - Logging should highlight when NCC-05 is used vs. fallback, why endpoints were rejected, and when `EOSE` completes.  
   - Tests rely on predictable output strings; keep them stable so assertions remain valid.
6. **Publication relays and stale fallback matter.**  
   - `publicationRelays` enable the sidecar/client to push and fetch records from multiple relays so the resolver can handle conflict/availability issues without relying on any single endpoint.  
   - The client caches NCC-02/NCC-05 candidates with sufficient metadata so stale fallback can be activated when every fresh record is unreachable, while still surfacing that stale data was used.

## Tips

- Use `ncc-02-js`/`ncc-05` libraries directly in tests to cover builder/resolver expectations (TTL, gossip, multi-recipient wraps, policy violations).  
- `ncc-06-js` now hosts the selector helpers (`normalizeLocatorEndpoints`, `choosePreferredEndpoint`) plus the resolver orchestration, so reuse those exports instead of managing the logic inline. The example installs the package via a `file:` dependency and the client/test suite import the shared helpers directly.
- The new `ncc06-sidecar/external-endpoints.js` helpers centralize how NCC-05 endpoints are declared (operator-only onion, IPv6, IPv4 settings) and keep the locator payload deterministic instead of probing for reachability.
- The sidecar now exposes a `k` config block (mode/certPath/value/persistPath) so TLS SPKI pinning can be the default `wss://` fingerprint; the helper functions compute the `ncc02ExpectedKey` for both NCC-02 and NCC-05 in lockstep.
- Set `NCC06_SIDE_CAR_MODE=daemon` and optionally `jitterRatio` to have the sidecar republish NCC-05 every TTL and refresh NCC-02 before expiry using bounded jitter via `scheduleWithJitter` (library helper).
- When generating TLS certs for local WSS, include `127.0.0.1` in the SAN so the handshake succeeds; the client connects with `rejectUnauthorized=false` because endpoint trust is established through NCC-02 `k`, not the certificate chain.
- Reset configs between integration tests (sidecar/client) to avoid leakage across cases that deliberately mutate TTLs or `k` values.
- The integration suite now runs two resolver instances in parallel and exercises group-wrapped NCC-05 locators, so log outputs that mention the new endpoints help debug concurrency or gossip failures.
- Use `config.json`'s `relayBindHost`/`relayWssBindHost` when the environment disallows binding directly on `relayHost`, so the relay can listen on `0.0.0.0` while clients still reach it via the loopback URI.
- If Tor control is enabled, the sidecar now creates a v3 onion service for the relay port, caches the key material (so the address survives restarts), and publishes `ws://<onion>.onion` in NCC-05 locators (no `k` tag is needed for those entries). The relay remains unaware of Tor.
- Run `npm run clean-configs` whenever you update TLS material or flip `NCC06_NCC02_KEY_SOURCE=cert`; that script removes and regenerates the deterministic sidecar/client configs.
- Wrap `ncc06-sidecar/config-manager.js`’s `updateConfig` when exposing a dashboard or admin API so you can mutate generated settings without losing embedded secrets, then rerun `npm run sidecar:publish` to push the refreshed NCC-02/NCC-05 material.

## Pitfalls

- **Confusing identity URIs with endpoints** – running the client directly against `wss://<npub>` will fail. Always resolve first, then connect to resolved `wss`/`ws`.  
- **TLS quick hacks** – bypassing certificate verification (`rejectUnauthorized=false`) is intentional because trust is asserted via NCC-02 `k` fingerprints, not CAs. Always still include the relevant SAN/IP so the TLS handshake succeeds for encryption.
- **`k` mismatch handling** – once the client rejects a `wss` endpoint due to `k`, it should also reject the NCC-02 fallback if the `k` still doesn’t match. Otherwise, you risk connecting to a TLS endpoint you meant to distrust.
- **Test fragility from logging changes** – the integration suite asserts against specific strings (i.e., “Fresh NCC-05 locator found.”). If you refactor logging, keep the key phrases intact or update the tests accordingly.

## Next Steps

- Swap the placeholder `k` value with a real SPKI fingerprint once you have an expected endpoint key, and update the sidecar/client configs respectively.  
- Consider adding optional attestation/revocation policies in the client by wiring `ncc-02-js` resolver trust options, so the simple harness can highlight policy decisions under NCC-06.  
- Document any environment-specific commands (tests require `sandbox_permissions=require_escalated` because the suite spins up WebSocket servers).  
