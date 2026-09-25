import { WebSocketServer } from 'ws';

/**
 * A minimal Nostr relay mock for testing.
 */
export function createMockRelay(port = 0) {
  const wss = new WebSocketServer({ port });
  const events = [];
  
  const getPort = () => {
    const addr = wss.address();
    return addr ? addr.port : '0';
  };

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      const currentPort = getPort();
      try {
        const msg = JSON.parse(data.toString());
        const type = msg[0];
        console.log(`[MockRelay:${currentPort}] Received: ${type}`);
        
        if (type === 'EVENT') {
          events.push(msg[1]);
          ws.send(JSON.stringify(['OK', msg[1].id, true, '']));
        } else if (type === 'REQ') {
          const subId = msg[1];
          const filter = msg[2];
          console.log(`[MockRelay:${currentPort}] Filter:`, JSON.stringify(filter));
          
          // Simple filtering for testing
          const matches = events.filter(e => {
            if (filter.kinds && !filter.kinds.includes(e.kind)) return false;
            if (filter.authors && !filter.authors.includes(e.pubkey)) return false;
            
            // Check d-tag filter (#d)
            if (filter['#d']) {
              const dTag = e.tags.find(t => t[0] === 'd');
              if (!dTag || !filter['#d'].includes(dTag[1])) return false;
            }
            
            return true;
          });

          console.log(`[MockRelay:${currentPort}] Found ${matches.length} matches`);
          matches.forEach(e => {
            ws.send(JSON.stringify(['EVENT', subId, e]));
          });
          ws.send(JSON.stringify(['EOSE', subId]));
        }
      } catch (e) {
        console.error(`[MockRelay:${currentPort}] Error:`, e);
      }
    });
  });

  return {
    wss,
    port: () => getPort(),
    url: () => `ws://localhost:${getPort()}`,
    receivedEvents: () => events,
    close: () => new Promise(res => {
      wss.clients.forEach(client => client.terminate());
      wss.close(res);
    })
  };
}
