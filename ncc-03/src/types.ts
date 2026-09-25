export const ELECTION_KIND = 36998;
export const VOTE_KIND = 1071;
export const ELECTORAL_ROLL_KIND = 36997;
export const ELECTION_AUDIT_KIND = 36999;

export type Tag = [string, ...string[]];

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: Tag[];
  content: string;
  sig?: string;
}

export interface ElectionOption {
  /** IEC-style identifier for the option, used in `choice` tags. */
  id: string;
  /** Human label for the option. */
  label: string;
  /** Optional longer explanation. */
  description?: string;
  /** Arbitrary metadata to carry in the option tag. */
  metadata?: Record<string, string>;
}

export interface VoteTally {
  /** Count per option identifier. */
  counts: Record<string, number>;
  /** Total number of included votes. */
  total: number;
  /** All options that contributed to the tally. */
  choices: string[];
}
