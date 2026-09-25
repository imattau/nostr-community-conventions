import { pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import nacl from 'tweetnacl';
import { NostrEvent } from './types';
import { ElectionSigner, signEvent, toHex } from './crypto';

export interface VaultSeal {
  encryptedKey: string;
  iv: string;
  salt: string;
  tag: string;
  iterations: number;
}

const ALGORITHM = 'aes-256-gcm';
const DEFAULT_ITERATIONS = 200_000;

function deriveKey(passphrase: string, salt: Buffer, iterations: number): Buffer {
  return pbkdf2Sync(passphrase, salt, iterations, 32, 'sha256');
}

export class SecureVault implements ElectionSigner {
  private constructor(private readonly secretKey: Buffer) {}

  public static create(nsec: string, passphrase: string, iterations = DEFAULT_ITERATIONS): { vault: SecureVault; seal: VaultSeal } {
    const salt = randomBytes(16);
    const key = deriveKey(passphrase, salt, iterations);
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: 16 });
    const encrypted = Buffer.concat([cipher.update(Buffer.from(nsec, 'hex')), cipher.final()]);
    const tag = cipher.getAuthTag();

    const seal: VaultSeal = {
      encryptedKey: encrypted.toString('hex'),
      iv: iv.toString('hex'),
      salt: salt.toString('hex'),
      tag: tag.toString('hex'),
      iterations,
    };

    const vault = new SecureVault(Buffer.from(nsec, 'hex'));
    return { vault, seal };
  }

  public static unlock(seal: VaultSeal, passphrase: string): SecureVault {
    const key = deriveKey(passphrase, Buffer.from(seal.salt, 'hex'), seal.iterations);
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(seal.iv, 'hex'), { authTagLength: 16 });
    decipher.setAuthTag(Buffer.from(seal.tag, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(seal.encryptedKey, 'hex')),
      decipher.final(),
    ]);
    return new SecureVault(decrypted);
  }

  public getPublicKey(): string {
    const keyPair = nacl.sign.keyPair.fromSecretKey(this.secretKey);
    return toHex(keyPair.publicKey);
  }

  public sign(event: NostrEvent): string {
    return signEvent(event, this.secretKey.toString('hex'));
  }

  public destroy(): void {
    this.secretKey.fill(0);
  }
}
