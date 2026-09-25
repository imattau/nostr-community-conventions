# Toy App Notes

## Confirmed APIs

### ncc-02-js (v0.2.0)

**Exports:**
- `KINDS`: `{ SERVICE_RECORD: 30059, ATTESTATION: 30060, REVOCATION: 30061 }`
- `NCC02Builder`:
  - `createServiceRecord(...)`
  - `createAttestation(...)`
  - `createRevocation(...)`
- `NCC02Resolver`:
  - `resolve(pubkey, serviceId, ...)`
  - `verifyEndpoint(...)`
- `MockRelay`: In-memory relay for testing (used in unit tests, likely).

**Usage Strategy:**
- Use `NCC02Builder.createServiceRecord` for publishing.
- Use `NCC02Resolver.resolve` for resolution.

### ncc-05 (v1.1.4)

**Exports:**
- `NCC05Publisher`:
  - `publish(...)`
  - `publishWrapped(...)` - likely for group/gift-wrapped publishing.
  - `close()`
- `NCC05Resolver`:
  - `resolve(...)`
  - `close()`

**Usage Strategy:**
- Use `NCC05Publisher.publishWrapped` for private locator (encrypted).
- Use `NCC05Resolver.resolve` for private resolution.

## App Concept: Service Card Viewer

The app demonstrates the "Private Override" pattern:
1.  Resolve Public (NCC-02).
2.  Resolve Private (NCC-05).
3.  Merge/Override.

**Private Override Rule:**
- IF NCC-05 resolves successfully (fresh + authorized), USE IT.
- ELSE fallback to NCC-02.
