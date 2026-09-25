import { ElectionDefinition, ElectionDefinitionParams } from './ElectionDefinition';
import { ElectoralRoll } from './ElectoralRoll';
import { Election } from './Election';
import {
  RegistrationChallenge,
  RegistrationManager,
  RegistrationOptions,
  RegistrationResult,
  RegistrationSolution,
} from './Registration';
import { VoteEvent } from './VoteEvent';
import { NostrEvent, ELECTION_AUDIT_KIND } from './types';
import {
  ElectionKeyPair,
  ElectionMode,
  createElectionKeyPair,
  createLocalSigner,
  ElectionSigner,
  hashPayload,
  verifyEventSignature,
} from './crypto';

export interface ElectionOperatorOptions {
  keyPair?: ElectionKeyPair;
  rollMembers?: string[];
  rollNote?: string;
  registrationOptions?: RegistrationOptions;
  mode?: ElectionMode;
  signer?: ElectionSigner;
}

export interface ElectionAction {
  type: 'challenge_issued' | 'registration' | 'invite_sent' | 'invite_accepted' | 'manual_add';
  pubkey: string;
  timestamp: number;
  meta?: Record<string, string>;
}

export class ElectionOperator {
  public readonly keyPair: ElectionKeyPair;
  public readonly definition: ElectionDefinition;
  public readonly roll: ElectoralRoll;
  public readonly election: Election;
  private readonly registration: RegistrationManager;
  private readonly signer: ElectionSigner;
  private readonly actions: ElectionAction[] = [];

  constructor(
    params: Omit<ElectionDefinitionParams, 'pubkey'>,
    options: ElectionOperatorOptions = {}
  ) {
    let resolvedKeyPair: ElectionKeyPair | undefined = options.keyPair;
    if (options.signer && !resolvedKeyPair) {
      resolvedKeyPair = { npub: options.signer.getPublicKey(), nsec: '' };
    }
    if (!resolvedKeyPair) {
      resolvedKeyPair = createElectionKeyPair();
    }
    this.keyPair = resolvedKeyPair;
    this.signer = options.signer ?? createLocalSigner(this.keyPair.nsec);
    this.definition = new ElectionDefinition({
      ...params,
      pubkey: this.signer.getPublicKey(),
    });

    const dataset = new Set(options.rollMembers && options.rollMembers.length ? options.rollMembers : [this.keyPair.npub]);
    this.roll = new ElectoralRoll({
      pubkey: this.signer.getPublicKey(),
      npubs: Array.from(dataset),
      note: options.rollNote,
    });

    this.registration = new RegistrationManager(this.roll, {
      ...options.registrationOptions,
      mode: options.mode,
    });
    this.election = new Election(this.definition, this.roll);
    this.election.setRegistrationManager(this.registration);
  }

  public issueRegistrationChallenge(pubkey: string): RegistrationChallenge {
    const challenge = this.election.issueRegistrationChallenge(pubkey);
    this.recordAction({
      type: 'challenge_issued',
      pubkey,
      timestamp: Math.floor(Date.now() / 1000),
    });
    return challenge;
  }

  public issueInvite(pubkey: string, ttlSeconds?: number): string {
    const token = this.election.issueInvite(pubkey, ttlSeconds);
    this.recordAction({
      type: 'invite_sent',
      pubkey,
      timestamp: Math.floor(Date.now() / 1000),
      meta: { tokenHash: hashPayload(token) },
    });
    return token;
  }

  public acceptInvite(pubkey: string, token: string): RegistrationResult {
    const result = this.election.acceptInvite(pubkey, token);
    if (result.success) {
      this.recordAction({
        type: 'invite_accepted',
        pubkey,
        timestamp: Math.floor(Date.now() / 1000),
      });
    }
    return result;
  }

  public registerForElection(pubkey: string, solution: RegistrationSolution): RegistrationResult {
    const result = this.election.registerForElection(pubkey, solution);
    if (result.success) {
      this.recordAction({
        type: 'registration',
        pubkey,
        timestamp: Math.floor(Date.now() / 1000),
      });
    }
    return result;
  }

  public manualAdd(pubkey: string): boolean {
    const added = this.roll.add(pubkey);
    if (added) {
      this.recordAction({
        type: 'manual_add',
        pubkey,
        timestamp: Math.floor(Date.now() / 1000),
      });
    }
    return added;
  }

  public getActionLog(): ElectionAction[] {
    return [...this.actions];
  }

  private recordAction(action: ElectionAction): void {
    this.actions.push(action);
  }

  public generateAuditEvent(): NostrEvent {
    const validVotes = this.election.getValidVotes();
    const rollFingerprint = this.roll.fingerprint();
    const actions = [...this.actions];
    const payload = {
      definition: this.definition.identifier,
      roll: {
        identifier: this.roll.identifier,
        fingerprint: rollFingerprint,
      },
      votes: validVotes.map((vote) => ({
        pubkey: vote.pubkey,
        choice: vote.choice,
        createdAt: vote.createdAt,
      })),
      tally: this.election.tally(),
      actions,
      challengeStats:
        typeof this.registration?.getChallengeStats === 'function'
          ? this.registration.getChallengeStats()
          : {},
    };
    const summary = hashPayload(payload);

    const event: NostrEvent = {
      kind: ELECTION_AUDIT_KIND,
      id: '',
      pubkey: this.keyPair.npub,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', this.definition.identifier],
        ['roll', this.roll.identifier],
        ['rollHash', rollFingerprint],
        ['summary', summary],
        ['votes', validVotes.length.toString()],
      ],
      content: JSON.stringify(payload),
    };

    event.sig = this.signer.sign(event);
    return event;
  }

  public verifyAuditEvent(event: NostrEvent): boolean {
    if (event.kind !== ELECTION_AUDIT_KIND || event.pubkey !== this.keyPair.npub) {
      return false;
    }

    if (!verifyEventSignature(event, this.keyPair.npub)) {
      return false;
    }

    const payload = JSON.parse(event.content ?? '{}');
    const summaryTag = event.tags.find((tag) => tag[0] === 'summary')?.[1];
    if (!summaryTag) {
      return false;
    }

    return summaryTag === hashPayload(payload);
  }

  public get registrationManager(): RegistrationManager {
    return this.registration;
  }
}
