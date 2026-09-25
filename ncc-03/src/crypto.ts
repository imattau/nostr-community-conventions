import { createHash } from 'crypto';
import nacl from 'tweetnacl';
import { NostrEvent } from './types';

export type ElectionMode = 'public' | 'closed';

export interface ElectionKeyPair {
  npub: string;
  nsec: string;
}

export interface ElectionSigner {
  getPublicKey(): string;
  sign(event: NostrEvent): string;
}

export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export function createElectionKeyPair(seed?: Uint8Array): ElectionKeyPair {
  const keyPair = seed ? nacl.sign.keyPair.fromSeed(seed) : nacl.sign.keyPair();
  return {
    npub: toHex(keyPair.publicKey),
    nsec: toHex(keyPair.secretKey),
  };
}

export function serializeEvent(event: Pick<NostrEvent, 'pubkey' | 'created_at' | 'kind' | 'tags' | 'content'>): string {
  return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
}

export function signEvent(event: NostrEvent, nsec: string): string {
  const secret = Buffer.from(nsec, 'hex');
  const payload = new TextEncoder().encode(serializeEvent(event));
  const signature = nacl.sign.detached(payload, secret);
  return toHex(signature);
}

export function verifyEventSignature(event: NostrEvent, npub: string): boolean {
  if (!event.sig) {
    return false;
  }

  const publicKey = Buffer.from(npub, 'hex');
  const signature = Buffer.from(event.sig, 'hex');
  const payload = new TextEncoder().encode(serializeEvent(event));
  return nacl.sign.detached.verify(payload, signature, publicKey);
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function createLocalSigner(nsec: string): ElectionSigner {
  return {
    getPublicKey: () => toHex(nacl.sign.keyPair.fromSecretKey(Buffer.from(nsec, 'hex')).publicKey),
    sign: (event: NostrEvent) => signEvent(event, nsec),
  };
}
