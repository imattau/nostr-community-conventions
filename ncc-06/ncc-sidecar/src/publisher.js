import WebSocket from 'ws';
import { finalizeEvent } from 'nostr-tools/pure';

export async function publishToRelays(relays, events, secretKey) {
  const results = {};
  
  for (const relayUrl of relays) {
    try {
      await publishToRelay(relayUrl, events, secretKey);
      results[relayUrl] = { success: true, timestamp: Date.now() };
    } catch (err) {
      console.error(`[Publisher] Failed to publish to ${relayUrl}: ${err.message}`);
      results[relayUrl] = { success: false, error: err.message, timestamp: Date.now() };
    }
  }
  
  return results;
}

function publishToRelay(relayUrl, events, secretKey) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Publish timeout'));
    }, 10000);

    ws.on('open', () => {
      for (const event of events) {
        // Finalize if needed (signed)
        const signed = event.sig ? event : finalizeEvent(event, secretKey);
        ws.send(JSON.stringify(['EVENT', signed]));
      }
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg[0] === 'OK') {
          // One OK is enough to consider it a success for this relay in many cases
          clearTimeout(timeout);
          clearTimeout(finishTimeout);
          ws.close();
          resolve();
        }
      } catch (_err) {
        console.warn("[Publisher] Malformed relay message:", _err);
      }
    });

    // Fallback: wait a bit for OKs then close
    const finishTimeout = setTimeout(() => {
      clearTimeout(timeout);
      ws.close();
      resolve();
    }, 1000);

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
