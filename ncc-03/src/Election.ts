import { ElectoralRoll } from './ElectoralRoll';
import { RegistrationChallenge, RegistrationManager, RegistrationResult, RegistrationSolution } from './Registration';
import { NostrEvent, VoteTally } from './types';
import { ElectionDefinition } from './ElectionDefinition';
import { VoteEvent } from './VoteEvent';

export class Election {
  private readonly votes: VoteEvent[] = [];
  private roll?: ElectoralRoll;
  private registrationManager?: RegistrationManager;

  constructor(public readonly definition: ElectionDefinition, roll?: ElectoralRoll) {
    this.roll = roll;
  }

  public get electoralRoll(): ElectoralRoll | undefined {
    return this.roll;
  }

  public setElectoralRoll(roll: ElectoralRoll): void {
    this.roll = roll;
  }

  public setRegistrationManager(manager: RegistrationManager): void {
    this.registrationManager = manager;
  }

  public issueRegistrationChallenge(pubkey: string): RegistrationChallenge {
    if (!this.registrationManager) {
      throw new Error('No registration manager configured.');
    }
    return this.registrationManager.issueChallenge(pubkey);
  }

  public registerForElection(pubkey: string, solution: RegistrationSolution): RegistrationResult {
    if (!this.registrationManager) {
      throw new Error('No registration manager configured.');
    }
    return this.registrationManager.register(pubkey, solution);
  }

  public issueInvite(pubkey: string, ttlSeconds?: number): string {
    if (!this.registrationManager) {
      throw new Error('No registration manager configured.');
    }
    return this.registrationManager.issueInvite(pubkey, ttlSeconds);
  }

  public acceptInvite(pubkey: string, token: string): RegistrationResult {
    if (!this.registrationManager) {
      throw new Error('No registration manager configured.');
    }
    return this.registrationManager.acceptInvite(pubkey, token);
  }

  public addVote(vote: VoteEvent): boolean {
    if (!this.isVoteValid(vote)) {
      return false;
    }
    this.votes.push(vote);
    return true;
  }

  public addVoteFromEvent(event: NostrEvent): boolean {
    return this.addVote(VoteEvent.fromEvent(event));
  }

  public addVotes(votes: VoteEvent[]): void {
    for (const vote of votes) {
      this.addVote(vote);
    }
  }

  public getValidVotes(): VoteEvent[] {
    const perPubkey = new Map<string, VoteEvent>();
    for (const vote of this.votes) {
      if (!this.isVoteValid(vote)) {
        continue;
      }
      const existing = perPubkey.get(vote.pubkey);
      if (!existing || vote.createdAt > existing.createdAt) {
        perPubkey.set(vote.pubkey, vote);
      }
    }
    return Array.from(perPubkey.values());
  }

  public tally(): VoteTally {
    const counts: Record<string, number> = {};
    for (const optionId of this.definition.optionIds) {
      counts[optionId] = 0;
    }

    const validVotes = this.getValidVotes();
    for (const vote of validVotes) {
      counts[vote.choice] = (counts[vote.choice] ?? 0) + 1;
    }

    return {
      counts,
      total: validVotes.length,
      choices: Object.keys(counts),
    };
  }

  public isVoteValid(vote: VoteEvent): boolean {
    return (
      vote.matchesElection(this.definition) &&
      vote.isOption(this.definition) &&
      vote.isInWindow(this.definition) &&
      (!this.roll || this.roll.isEligible(vote.pubkey))
    );
  }
}
