import { finalizeEvent } from 'nostr-tools/pure';
import { nip04, nip44 } from 'nostr-tools';
import WebSocket from 'ws';

export async function sendInviteDM({
  secretKey,
  recipientPubkey,
  message,
  relays,
  encryptionMethod = 'nip44'
}) {
  let ciphertext;

  if (encryptionMethod === 'nip04') {
    ciphertext = nip04.encrypt(secretKey, recipientPubkey, message);
  } else {
    const conversationKey = nip44.getConversationKey(secretKey, recipientPubkey);
    ciphertext = nip44.encrypt(message, conversationKey);
  }

  const eventTemplate = {
    kind: 4,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['p', recipientPubkey],
      ['encryption', encryptionMethod]
    ],
    content: ciphertext
  };

  const signedEvent = finalizeEvent(eventTemplate, secretKey);
  return await broadcastEvent(relays, signedEvent);
}

async function broadcastEvent(relays, event) {
  const promises = relays.map(url => {
    return new Promise((resolve) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => { ws.close(); resolve(false); }, 5000);
      ws.on('open', () => {
        ws.send(JSON.stringify(['EVENT', event]));
      });
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg[0] === 'OK' && msg[1] === event.id) {
            clearTimeout(timer);
            ws.close();
            resolve(true);
          }
        } catch (_err) {
          console.warn("[DM] Failed to parse relay message:", _err);
        }
      });
      ws.on('error', () => resolve(false));
    });
  });

  const results = await Promise.all(promises);
  return results.some(r => r === true);
}
