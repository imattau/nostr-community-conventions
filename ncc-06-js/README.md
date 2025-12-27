# ncc-06-js

Reusable helpers extracted from the NCC-06 example relay, sidecar, and client implementations. This package focuses on the core utilities that compose NCC-02, NCC-05, and NCC-06 resolution and trust semantics without bundling a relay, sidecar, or heavy client.

## Key features

- Build, parse, and validate NCC-02 service records (`buildNcc02ServiceRecord`, `validateNcc02`, `parseNcc02Tags`)
- Build, normalize, and refresh NCC-05 locator payloads (`buildLocatorPayload`, `normalizeLocatorEndpoints`, `validateLocatorFreshness`)
- Deterministic endpoint selection (`choosePreferredEndpoint`) and NCC-06 resolution orchestration (`resolveServiceEndpoint`)
- Utility helpers for TLS material generation (`ensureSelfSignedCert`), keypair management (`generateKeypair`, `toNpub`, `fromNsec`, etc.), and `k` token creation/validation
- Minimal Nostr framing helpers (`parseNostrMessage`, `serializeNostrMessage`, `createReqMessage`)

## Usage

Install directly from the repository (example workspace):

```bash
npm install ../ncc-06-js
```

Then import the pieces you need:

```js
import { resolveServiceEndpoint, generateExpectedK } from 'ncc-06-js';
```

The package exposes modular helpers so you can keep using your own transport stack while reusing the deterministic NCC-06 behaviour.

## Testing

```
npm test
```

The tests focus on the helper modules (NCC-02/NCC-05 builders, selector logic) and ensure the key resolution pathway behaves as expected when provided stubbed data.
