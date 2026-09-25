import { createHash, randomBytes } from 'crypto';
import { ElectoralRoll } from './ElectoralRoll';
import { ElectionMode, hashPayload } from './crypto';

export interface RegistrationChallenge {
  id: string;
  pubkey: string;
  seed: string;
  difficulty: number;
  expiresAt: number;
}

export interface RegistrationSolution {
  challengeId: string;
  nonce: string;
}

export interface RegistrationOptions {
  difficulty?: number;
  ttlSeconds?: number;
  inviteTTLSeconds?: number;
  mode?: ElectionMode;
  maxChallengesPerPubkey?: number;
}

export interface RegistrationResult {
  success: boolean;
  alreadyRegistered: boolean;
  reason?: string;
}

interface InviteEntry {
  tokenHash: string;
  expiresAt: number;
  used: boolean;
}

export class RegistrationManager {
  private readonly challenges = new Map<string, RegistrationChallenge>();
  private readonly difficulty: number;
  private readonly ttlMs: number;
  private readonly roll: ElectoralRoll;
  private readonly invites = new Map<string, InviteEntry>();
  private readonly inviteTTLMs: number;
  private readonly mode: ElectionMode;
  private readonly challengeCounts = new Map<string, number>();
  private readonly maxChallengesPerPubkey?: number;

  constructor(roll: ElectoralRoll, options: RegistrationOptions = {}) {
    this.roll = roll;
    this.difficulty = options.difficulty ?? 3;
    this.ttlMs = (options.ttlSeconds ?? 120) * 1000;
    this.inviteTTLMs = (options.inviteTTLSeconds ?? 600) * 1000;
    this.mode = options.mode ?? 'public';
    this.maxChallengesPerPubkey = options.maxChallengesPerPubkey;
  }

  public issueChallenge(pubkey: string): RegistrationChallenge {
    const normalized = pubkey?.trim();
    if (!normalized) {
      throw new Error('Pubkey is required for registration challenges.');
    }
    if (this.roll.isEligible(normalized)) {
      throw new Error('Pubkey already enrolled in the roll.');
    }

    if (this.maxChallengesPerPubkey !== undefined) {
      const count = (this.challengeCounts.get(normalized) ?? 0) + 1;
      if (count > this.maxChallengesPerPubkey) {
        throw new Error('Challenge limit reached for this pubkey.');
      }
      this.challengeCounts.set(normalized, count);
    }

    const challenge: RegistrationChallenge = {
      id: randomBytes(8).toString('hex'),
      pubkey: normalized,
      seed: randomBytes(16).toString('hex'),
      difficulty: this.difficulty,
      expiresAt: Date.now() + this.ttlMs,
    };
    this.challenges.set(challenge.id, challenge);
    return challenge;
  }

  public register(pubkey: string, solution: RegistrationSolution): RegistrationResult {
    const normalized = pubkey?.trim();
    if (!normalized) {
      return { success: false, alreadyRegistered: false, reason: 'Missing pubkey.' };
    }

    if (this.mode === 'closed') {
      return { success: false, alreadyRegistered: this.roll.isEligible(normalized), reason: 'Closed elections require invite or manual add.' };
    }

    const challenge = this.challenges.get(solution.challengeId);
    if (!challenge) {
      return { success: false, alreadyRegistered: this.roll.isEligible(normalized), reason: 'Unknown or expired challenge.' };
    }

    if (challenge.pubkey !== normalized) {
      return { success: false, alreadyRegistered: this.roll.isEligible(normalized), reason: 'Challenge does not match pubkey.' };
    }

    if (Date.now() > challenge.expiresAt) {
      this.challenges.delete(challenge.id);
      return { success: false, alreadyRegistered: this.roll.isEligible(normalized), reason: 'Challenge expired.' };
    }

    const hash = createHash('sha256').update(challenge.seed + solution.nonce).digest('hex');
    if (!RegistrationManager.difficultySatisfied(hash, challenge.difficulty)) {
      return { success: false, alreadyRegistered: this.roll.isEligible(normalized), reason: 'Proof-of-work invalid.' };
    }

    const wasEligible = this.roll.isEligible(normalized);
    this.roll.add(normalized);
    this.challenges.delete(challenge.id);
    return { success: true, alreadyRegistered: wasEligible, reason: 'Registered as eligible voter.' };
  }

  public issueInvite(pubkey: string, ttlSeconds?: number): string {
    const normalized = pubkey?.trim();
    if (!normalized) {
      throw new Error('Pubkey is required to issue an invite.');
    }
    if (this.roll.isEligible(normalized)) {
      throw new Error('Pubkey already enrolled in the roll.');
    }

    const token = randomBytes(10).toString('hex');
    const expiresAt = Date.now() + (ttlSeconds ? ttlSeconds * 1000 : this.inviteTTLMs);
    this.invites.set(normalized, { tokenHash: hashPayload(token), expiresAt, used: false });
    return token;
  }

  public acceptInvite(pubkey: string, token: string): RegistrationResult {
    const normalized = pubkey?.trim();
    if (!normalized) {
      return { success: false, alreadyRegistered: false, reason: 'Missing pubkey.' };
    }

    const entry = this.invites.get(normalized);
    if (!entry) {
      return { success: false, alreadyRegistered: this.roll.isEligible(normalized), reason: 'No invite issued.' };
    }

    if (entry.used) {
      return { success: false, alreadyRegistered: this.roll.isEligible(normalized), reason: 'Invite already used.' };
    }

    if (Date.now() > entry.expiresAt) {
      this.invites.delete(normalized);
      return { success: false, alreadyRegistered: this.roll.isEligible(normalized), reason: 'Invite expired.' };
    }

    if (entry.tokenHash !== hashPayload(token)) {
      return { success: false, alreadyRegistered: this.roll.isEligible(normalized), reason: 'Invalid invite token.' };
    }

    entry.used = true;
    this.roll.add(normalized);
    return { success: true, alreadyRegistered: false, reason: 'Invite accepted.' };
  }

  public getChallengeStats(): Record<string, number> {
    return Object.fromEntries(this.challengeCounts.entries());
  }

  private static difficultySatisfied(hash: string, difficulty: number): boolean {
    const prefix = '0'.repeat(Math.max(0, difficulty));
    return hash.startsWith(prefix);
  }
}
