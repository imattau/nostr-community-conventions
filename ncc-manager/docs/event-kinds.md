# Nostr Event Kinds

The NCC Manager operates on several custom Nostr event kinds, following the standards established for Nostr Community Conventions.

## Kind 30050: NCC Document

Represents the core convention document. It is a **replaceable event** (parameterized by the `d` tag).

| Tag | Purpose |
|-----|---------|
| `d` | The unique identifier for the convention (e.g., `ncc-01`). |
| `title` | Human-readable title of the convention. |
| `version` | Semantic version or revision number. |
| `status` | Current status: `draft`, `published`, or `withdrawn`. |
| `published_at` | Timestamp of publication. |
| `summary` | A brief description of the convention. |
| `t` | Topics/Tags associated with the convention. |
| `supersedes` | ID of a previous Kind 30050 event that this one replaces. |
| `authors` | List of pubkeys who co-authored the document. |

## Kind 30051: NSR (Nostr Succession Record)

Used to manage the evolution and stewardship of a convention.

| Tag | Purpose |
|-----|---------|
| `d` | Matches the `d` tag of the NCC it refers to. |
| `type` | `revision` (default) or `succession` (stewardship change). |
| `authoritative` | The event ID of the Kind 30050 that is now canonical. |
| `steward` | The pubkey of the current authorized steward. |
| `previous` | The event ID of the previous authoritative record. |
| `reason` | Human-readable reason for the change. |
| `effective_at` | Timestamp when this record becomes active. |

## Kind 30052: Endorsement

Allows individuals or entities to signal support or implementation of an NCC.

| Tag | Purpose |
|-----|---------|
| `d` | Matches the `d` tag of the NCC. |
| `endorses` | The event ID (Kind 30050) being endorsed. |
| `role` | The role of the endorser (e.g., `author`, `implementer`, `user`). |
| `implementation` | Optional link or name of the implementation. |
| `note` | Brief rationale or comment. |

## Kind 30053: Supporting Document

Auxiliary documentation, guides, or appendices related to an NCC.

| Tag | Purpose |
|-----|---------|
| `d` | Unique identifier for the supporting doc. |
| `for` | The `d` tag of the target NCC. |
| `for_event` | Optional event ID of a specific NCC revision. |
| `type` | Type of document (e.g., `guide`, `faq`, `appendix`). |
| `title` | Title of the document. |
