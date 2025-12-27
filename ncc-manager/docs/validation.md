# NCC Chain Validation

The NCC Manager implements a deterministic validation logic to resolve the "authoritative" state of a community convention from a set of potentially conflicting Nostr events.

## Concepts

- **Chain**: A series of Kind 30050 documents linked by `supersedes` tags.
- **Root**: A document that does not supersede any other valid hex event ID.
- **Steward**: The pubkey authorized to publish revisions or transfer stewardship. The initial steward is the author of the root document.
- **NSR (Succession Record)**: A Kind 30051 event used to explicitly point to an authoritative revision or a new steward.

## Validation Process

The validator (`src/services/chain_validator.js`) follows these steps:

1. **Filtering**: Collects all Kind 30050 and 30051 events matching the target `d` tag. Events with invalid signatures are discarded.
2. **Root Identification**: Finds the "root" document. If multiple roots exist, it tie-breaks using status (published first), then timestamp, then event ID.
3. **Stewardship Tracking**: Follows "succession" type NSRs signed by the current steward to track who currently owns the convention.
4. **Authority Resolution**:
    - **NSR Priority**: If valid "revision" type NSRs exist (signed by the authorized steward), the one with the latest `effective_at` timestamp determines the authoritative document.
    - **Fallback (Implicit Chain)**: If no NSRs exist, the validator finds the "tips" of the chain (documents that are not superseded by any other authorized document). If exactly one tip exists, it is considered authoritative.
5. **Fork Detection**: Identifies points where a document has multiple successors and flags non-authoritative tips as "forks".

## Warnings

The validator issues warnings for various conditions, including:
- Missing root documents.
- Multiple competing chain tips.
- Documents superseded by unauthorized authors.
- Self-superseding documents.
- Signature verification failures.
- NSRs pointing to unknown or invalid documents.
