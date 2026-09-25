import { describe, it, expect, beforeAll, vi } from 'vitest';
import { MockWebSocket } from '../src/simulation';

// Mock 'ws' to use our MockWebSocket
vi.mock('ws', async () => {
    return {
        default: MockWebSocket,
        WebSocket: MockWebSocket
    };
});

describe('Service Card Integration', () => {
    let publishDemo: any;
    let resolveCard: any;
    let setupSimulation: any;

    beforeAll(async () => {
        // Must import simulation setup dynamically after mocks are in place
        const sim = await import('../src/simulation');
        setupSimulation = sim.setupSimulation;
        setupSimulation();
        
        // Dynamically import modules to ensure global.WebSocket is mocked BEFORE nostr-tools loads
        const pub = await import('../src/publish');
        publishDemo = pub.publishDemo;
        const res = await import('../src/resolve');
        resolveCard = res.resolveCard;

        // Publish initial state and wait for it to be processed
        console.log("Setup: Publishing records...");
        await publishDemo();
    });

    it('Test A: Authorised client resolves NCC-05', async () => {
        const card = await resolveCard('authorised');
        console.log('Test A Card:', card);
        expect(card.isPrivateActive).toBe(true);
        expect(card.status).toContain('Private');
        expect(card.activeEndpoint).toBeDefined();
        expect(card.activeEndpoint).toContain('private');
    });

    it('Test B: Unauthorised client falls back to NCC-02', async () => {
        const card = await resolveCard('unauthorised');
        console.log('Test B Card:', card);
        // Expect fallback to public
        expect(card.isPrivateActive).toBe(false);
        expect(card.status).toContain('Public'); 
        expect(card.activeEndpoint).toBeDefined();
        expect(card.activeEndpoint).toContain('public');
    });
    
    it('Test C: Rotation updates active endpoint', async () => {
        const newEndpoint = "https://rotated.demo.com";
        console.log("Test C: Rotating endpoint...");
        await publishDemo(newEndpoint);
        
        const card = await resolveCard('authorised');
        console.log('Test C Card:', card);
        expect(card.activeEndpoint).toBe(newEndpoint);
    });
});
