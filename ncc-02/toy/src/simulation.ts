import { EventEmitter } from 'events';

function matchFilters(filters: any[], event: any): boolean {
    return filters.some(f => matchFilter(f, event));
}

function matchFilter(filter: any, event: any): boolean {
    if (filter.ids && !filter.ids.includes(event.id)) return false;
    if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
    if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
    
    for (const key in filter) {
        if (key.startsWith('#')) {
            const tagName = key.slice(1);
            const values = filter[key] as string[];
            const hasTag = event.tags.some((t: string[]) => t[0] === tagName && values.includes(t[1]));
            if (!hasTag) return false;
        }
    }
    return true;
}

// Basic Mock Relay Logic
class MockRelayServer {
    events: any[] = [];
    subs: Map<string, { filters: any[], ws: MockWebSocket }> = new Map();

    constructor(public url: string) {}

    // Now returns a promise that resolves on completion
    async publish(event: any): Promise<boolean> {
        // Handle replaceable events
        if (event.kind >= 10000 && event.kind < 20000) {
            this.events = this.events.filter(e => e.kind !== event.kind || e.pubkey !== event.pubkey);
        } else if (event.kind >= 30000 && event.kind < 40000) {
            const dTag = event.tags.find((t: string[]) => t[0] === 'd')?.[1] || '';
            this.events = this.events.filter(e => {
                if (e.kind !== event.kind || e.pubkey !== event.pubkey) return true;
                const eDTag = e.tags.find((t: string[]) => t[0] === 'd')?.[1] || '';
                return eDTag !== dTag;
            });
        }
        
        this.events.push(event);
        this.broadcast(event);
        return true; // Acknowledge success
    }

    subscribe(subId: string, filters: any[], ws: MockWebSocket) {
        this.subs.set(subId, { filters, ws });
        const matches = this.events.filter(e => matchFilters(filters, e));
        matches.forEach(e => ws.emitMessage(JSON.stringify(["EVENT", subId, e])));
        ws.emitMessage(JSON.stringify(["EOSE", subId]));
    }

    unsubscribe(subId: string) {
        this.subs.delete(subId);
    }

    broadcast(event: any) {
        for (const [subId, { filters, ws }] of this.subs) {
            if (matchFilters(filters, event)) {
                ws.emitMessage(JSON.stringify(["EVENT", subId, event]));
            }
        }
    }
}

const SERVERS = new Map<string, MockRelayServer>();

export function getRelayServer(url: string): MockRelayServer {
    if (!SERVERS.has(url)) {
        SERVERS.set(url, new MockRelayServer(url));
    }
    return SERVERS.get(url)!;
}

export class MockWebSocket extends EventEmitter {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    readyState = MockWebSocket.CONNECTING;
    url: string;
    server: MockRelayServer;

    onopen: ((ev: any) => any) | null = null;
    onmessage: ((ev: any) => any) | null = null;
    onclose: ((ev: any) => any) | null = null;
    onerror: ((ev: any) => any) | null = null;

    constructor(url: string) {
        super();
        this.url = url;
        this.server = getRelayServer(url);
        
        setTimeout(() => {
            this.readyState = MockWebSocket.OPEN;
            this.emit('open', {});
            this.onopen?.({});
        }, 1); // Make connection near-instant
    }

    send(data: string) {
        const msg = JSON.parse(data);
        const type = msg[0];

        switch(type) {
            case "REQ":
                this.server.subscribe(msg[1], msg.slice(2), this);
                break;
            case "CLOSE":
                this.server.unsubscribe(msg[1]);
                break;
            case "EVENT":
                this.server.publish(msg[1]).then(success => {
                    this.emitMessage(JSON.stringify(["OK", msg[1].id, success, ""]));
                });
                break;
        }
    }

    close() {
        this.readyState = MockWebSocket.CLOSED;
        this.emit('close', {});
        this.onclose?.({});
    }
    
    emitMessage(msg: string) {
        this.emit('message', { data: msg });
        this.onmessage?.({ data: msg });
    }
    
    addEventListener(type: string, listener: any) { this.on(type, listener); }
    removeEventListener(type: string, listener: any) { this.off(type, listener); }
}

export function setupSimulation() {
    (global as any).WebSocket = MockWebSocket;
    SERVERS.clear();
}