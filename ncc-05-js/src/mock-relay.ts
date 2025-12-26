import { WebSocketServer, WebSocket } from 'ws';

export class MockRelay {
    private static instance: MockRelay;
    private wss: WebSocketServer;
    private events: any[] = [];

    constructor(port: number = 8080) {
        this.wss = new WebSocketServer({ port });
        MockRelay.instance = this;
        this.wss.on('connection', (ws: WebSocket) => {
            ws.on('message', (data: string) => {
                const msg = JSON.parse(data);
                const type = msg[0];

                if (type === 'EVENT') {
                    const event = msg[1];
                    // Basic replaceable logic for test consistency
                    if (event.kind === 30058 || event.kind === 10002) {
                        const dTag = event.tags.find((t: any) => t[0] === 'd')?.[1] || "";
                        this.events = this.events.filter(e => 
                            !(e.pubkey === event.pubkey && e.kind === event.kind && (e.tags.find((t: any) => t[0] === 'd')?.[1] || "") === dTag)
                        );
                    }
                    this.events.push(event);
                    ws.send(JSON.stringify(["OK", event.id, true, ""]));
                } else if (type === 'REQ') {
                    const subId = msg[1];
                    const filters = msg[2];
                    
                    this.events.forEach(event => {
                        let match = true;
                        if (filters.authors && !filters.authors.includes(event.pubkey)) match = false;
                        if (filters.kinds && !filters.kinds.includes(event.kind)) match = false;
                        if (filters['#d']) {
                            const dTag = event.tags.find((t: any) => t[0] === 'd')?.[1];
                            if (!filters['#d'].includes(dTag)) match = false;
                        }
                        
                        if (match) {
                            ws.send(JSON.stringify(["EVENT", subId, event]));
                        }
                    });
                    ws.send(JSON.stringify(["EOSE", subId]));
                }
            });
        });
    }

    stop() {
        this.wss.close();
    }

    public static getNostrConnections(): WebSocket[] {
        if (!MockRelay.instance) {
            return [];
        }
        return Array.from(MockRelay.instance.wss.clients);
    }

    public static closeAllClientConnections() {
        if (MockRelay.instance) {
            MockRelay.instance.wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.close();
                }
            });
        }
    }
}
