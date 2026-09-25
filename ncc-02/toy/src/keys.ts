import fs from 'fs';
import path from 'path';
import { generateSecretKey, getPublicKey } from 'nostr-tools';

export function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

interface KeyPair {
  sk: string; // hex
  pk: string; // hex
}

interface KeyState {
  operator: KeyPair;
  authorisedClient: KeyPair;
  unauthorisedClient: KeyPair;
}

const KEYS_FILE = path.join(process.cwd(), '.state', 'keys.json');

export function getKeys(): KeyState {
  if (fs.existsSync(KEYS_FILE)) {
    return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'));
  }

  const keys: KeyState = {
    operator: generateKeyPair(),
    authorisedClient: generateKeyPair(),
    unauthorisedClient: generateKeyPair(),
  };

  if (!fs.existsSync(path.dirname(KEYS_FILE))) {
    fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true });
  }
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
  return keys;
}

function generateKeyPair(): KeyPair {
  const skBytes = generateSecretKey();
  const sk = toHex(skBytes);
  const pk = getPublicKey(skBytes);
  return { sk, pk };
}