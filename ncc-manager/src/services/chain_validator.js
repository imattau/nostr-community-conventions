import { verifyEvent } from 'nostr-tools';
import { KINDS } from '../state.js';
import { normalizeEventId, eventTagValue } from '../utils.js';

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

/**
 * @typedef {object} ParsedNccDoc
 * @property {string} id
 * @property {number} kind
 * @property {string} pubkey
 * @property {number} created_at
 * @property {string} d
 * @property {string} status
 * @property {string | null} supersedes
 * @property {object} rawEvent
 */

/**
 * @typedef {object} ParsedNsrEvent
 * @property {string} id
 * @property {number} kind
 * @property {string} pubkey
 * @property {number} created_at
 * @property {string} d
 * @property {string} type
 * @property {string} authoritative
 * @property {string | null} from
 * @property {string | null} to
 * @property {string | null} previous
 * @property {number | null} effective_at
 * @property {object} rawEvent
 */

/**
 * @typedef {object} ValidationResult
 * @property {string} d
 * @property {string | null} authoritativeDocId
 * @property {string | null} authoritativeNsrId
 * @property {string | null} currentSteward
 * @property {string[]} tips
 * @property {Array<{ prevId: string, successors: string[] }>} forkPoints
 * @property {string[]} forkedBranches
 * @property {string[]} warnings
 */

/**
 * Helper to parse a raw Nostr event into a common structure.
 * @param {object} event The raw Nostr event.
 * @returns {ParsedNccDoc | ParsedNsrEvent | null} Parsed event data or null if invalid.
 */
function parseEvent(event) {
  if (!event || !event.kind || !event.pubkey || !event.id) {
    return null;
  }

  // Basic signature validation
  try {
    if (!verifyEvent(event)) {
      console.warn(`[Validator] Signature verification failed for event ${event.id}`);
      return null; 
    }
  } catch (e) {
    console.error(`[Validator] Error verifying signature for event ${event.id}:`, e);
    return null;
  }

  if (event.kind === KINDS.ncc) {
    const d = eventTagValue(event.tags, 'd');
    const status = eventTagValue(event.tags, 'status') || 'published';
    const supersedes = eventTagValue(event.tags, 'supersedes');

    return {
      id: event.id,
      kind: event.kind,
      pubkey: event.pubkey,
      created_at: event.created_at,
      d: d,
      status: status,
      supersedes: supersedes ? normalizeEventId(supersedes) : null,
      rawEvent: event,
    };
  } else if (event.kind === KINDS.nsr) {
    const d = eventTagValue(event.tags, 'd');
    const type = eventTagValue(event.tags, 'type') || 'revision';
    const authoritative = eventTagValue(event.tags, 'authoritative');
    const from = eventTagValue(event.tags, 'from');
    const to = eventTagValue(event.tags, 'to');
    const previous = eventTagValue(event.tags, 'previous');
    const effective_at = eventTagValue(event.tags, 'effective_at');

    return {
      id: event.id,
      kind: event.kind,
      pubkey: event.pubkey,
      created_at: event.created_at,
      d: d,
      type: type,
      authoritative: authoritative ? normalizeEventId(authoritative) : null,
      from: from ? normalizeEventId(from) : null,
      to: to ? normalizeEventId(to) : null,
      previous: previous ? normalizeEventId(previous) : null,
      effective_at: effective_at ? parseInt(effective_at, 10) : null,
      rawEvent: event,
    };
  }

  return null; 
}

/**
 * Implements deterministic client/steward-perspective validation for NCCs.
 * @param {string} targetD The 'd' tag value (e.g., "ncc-07") to validate.
 * @param {object[]} rawDocs Array of raw Nostr events of kind 30050.
 * @param {object[]} rawNsrs Array of raw Nostr events of kind 30051.
 * @returns {ValidationResult}
 */
export function validateNccChain(targetD, rawDocs, rawNsrs) {
  const result = {
    d: targetD,
    authoritativeDocId: null,
    authoritativeNsrId: null,
    currentSteward: null,
    tips: [],
    forkPoints: [],
    forkedBranches: [],
    warnings: [],
  };

  const parsedDocs = [];
  const parsedNsrs = [];

  // 1. Filter
  // Keep only events with matching d and valid signatures.
  // Record warnings for dropped events.

  // Check docs
  for (const event of rawDocs) {
    const parsed = parseEvent(event);
    if (!parsed) {
      result.warnings.push(`Doc ${event.id} signature invalid or malformed.`);
      continue;
    }
    if (parsed.d !== targetD) continue;
    parsedDocs.push(parsed);
  }

  // Check nsrs
  for (const event of rawNsrs) {
    const parsed = parseEvent(event);
    if (!parsed) {
      result.warnings.push(`NSR ${event.id} signature invalid or malformed.`);
      continue;
    }
    if (parsed.d !== targetD) continue;
    parsedNsrs.push(parsed);
  }

  if (parsedDocs.length === 0) {
    result.warnings.push(`No valid NCC documents found for d=${targetD}.`);
    return result;
  }

  // 2. Determine authorised steward
  // Identify the root document (no supersedes) to establish the initial steward.
  // Tie-breaking: Prefer status="published", then earliest created_at, then lowest ID.
  const potentialRoots = parsedDocs.filter(d => !d.supersedes);
  
  potentialRoots.sort((a, b) => {
    const aPub = a.status === 'published';
    const bPub = b.status === 'published';
    if (aPub && !bPub) return -1;
    if (!aPub && bPub) return 1;
    if (a.created_at !== b.created_at) return a.created_at - b.created_at;
    return a.id.localeCompare(b.id);
  });

  let root;
  if (potentialRoots.length > 0) {
      root = potentialRoots[0];
  } else {
      // Fallback: If root is missing from local fetch, assume oldest known document is the steward
      // for the purpose of identifying ownership of the current fragment.
      const sortedDocs = [...parsedDocs].sort((a, b) => a.created_at - b.created_at);
      root = sortedDocs[0];
      result.warnings.push(`No root document found for ${targetD} (all known documents supersede something). Falling back to oldest known document ${root.id} by ${root.pubkey}.`);
  }
  
  // Track stewardship changes via succession NSRs.
  // Succession NSRs must be signed by the current steward to validly transfer authority.
  const successionNsrs = parsedNsrs.filter(n => n.type === 'succession');
  successionNsrs.sort((a, b) => a.created_at - b.created_at);

  const authorisedStewardSet = new Set([root.pubkey]);
  let tempSteward = root.pubkey;
  
  for (const nsr of successionNsrs) {
      if (nsr.pubkey === tempSteward) {
          if (nsr.authoritative) {
               const target = parsedDocs.find(d => d.id === nsr.authoritative) || parsedNsrs.find(n => n.id === nsr.authoritative);
               if (target) {
                   tempSteward = target.pubkey;
                   authorisedStewardSet.add(tempSteward);
               }
          }
      }
  }
  result.currentSteward = tempSteward;

  // 3. Candidate documents
  // Only documents published by an authorised steward are candidates for authority.
  const authorisedPublishedDocs = parsedDocs.filter(doc => {
      if (doc.status !== 'published') return false;
      return authorisedStewardSet.has(doc.pubkey);
  });
  
  parsedDocs.forEach(doc => {
      if (doc.status === 'published' && !authorisedStewardSet.has(doc.pubkey)) {
          result.warnings.push(`Unauthorised published doc ${doc.id} by ${doc.pubkey}.`);
      }
  });

  // 4. Validate revision NSRs
  // Must be signed by an authorised steward and point to a known authorised document.
  // Transitions (from -> to) must match the document supersedes chain.
  const validRevisionNsrs = parsedNsrs.filter(nsr => {
      if (nsr.type !== 'revision') return false; 
      
      if (!authorisedStewardSet.has(nsr.pubkey)) return false;

      if (!nsr.authoritative) {
          result.warnings.push(`NSR ${nsr.id} missing authoritative tag.`);
          return false;
      }

      const authDoc = parsedDocs.find(d => d.id === nsr.authoritative);
      if (!authDoc) {
          result.warnings.push(`NSR ${nsr.id} points to unknown authoritative doc ${nsr.authoritative}.`);
          return false;
      }

      if (nsr.from && nsr.to) {
          if (nsr.to !== nsr.authoritative) {
               result.warnings.push(`NSR ${nsr.id} 'to' tag does not match 'authoritative'.`);
               return false;
          }
          const toDoc = parsedDocs.find(d => d.id === nsr.to);
          const fromDoc = parsedDocs.find(d => d.id === nsr.from);
          if (fromDoc && toDoc) {
              if (toDoc.supersedes !== nsr.from) {
                  result.warnings.push(`NSR ${nsr.id} validates transition ${nsr.from}->${nsr.to} but doc supersedes ${toDoc.supersedes}.`);
                  return false;
              }
          }
      }
      return true;
  });

  // Deduplicate NSRs: One per authoritative ID.
  // Prefer latest effective_at, then created_at, then ID.
  const nsrByAuth = new Map();
  for (const nsr of validRevisionNsrs) {
      const existing = nsrByAuth.get(nsr.authoritative);
      if (!existing) {
          nsrByAuth.set(nsr.authoritative, nsr);
      } else {
          let replace = false;
          const nsrEff = nsr.effective_at || 0;
          const extEff = existing.effective_at || 0;
          
          if (nsrEff > extEff) replace = true;
          else if (nsrEff === extEff) {
              if (nsr.created_at > existing.created_at) replace = true;
              else if (nsr.created_at === existing.created_at) {
                  if (nsr.id.localeCompare(existing.id) > 0) replace = true; 
              }
          }
          
          if (replace) {
              nsrByAuth.set(nsr.authoritative, nsr);
          }
      }
  }
  const uniqueValidNsrs = Array.from(nsrByAuth.values());

  // 5. Determine authoritative revision
  // Primary: The latest valid revision NSR determines the authoritative document.
  uniqueValidNsrs.sort((a, b) => {
      const aEff = a.effective_at || 0;
      const bEff = b.effective_at || 0;
      if (aEff !== bEff) return bEff - aEff; 
      if (a.created_at !== b.created_at) return b.created_at - a.created_at;
      return b.id.localeCompare(a.id);
  });

  if (uniqueValidNsrs.length > 0) {
      const bestNsr = uniqueValidNsrs[0];
      result.authoritativeDocId = bestNsr.authoritative;
      result.authoritativeNsrId = bestNsr.id;
  } else {
      // Fallback: Compute chain tips among authorised published docs.
      // If exactly one tip exists, it is authoritative.
      const supersededIds = new Set();
      authorisedPublishedDocs.forEach(d => {
          if (d.supersedes) supersededIds.add(d.supersedes);
      });

      const tips = authorisedPublishedDocs.filter(d => !supersededIds.has(d.id));
      result.tips = tips.map(t => t.id);

      if (tips.length === 1) {
          result.authoritativeDocId = tips[0].id;
          result.authoritativeNsrId = null;
      } else if (tips.length > 1) {
          result.authoritativeDocId = null;
          result.authoritativeNsrId = null;
          result.warnings.push(`Multiple tips found (${tips.length}) with no authoritative NSR.`);
      }
  }

  // 6. Fork detection
  // Identify points where history diverges (one parent has multiple successors).
  const successorsMap = new Map(); 
  
  authorisedPublishedDocs.forEach(d => {
      if (d.supersedes) {
          if (!successorsMap.has(d.supersedes)) {
              successorsMap.set(d.supersedes, []);
          }
          successorsMap.get(d.supersedes).push(d.id);
      }
  });

  for (const [prevId, successors] of successorsMap.entries()) {
      if (successors.length > 1) {
          result.forkPoints.push({ prevId, successors });
      }
  }

  // Identify forked branches (tips that are not the authoritative revision).
  if (result.authoritativeDocId) {
      const supersededIds = new Set();
      authorisedPublishedDocs.forEach(d => {
          if (d.supersedes) supersededIds.add(d.supersedes);
      });
      const tips = authorisedPublishedDocs.filter(d => !supersededIds.has(d.id));
      
      result.forkedBranches = tips
          .map(t => t.id)
          .filter(id => id !== result.authoritativeDocId); 
  }

  // 7. Additional Warnings
  parsedDocs.forEach(d => {
      if (d.supersedes === d.id) {
          result.warnings.push(`Doc ${d.id} supersedes itself.`);
      }
  });

  const docIds = new Set(parsedDocs.map(d => d.id));
  parsedDocs.forEach(d => {
      if (d.supersedes && !docIds.has(d.supersedes)) {
           result.warnings.push(`Doc ${d.id} supersedes unknown document ${d.supersedes}.`);
      }
  });

  return result;
}