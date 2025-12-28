import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import { nip04 } from 'nostr-tools';
import WebSocket from 'ws';

export async function sendInviteDM({ secretKey, recipientPubkey, message, relays }) {
  const ciphertext = await nip04.encrypt(secretKey, recipientPubkey, message);

  const eventTemplate = {
    kind: 4,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', recipientPubkey]],
    content: ciphertext
  };


  // For this invite, let's use a simple NIP-04 DM for maximum visibility in the recipient's client.
  // We'll import NIP-04.
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
        } catch (e) {}
      });
      ws.on('error', () => resolve(false));
    });
  });

  const results = await Promise.all(promises);
  return results.some(r => r === true);
}
