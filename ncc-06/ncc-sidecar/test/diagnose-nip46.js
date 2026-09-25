import WebSocket from 'ws';
globalThis.WebSocket = WebSocket;
import { nip04, getPublicKey, finalizeEvent } from 'nostr-tools';
import { generateSecretKey } from 'nostr-tools/pure';

async function diagnose() {
  const uri = process.argv[2];
  if (!uri) {
    console.error("Usage: node diagnose-nip46.js <nostrconnect-uri>");
    process.exit(1);
  }

  const url = new URL(uri.replace('nostrconnect:', 'http:'));
  const targetPubkey = url.host;
  const relay = url.searchParams.get('relay');
  const metadata = JSON.parse(url.searchParams.get('metadata') || '{}');

  console.log(`--- NIP-46 Diagnostic Signer ---`);
  console.log(`Target Pubkey: ${targetPubkey}`);
  console.log(`Relay: ${relay}`);
  console.log(`App Name: ${metadata.name}`);

  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  console.log(`Our Signer Pubkey: ${pk}`);

  const ws = new WebSocket(relay);

  ws.on('open', async () => {
    console.log(`[Connected] to ${relay}`);
    
    // 1. Subscribe to messages for us
    const subId = 'diag-' + Math.random().toString(36).substring(7);
    ws.send(JSON.stringify(["REQ", subId, { kinds: [24133], "#p": [pk] }]));
    console.log(`[Subscribed] waiting for messages...`);

    // 2. Send "Connect" response to the target
    const payload = JSON.stringify({
      id: Math.random().toString(36).substring(7),
      method: "connect",
      params: [targetPubkey],
      result: pk
    });

    const encryptedContent = await nip04.encrypt(sk, targetPubkey, payload);
    const event = finalizeEvent({
      kind: 24133,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["p", targetPubkey]],
      content: encryptedContent
    }, sk);

    ws.send(JSON.stringify(["EVENT", event]));
    console.log(`[Sent] Response sent to target. Sidecar should now advance to Step 2.`);
  });

  ws.on('message', async (data) => {
    const msg = JSON.parse(data.toString());
    if (msg[0] === 'EVENT') {
      const event = msg[2];
      try {
        const decrypted = await nip04.decrypt(sk, event.pubkey, event.content);
        console.log(`[Received] Decrypted Message:`, decrypted);
      } catch (e) {
        console.error(`[Error] Could not decrypt:`, e.message);
      }
    }
  });

  ws.on('error', (e) => console.error(`[WS Error]`, e));
}

diagnose();
