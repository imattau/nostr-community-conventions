import { ELECTION_KIND, ElectionOption, NostrEvent, Tag } from './types';

export interface ElectionDefinitionParams {
  pubkey: string;
  options: ElectionOption[];
  endsAt: number;
  title?: string;
  description?: string;
  startsAt?: number;
  rules?: string;
  ref?: string;
  createdAt?: number;
  identifier?: string;
  tags?: Tag[];
}

export class ElectionDefinition {
  public readonly pubkey: string;
  public readonly options: ElectionOption[];
  public readonly endsAt: number;
  public readonly startsAt?: number;
  public readonly rules?: string;
  public readonly ref?: string;
  public readonly createdAt: number;
  public readonly identifier: string;
  private readonly title?: string;
  private readonly description?: string;
  private readonly tags: Tag[];

  constructor(params: ElectionDefinitionParams) {
    if (!params.options || params.options.length === 0) {
      throw new Error('At least one option is required for an election.');
    }
    if (!params.title && !params.description) {
      throw new Error('An election needs either a title or description.');
    }
    if (params.startsAt && params.startsAt >= params.endsAt) {
      throw new Error('startsAt must be earlier than endsAt.');
    }

    this.pubkey = params.pubkey;
    this.options = params.options;
    this.endsAt = params.endsAt;
    this.startsAt = params.startsAt;
    this.rules = params.rules;
    this.ref = params.ref;
    this.createdAt = params.createdAt ?? Math.floor(Date.now() / 1000);
    this.identifier = params.identifier ?? this.pubkey;
    this.title = params.title;
    this.description = params.description;
    this.tags = this.buildDefaultTags(params.tags);
  }

  public get content(): string {
    return this.description ?? this.title ?? '';
  }

  public get optionIds(): string[] {
    return this.options.map((option) => option.id);
  }

  public toEvent(overrides: Partial<Omit<NostrEvent, 'kind'>> = {}): NostrEvent {
    return {
      kind: ELECTION_KIND,
      id: overrides.id ?? '',
      pubkey: overrides.pubkey ?? this.pubkey,
      created_at: overrides.created_at ?? this.createdAt,
      tags: overrides.tags ?? this.tags,
      content: overrides.content ?? this.content,
      sig: overrides.sig,
    };
  }

  public isOption(optionId: string): boolean {
    return this.optionIds.includes(optionId);
  }

  private buildDefaultTags(extra: Tag[] = []): Tag[] {
    const tags: Tag[] = [
      ['d', this.identifier],
      ['p', this.pubkey],
    ];

    for (const option of this.options) {
      const optionTag: Tag = ['option', option.id, option.label];
      if (option.description) {
        optionTag.push(option.description);
      }
      if (option.metadata && Object.keys(option.metadata).length > 0) {
        optionTag.push(JSON.stringify(option.metadata));
      }
      tags.push(optionTag);
    }

    if (this.startsAt) {
      tags.push(['startsAt', this.startsAt.toString()]);
    }

    tags.push(['endsAt', this.endsAt.toString()]);

    if (this.rules) {
      tags.push(['rules', this.rules]);
    }

    if (this.ref) {
      tags.push(['ref', this.ref]);
    }

    for (const tag of extra) {
      tags.push(tag);
    }

    return tags;
  }

}
