"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadOrGenerateIdentity = loadOrGenerateIdentity;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const nostr_tools_1 = require("nostr-tools");
const nostr_tools_2 = require("nostr-tools");
const IDENTITY_FILE = '.identity.json';
function loadOrGenerateIdentity() {
    const filePath = path.resolve(process.cwd(), IDENTITY_FILE);
    if (fs.existsSync(filePath)) {
        try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            if (data.nsec) {
                const decoded = nostr_tools_2.nip19.decode(data.nsec);
                if (decoded.type === 'nsec') {
                    const sk = decoded.data;
                    const pk = (0, nostr_tools_1.getPublicKey)(sk);
                    return {
                        sk,
                        pk,
                        nsec: data.nsec,
                        npub: nostr_tools_2.nip19.npubEncode(pk)
                    };
                }
            }
        }
        catch (e) {
            console.error("Failed to load identity, generating new one.");
        }
    }
    // Generate new
    const sk = (0, nostr_tools_1.generateSecretKey)();
    const pk = (0, nostr_tools_1.getPublicKey)(sk);
    const nsec = nostr_tools_2.nip19.nsecEncode(sk);
    const npub = nostr_tools_2.nip19.npubEncode(pk);
    const identity = { sk, pk, nsec, npub };
    fs.writeFileSync(filePath, JSON.stringify({ nsec }, null, 2));
    return identity;
}
