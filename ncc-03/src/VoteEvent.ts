import { ElectionDefinition } from './ElectionDefinition';
import { ELECTION_KIND, NostrEvent, Tag } from './types';

export interface VoteEventParams {
  pubkey: string;
  electionId: string;
  choice: string;
  createdAt?: number;
  referenceEventId?: string;
  content?: string;
  tags?: Tag[];
}

export class VoteEvent {
  public readonly pubkey: string;
  public readonly electionId: string;
  public readonly choice: string;
  public readonly createdAt: number;
  public readonly referenceEventId?: string;
  private readonly content?: string;
  private readonly extraTags: Tag[];

  constructor(params: VoteEventParams) {
    if (!params.choice) {
      throw new Error('Vote choice must be provided.');
    }
    if (!params.electionId) {
      throw new Error('Vote must reference an election identifier (d tag).');
    }

    this.pubkey = params.pubkey;
    this.electionId = params.electionId;
    this.choice = params.choice;
    this.createdAt = params.createdAt ?? Math.floor(Date.now() / 1000);
    this.referenceEventId = params.referenceEventId;
    this.content = params.content ?? '';
    this.extraTags = params.tags ?? [];
  }

  public toEvent(overrides: Partial<Omit<NostrEvent, 'kind'>> = {}): NostrEvent {
    const coreTags: Tag[] = [
      ['e', this.referenceEventId ?? ''],
      ['d', this.electionId],
      ['choice', this.choice],
    ];
    const filteredCore = (coreTags.filter((tag) => tag[1] !== undefined && tag[1] !== '') ?? []) as Tag[];
    const tags: Tag[] = [...filteredCore, ...this.extraTags];

    return {
      kind: ELECTION_KIND,
      id: overrides.id ?? '',
      pubkey: overrides.pubkey ?? this.pubkey,
      created_at: overrides.created_at ?? this.createdAt,
      tags: overrides.tags ?? tags,
      content: overrides.content ?? this.content ?? '',
      sig: overrides.sig,
    };
  }

  public static fromEvent(event: NostrEvent): VoteEvent {
    if (event.kind !== ELECTION_KIND) {
      throw new Error('Event is not kind 36998.');
    }
    const electionTag = VoteEvent.findTag(event.tags, 'd');
    const choiceTag = VoteEvent.findTag(event.tags, 'choice');

    if (!electionTag || electionTag.length < 2) {
      throw new Error('Vote event must contain election identifier (d tag).');
    }
    if (!choiceTag || choiceTag.length < 2) {
      throw new Error('Vote event must contain a choice tag.');
    }

    const referenceTag = VoteEvent.findTag(event.tags, 'e');

    return new VoteEvent({
      pubkey: event.pubkey,
      electionId: electionTag[1],
      choice: choiceTag[1],
      createdAt: event.created_at,
      referenceEventId: referenceTag && referenceTag.length > 1 ? referenceTag[1] : undefined,
      content: event.content,
      tags: event.tags.filter((tag) => !['d', 'choice', 'e'].includes(tag[0])),
    });
  }

  public matchesElection(definition: ElectionDefinition): boolean {
    return this.electionId === definition.identifier;
  }

  public isInWindow(definition: ElectionDefinition): boolean {
    if (definition.startsAt && this.createdAt < definition.startsAt) {
      return false;
    }
    return this.createdAt < definition.endsAt;
  }

  public isOption(definition: ElectionDefinition): boolean {
    return definition.isOption(this.choice);
  }

  private static findTag(tags: Tag[], name: string): Tag | undefined {
    return tags.find((tag) => tag[0] === name);
  }
}
