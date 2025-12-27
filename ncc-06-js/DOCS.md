# ncc-06-js API Reference

This document outlines the public helpers exported by `ncc-06-js`, grouped by capability.

## NCC-02 helpers

- `buildNcc02ServiceRecord(options)` – builds a signed kind `30059` event, ensuring `d`, `u`, `k`, and `exp` tags.
- `parseNcc02Tags(event)` – flattens tags for easy lookup.
- `validateNcc02(event, { expectedAuthor?, expectedD?, now?, allowExpired? })` – verifies signature, author, `d`, and expiration.

## NCC-05 helpers

- `buildLocatorPayload({ endpoints?, ttl?, updatedAt? })` – normalizes endpoints and returns `{ ttl, updated_at, endpoints }`.
- `parseLocatorPayload(content)` – safely parses JSON from the event content.
- `validateLocatorFreshness(payload, { now?, allowStale? })` – checks TTL/`updated_at`.
- `normalizeLocatorEndpoints(endpoints)` – normalizes protocol/family/priority/k metadata.

## NCC-06 helpers

- `choosePreferredEndpoint(endpoints, { torPreferred?, expectedK? })` – picks the best endpoint, validates `k` for `wss://`, and returns `{ endpoint?, reason?, expected?, actual? }`.
- `resolveServiceEndpoint(options)` – orchestrates NCC-06 resolution using bootstrap relays, the NCC-05 resolver, and NCC-02 fallbacks; returns `{ endpoint, source, selection, serviceEvent, locatorPayload }`.

## Key and TLS helpers

- `generateKeypair()` – returns `{ pk, sk }` using `nostr-tools`.
- `toNpub(pk)`, `fromNsec(nsec)` etc. – nostr key transformations.
- `ensureSelfSignedCert(options)` – builds cert/key for TLS endpoints.
- `generateExpectedK({ prefix?, label?, suffix? })` – builds a placeholder `TESTKEY:` fingerprint; `validateExpectedKFormat(k)` validates the format.
- `computeKFromCertPem(pem)` – derives base64url SHA-256 of the cert’s SPKI.
- `getExpectedK(cfg, { baseDir? })` – inspects config to return the `k` string for static/generate/tls modes.

## Endpoint helpers

- `buildExternalEndpoints({ ipv4?, ipv6?, tor?, wsPort?, wssPort?, ncc02ExpectedKey?, ensureOnionService?, publicIpv4Sources? })` – builds ordered endpoint list (with `k` for `wss://`).
- `detectGlobalIPv6()` – picks the first non-private IPv6 interface.
- `getPublicIPv4({ sources? })` – probes HTTP services for the external IPv4 address.

## Scheduling helpers

- `scheduleWithJitter(baseMs, jitterRatio = 0.15)` – returns a non-negative delay ≤ `baseMs`; jitter is ±`jitterRatio * baseMs`.

## Light Nostr helpers

- `parseNostrMessage(messageString)` – JSON parse guard for Nostr transports.
- `serializeNostrMessage(messageArray)` – stringifies messages.
- `createReqMessage(subId, ...filters)` – helper for REQ frames.

## Usage

Import from `'ncc-06-js'` and consume the helpers that match your workflow. The library maintains a small dependency surface so you can plug the resolver, endpoint builder, PIN helper, and scheduler into custom sidecars or SDKs without reimplementing NCC-06 semantics.
