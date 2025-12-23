import { KINDS } from './state.js';
import { normalizeEventId } from './utils.js';

/**
 * Validates a draft object before it's published as a Nostr event.
 * @param {Object} draft 
 * @returns {string|null} Error message or null if valid.
 */
export function validateDraftForPublish(draft) {
    if (!draft.d) return "NCC identifier (d tag) is required.";
    
    if (draft.kind === KINDS.ncc) {
        if (!draft.title) return "Title is required for NCC.";
        if (!draft.content) return "Content is required for NCC.";
        if (!draft.tags?.version) return "Version is required for NCC.";
    }

    if (draft.kind === KINDS.nsr) {
        if (!draft.tags?.authoritative) return "Authoritative event ID is required for NSR.";
        if (!draft.tags?.reason) return "Reason is required for NSR.";
        
        const authId = normalizeEventId(draft.tags.authoritative);
        if (authId.length !== 64) return "Invalid Authoritative event ID format.";
    }

    if (draft.kind === KINDS.endorsement) {
        if (!draft.tags?.endorses) return "Endorsed event ID is required.";
        const endorsedId = normalizeEventId(draft.tags.endorses);
        if (endorsedId.length !== 64) return "Invalid Endorsed event ID format.";
    }

    if (draft.kind === KINDS.supporting) {
        if (!draft.tags?.type) return "Type is required for Supporting document.";
        if (!draft.tags?.for) return "Target NCC identifier is required for Supporting document.";
    }

    return null;
}
