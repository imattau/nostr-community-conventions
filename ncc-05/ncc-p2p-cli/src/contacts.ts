import * as fs from 'fs';
import * as path from 'path';

const CONTACTS_FILE = '.contacts.json';

export interface Contact {
    pubkey: string;
    name?: string; // Optional nickname
    added_at: number;
}

export class ContactManager {
    private contacts: Map<string, Contact> = new Map();

    constructor() {
        this.load();
    }

    private load() {
        const filePath = path.resolve(process.cwd(), CONTACTS_FILE);
        if (fs.existsSync(filePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                if (Array.isArray(data)) {
                    data.forEach((c: Contact) => this.contacts.set(c.pubkey, c));
                }
            } catch (e) {
                console.error("Failed to load contacts.");
            }
        }
    }

    save() {
        const filePath = path.resolve(process.cwd(), CONTACTS_FILE);
        const data = Array.from(this.contacts.values());
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    }

    addContact(pubkey: string, name?: string) {
        this.contacts.set(pubkey, {
            pubkey,
            name,
            added_at: Date.now()
        });
        this.save();
    }

    removeContact(pubkey: string) {
        this.contacts.delete(pubkey);
        this.save();
    }

    isTrusted(pubkey: string): boolean {
        return this.contacts.has(pubkey);
    }

    getContact(pubkey: string): Contact | undefined {
        return this.contacts.get(pubkey);
    }

    getAll(): Contact[] {
        return Array.from(this.contacts.values());
    }
}