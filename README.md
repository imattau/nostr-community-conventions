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
- [`ncc-11/`](ncc-11/) — Portable Trust Policy
- [`ncc-13/`](ncc-13/) — Software Package Release Profile
- [`ncc-14/`](ncc-14/) — Application Composition and Service Binding

`ncc-manager/` and `ncc-viewer/` are supporting tooling for authoring and browsing NCCs; `ncc_publish.py` is the interactive CLI publisher referenced throughout NCC-00. The GitHub Actions workflow publishes conventions with `nscript ncc`, using the `ncc.json` metadata beside each README.

## Publishing NCCs to Nostr

Each convention has an `ncc.json` beside its `README.md`:

```json
{
  "title": "Pubkey-Owned Service Discovery and Trust",
  "summary": "A Nostr-native mechanism for discovering and verifying pubkey-owned services.",
  "status": "published",
  "topics": ["nostr", "service-discovery", "trust"],
  "lang": "en",
  "license": "CC0-1.0",
  "authors": ["npub1..."]
}
```

`README.md` is published as the exact event content. `ncc.json` supplies the `title`, `status`, and optional metadata; the convention identifier (`d`) comes from the directory name.

The `.github/workflows/ncc-publish.yml` workflow publishes kind `30050` events with [`nscript`](https://github.com/imattau/nscript):

- pushing a tag such as `ncc-02-v0.6.0` publishes `ncc-02` with that version;
- `workflow_dispatch` can publish one convention or all of them, with an optional dry run;
- `.github/workflows/ncc-check.yml` validates every `ncc.json` and README on pull requests;
- the signing key comes from the `NCC_PUBLISH_NSEC` secret, falling back to `NGIT_NSEC`.

Local preview:

```sh
nscript ncc check --all
nscript ncc publish --all --include-drafts --dry-run
```

See the [nscript NCC guide](https://github.com/imattau/nscript/blob/main/docs/NCC.md) for the full metadata schema and command reference.

For the full NCC-00 specification — purpose, scope, event kinds, tags, and governance model — see [`ncc-00/README.md`](ncc-00/README.md).

## Docs Site

Every convention's README is also published as a browsable page at **[imattau.github.io/nostr-community-conventions](https://imattau.github.io/nostr-community-conventions/)**, built by [`.github/workflows/pages.yml`](.github/workflows/pages.yml) and [`site/build.mjs`](site/build.mjs).

**Adding a new NCC updates the site automatically** — no workflow changes needed. The build script discovers any top-level `ncc-<number>/` folder that contains a `README.md` and generates its doc page on the next push to `master`. Add the new convention's folder and `README.md` (following the pattern of the existing folders) and push.

## npm Releases

The [`npm-publish.yml`](.github/workflows/npm-publish.yml) workflow publishes a package when its version tag is pushed. First update the package version in `package.json` (and its lockfile, if present), commit the change, then tag that commit using `npm-<package-slug>-v<version>`. For example:

```sh
git tag npm-ncc-02-js-v0.6.0
git push origin npm-ncc-02-js-v0.6.0
```

The workflow verifies the package name and version, installs dependencies, runs available build and test scripts, then publishes to npm using trusted publishing (OIDC). No npm token is stored in GitHub. In each package's npm settings, configure a GitHub Actions trusted publisher with organization/user `imattau`, repository `nostr-community-conventions`, and workflow filename `npm-publish.yml`; allow direct publishing. The package's `repository` field must point to this repository. npm generates provenance automatically for trusted publishes. Supported package slugs are `ncc-02-js`, `nostr-election-36998`, `ncc-05-js`, `ncc-06-js`, `ncc-sidecar`, `ncc-07-js`, `ncc-08-js`, `ncc-09-js`, `ncc-10-js`, `ncc-11-js`, `ncc-13-js`, and `ncc-manager` (the latter publishes as `@0xx0lostcause0xx0/ncc-manager`).

Packages that gitignore `package-lock.json` are installed with `npm install`; the others use `npm ci`. To retry a release without moving its tag — for example after configuring a trusted publisher for a brand-new package — run the workflow from the tag ref:

```sh
gh workflow run npm-publish.yml --ref npm-ncc-07-js-v0.1.0 -f release_tag=npm-ncc-07-js-v0.1.0
```

## ngit Sync

`.github/workflows/ngit-sync.yml` pushes `master` and tags to the [ngit repository](https://gitworkshop.dev/npub1khf5amw8mrupe649a5mhkk3d2d8wjj06urz6kwawpftk4f68tjlstdmd3q/relay.ngit.dev/nostr-community-conventions/tree/master) after GitHub pushes. Configure this repository secret first:

- Secret `NGIT_NSEC`: the Nostr private key for the mirror's publisher identity, authorized to publish to that repository.

The workflow does not run for pull requests. Keep GitHub and ngit from accepting independent changes: this workflow is a one-way GitHub-to-ngit push, and divergent histories need manual reconciliation. The ngit repository must already exist and recognize the signer as a maintainer.
