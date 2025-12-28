import { WebSocketServer } from 'ws';

/**
 * A minimal Nostr relay mock for testing.
 */
export function createMockRelay(port = 0) {
  const wss = new WebSocketServer({ port });
  const events = [];
  
  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg[0] === 'EVENT') {
          events.push(msg[1]);
          ws.send(JSON.stringify(['OK', msg[1].id, true, '']));
        }
      } catch (e) {}
    });
  });

  return {
    wss,
    port: () => wss.address().port,
    url: () => `ws://localhost:${wss.address().port}`,
    receivedEvents: () => events,
    close: () => new Promise(res => wss.close(res))
  };
}
