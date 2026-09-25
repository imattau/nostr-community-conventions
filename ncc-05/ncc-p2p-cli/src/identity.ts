import * as fs from 'fs';
import * as path from 'path';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { nip19 } from 'nostr-tools';

const IDENTITY_FILE = '.identity.json';

export interface Identity {
    sk: Uint8Array;
    pk: string;
    nsec: string;
    npub: string;
}

export function loadOrGenerateIdentity(): Identity {
    const filePath = path.resolve(process.cwd(), IDENTITY_FILE);

    if (fs.existsSync(filePath)) {
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            if (data.nsec) {
                const decoded = nip19.decode(data.nsec) as any;
                if (decoded.type === 'nsec') {
                    const sk = decoded.data as Uint8Array;
                    const pk = getPublicKey(sk);
                    return {
                        sk,
                        pk,
                        nsec: data.nsec,
                        npub: nip19.npubEncode(pk)
                    };
                }
            }
        } catch (e: any) {
            console.error(`Failed to load identity from ${filePath}: ${e.message}`);
            console.error("Generating new identity.");
        }
    } else {
        // console.log("No identity file found at", filePath);
    }

    // Generate new
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const nsec = nip19.nsecEncode(sk);
    const npub = nip19.npubEncode(pk);

    const identity: Identity = { sk, pk, nsec, npub };
    
    fs.writeFileSync(filePath, JSON.stringify({ nsec }, null, 2));
    // console.log(`Generated new identity at ${filePath}`);
    
    return identity;
}