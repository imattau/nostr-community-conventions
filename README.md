# Nostr Community Conventions

This repository hosts **Nostr Community Conventions (NCCs)** — documented shared usage patterns for existing Nostr primitives, published, discovered, and revised using Nostr itself (see NCC-00 below).

**[Browse the docs site](https://imattau.github.io/nostr-community-conventions/)**

## Repository Layout

Each convention lives in its own subfolder with its own README, code, and history:

- [`ncc-00/`](ncc-00/) — Publishing Nostr Community Conventions on Nostr (the meta-convention defining how NCCs work)
- [`ncc-02/`](ncc-02/) — Pubkey-Owned Service Discovery and Trust
- [`ncc-03/`](ncc-03/) — Election and Voting Convention
- [`ncc-05/`](ncc-05/) — Identity-Bound Service Locator Resolution
- [`ncc-06/`](ncc-06/) — NCC-02/NCC-05 Service Profile
- [`ncc-07/`](ncc-07/) — Service Capability Manifest
- [`ncc-08/`](ncc-08/) — Service Identity Rotation and Handover
- [`ncc-09/`](ncc-09/) — Scoped Operator Authority
- [`ncc-10/`](ncc-10/) — Service Operational State

`ncc-manager/` and `ncc-viewer/` are supporting tooling for authoring and browsing NCCs; `ncc_publish.py` is the CLI publisher referenced throughout NCC-00.

For the full NCC-00 specification — purpose, scope, event kinds, tags, and governance model — see [`ncc-00/README.md`](ncc-00/README.md).

## Docs Site

Every convention's README is also published as a browsable page at **[imattau.github.io/nostr-community-conventions](https://imattau.github.io/nostr-community-conventions/)**, built by [`.github/workflows/pages.yml`](.github/workflows/pages.yml) and [`site/build.mjs`](site/build.mjs).

**Adding a new NCC updates the site automatically** — no workflow changes needed. The build script discovers any top-level `ncc-<number>/` folder that contains a `README.md` and generates its doc page on the next push to `master`. To publish NCC-07, for example, just add `ncc-07/README.md` (following the pattern of the existing folders) and push.
