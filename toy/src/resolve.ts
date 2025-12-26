import { NCC02Resolver } from 'ncc-02-js';
import { NCC05Resolver } from 'ncc-05';
import { SimplePool } from 'nostr-tools';
import { CONFIG } from './config';
import { getKeys } from './keys';

export interface ServiceCard {
    serviceId: string;
    operatorPubkey: string;
    
    // Public (NCC-02) Data
    publicEndpoint?: string;
    fingerprint?: string;
    expiry?: number;
    
    // Private (NCC-05) Data
    privateEndpoints?: string[]; // URLs
    isPrivateActive: boolean;
    
    // Result
    activeEndpoint: string | null;
    status: string; // "OK" | "FALLBACK" | "UNAVAILABLE"
}

export async function resolveCard(asUser: 'authorised' | 'unauthorised', presentedFingerprint?: string): Promise<ServiceCard> {
    const keys = getKeys();
    const userSk = asUser === 'authorised' ? keys.authorisedClient.sk : keys.unauthorisedClient.sk;
    
    // Create a shared pool
    const pool = new SimplePool();
    
    // 1. Resolve NCC-02 (Public)
    // Updated API: new NCC02Resolver(relays, options)
    const ncc02Resolver = new NCC02Resolver(CONFIG.relays, { pool });
    let ncc02Result = null;
    
    try {
        console.log(`Resolving NCC-02 for ${CONFIG.serviceId}...`);
        ncc02Result = await ncc02Resolver.resolve(keys.operator.pk, CONFIG.serviceId);
    } catch (e: any) {
        // Log detailed error
        console.warn(`NCC-02 Resolution failed: ${e.message}`, e.cause || '');
    }
    
    // 2. Resolve NCC-05 (Private)
    // Reuse pool
    const ncc05Resolver = new NCC05Resolver({
        bootstrapRelays: CONFIG.relays,
        pool: pool
    });
    let ncc05Endpoints: string[] = [];
    
    try {
        console.log(`Resolving NCC-05 for ${CONFIG.serviceId}...`);
        // New API accepts string keys!
        const res = await ncc05Resolver.resolve(
            keys.operator.pk,
            userSk, // string (hex)
            CONFIG.serviceId
        );
        
        if (res && res.endpoints && res.endpoints.length > 0) {
            ncc05Endpoints = res.endpoints.map((e: any) => e.uri);
        }
    } catch (e) {
        // Not found or decryption failed
        // console.log("NCC-05 not found/decrypted");
    }

    const card: ServiceCard = {
        serviceId: CONFIG.serviceId,
        operatorPubkey: keys.operator.pk,
        publicEndpoint: ncc02Result?.endpoint,
        fingerprint: ncc02Result?.fingerprint,
        expiry: ncc02Result?.expiry,
        privateEndpoints: ncc05Endpoints,
        isPrivateActive: ncc05Endpoints.length > 0,
        activeEndpoint: null,
        status: "UNAVAILABLE"
    };
    
    // Override Rule
    if (card.isPrivateActive) {
        card.activeEndpoint = card.privateEndpoints![0];
        card.status = "OK (Private)";
    } else if (card.publicEndpoint) {
        card.activeEndpoint = card.publicEndpoint;
        card.status = "OK (Public Fallback)";
    }
    
    // Cleanup
    // ncc02Resolver doesn't have close() if it shares pool?
    // ncc-05 has close()
    if (ncc05Resolver.close) ncc05Resolver.close();
    
    return card;
}