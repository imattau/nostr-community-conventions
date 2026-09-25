import { nip44 } from 'nostr-tools';
import { finalizeEvent, getPublicKey as getPkFromSk } from 'nostr-tools/pure';

export class UnifiedSigner {
  async getPublicKey() { throw new Error('Not implemented'); }
  async signEvent() { throw new Error('Not implemented'); }
  async encrypt() { throw new Error('Not implemented'); }
  async decrypt() { throw new Error('Not implemented'); }
}

export class Nip07Signer extends UnifiedSigner {
  async getPublicKey() {
    return window.nostr.getPublicKey();
  }
  async signEvent(event) {
    return window.nostr.signEvent(event);
  }
  async encrypt(pubkey, plaintext) {
    if (window.nostr.nip44) {
      return window.nostr.nip44.encrypt(pubkey, plaintext);
    }
    throw new Error('NIP-44 not supported by extension');
  }
  async decrypt(pubkey, ciphertext) {
    if (window.nostr.nip44) {
      return window.nostr.nip44.decrypt(pubkey, ciphertext);
    }
    throw new Error('NIP-44 not supported by extension');
  }
}

export class LocalSigner extends UnifiedSigner {
  constructor(secretKeyBytes) {
    super();
    this.sk = secretKeyBytes; // Uint8Array
  }

  async getPublicKey() {
    return getPkFromSk(this.sk);
  }

  async signEvent(event) {
    return finalizeEvent(event, this.sk);
  }

  async encrypt(pubkey, plaintext) {
    // NIP-44 v2 encryption
    const conversationKey = nip44.getConversationKey(this.sk, pubkey);
    return nip44.encrypt(plaintext, conversationKey);
  }

  async decrypt(pubkey, ciphertext) {
    const conversationKey = nip44.getConversationKey(this.sk, pubkey);
    return nip44.decrypt(ciphertext, conversationKey);
  }
}

export class Nip46Signer extends UnifiedSigner {
  constructor(client) {
    super();
    this.client = client; 
  }
}