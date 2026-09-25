# Nostr Community Conventions

This repository hosts **Nostr Community Conventions (NCCs)** — documented shared usage patterns for existing Nostr primitives, published, discovered, and revised using Nostr itself (see NCC-00 below).

## Repository Layout

Each convention lives in its own subfolder with its own README, code, and history:

- [`ncc-00/`](ncc-00/) — Publishing Nostr Community Conventions on Nostr (the meta-convention defining how NCCs work)
- [`ncc-02/`](ncc-02/) — Pubkey-Owned Service Discovery and Trust
- [`ncc-03/`](ncc-03/) — Election and Voting Convention
- [`ncc-05/`](ncc-05/) — Identity-Bound Service Locator Resolution
- [`ncc-06/`](ncc-06/) — NCC-02/NCC-05 Service Profile

`ncc-manager/` and `ncc-viewer/` are supporting tooling for authoring and browsing NCCs; `ncc_publish.py` is the CLI publisher referenced throughout NCC-00.

For the full NCC-00 specification — purpose, scope, event kinds, tags, and governance model — see [`ncc-00/README.md`](ncc-00/README.md).
