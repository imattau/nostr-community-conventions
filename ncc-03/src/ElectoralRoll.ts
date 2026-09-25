import { ELECTORAL_ROLL_KIND, NostrEvent, Tag } from './types';
import { hashPayload } from './crypto';

export interface ElectoralRollParams {
  pubkey: string;
  npubs?: string[];
  createdAt?: number;
  identifier?: string;
  note?: string;
  tags?: Tag[];
}

export class ElectoralRoll {
  public readonly pubkey: string;
  public readonly createdAt: number;
  public readonly identifier: string;
  private readonly note?: string;
  private readonly extraTags: Tag[];
  private readonly npubs: Set<string>;

  constructor(params: ElectoralRollParams) {
    if (!params.pubkey) {
      throw new Error('Electoral roll needs an author pubkey.');
    }

    this.pubkey = params.pubkey;
    this.createdAt = params.createdAt ?? Math.floor(Date.now() / 1000);
    this.identifier = params.identifier ?? ElectoralRoll.makeIdentifier(this.pubkey, this.createdAt);
    this.note = params.note;
    this.extraTags = params.tags ?? [];
    this.npubs = new Set((params.npubs ?? []).map((npub) => npub.trim()).filter(Boolean));

    if (this.npubs.size === 0) {
      throw new Error('Electoral roll must start with at least one eligible npub.');
    }
  }

  public add(npub: string): boolean {
    if (!npub?.trim()) {
      return false;
    }
    const normalized = npub.trim();
    const wasPresent = this.npubs.has(normalized);
    this.npubs.add(normalized);
    return !wasPresent;
  }

  public remove(npub: string): boolean {
    if (!npub?.trim()) {
      return false;
    }
    return this.npubs.delete(npub.trim());
  }

  public isEligible(npub: string): boolean {
    if (!npub) {
      return false;
    }
    return this.npubs.has(npub.trim());
  }

  public get size(): number {
    return this.npubs.size;
  }

  public get members(): string[] {
    return Array.from(this.npubs);
  }

  public toEvent(overrides: Partial<Omit<NostrEvent, 'kind'>> = {}): NostrEvent {
    const tags: Tag[] = [['d', this.identifier]];
    for (const member of this.members) {
      tags.push(['p', member]);
    }

    if (this.note) {
      tags.push(['note', this.note]);
    }

    tags.push(...this.extraTags);

    return {
      kind: ELECTORAL_ROLL_KIND,
      id: overrides.id ?? '',
      pubkey: overrides.pubkey ?? this.pubkey,
      created_at: overrides.created_at ?? this.createdAt,
      tags: overrides.tags ?? tags,
      content: overrides.content ?? this.note ?? '',
      sig: overrides.sig,
    };
  }

  public static fromEvent(event: NostrEvent): ElectoralRoll {
    if (event.kind !== ELECTORAL_ROLL_KIND) {
      throw new Error('Event is not an electoral roll.');
    }

    const identifierTag = event.tags.find((tag) => tag[0] === 'd');
    const memberTags = event.tags.filter((tag) => tag[0] === 'p');
    const noteTag = event.tags.find((tag) => tag[0] === 'note');

    if (!identifierTag || identifierTag.length < 2) {
      throw new Error('Electoral roll event needs an identifier (d tag).');
    }

    const npubs = memberTags.map((tag) => tag[1]).filter(Boolean);

    return new ElectoralRoll({
      pubkey: event.pubkey,
      createdAt: event.created_at,
      identifier: identifierTag[1],
      note: noteTag && noteTag.length >= 2 ? noteTag[1] : undefined,
      tags: event.tags.filter((tag) => !['d', 'p', 'note'].includes(tag[0])),
      npubs,
    });
  }

  private static makeIdentifier(pubkey: string, createdAt: number): string {
    const seed = `${pubkey}:${createdAt}:roll`;
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash << 5) - hash + seed.charCodeAt(i);
      hash |= 0;
    }
    return `roll-${Math.abs(hash).toString(16)}`;
  }

  public fingerprint(): string {
    return hashPayload({
      identifier: this.identifier,
      members: this.members.sort(),
    });
  }
}
