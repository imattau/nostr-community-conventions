import { 
  pool, 
  createEventTemplate, 
  publishEvent
} from "./nostr.js";
import { nowSeconds } from "../utils.js";
import { KINDS } from "../state.js";

/**
 * Service to manage NSR (NCC Succession Record) events.
 */
export const nsrService = {
  /**
   * Checks if an NSR already exists for a given authoritative ID.
   */
  async findExistingNSR(relays, d, authoritativeId, fromId = null) {
    const filters = [{
      kinds: [KINDS.nsr],
      "#d": [d],
      "#authoritative": [`event:${authoritativeId}`]
    }];
    
    if (fromId) {
      filters.push({
        kinds: [KINDS.nsr],
        "#from": [`event:${fromId}`],
        "#to": [`event:${authoritativeId}`]
      });
    }

    const existing = await pool.querySync(relays, filters, { maxWait: 3000 });
    return existing.length > 0 ? existing[0] : null;
  },

  /**
   * Automatically creates and publishes an NSR for a newly published NCC revision.
   */
  async createRevisionNSR(signer, relays, { d, fromId, toId, authoritativeId, effectiveAt }) {
    // 1. Check for duplicates
    const existing = await this.findExistingNSR(relays, d, authoritativeId, fromId);
    if (existing) {
      console.info("NSR already exists, skipping duplicate publish", existing.id);
      return { skipped: true, eventId: existing.id };
    }

    // 2. Build the draft
    const nsrDraft = {
      kind: KINDS.nsr,
      d: d,
      content: "Auto NSR: revision published",
      tags: {
        authoritative: authoritativeId,
        type: "revision",
        effective_at: String(effectiveAt || nowSeconds())
      }
    };

    if (fromId) {
      nsrDraft.tags.from = fromId;
      nsrDraft.tags.previous = fromId;
      nsrDraft.tags.to = toId || authoritativeId;
    }

    // 3. Publish
    const template = createEventTemplate(nsrDraft);
    const event = await signer.signEvent(template);
    const result = await publishEvent(relays, event);
    
    return { 
      event,
      eventId: event.id, 
      accepted: result.accepted, 
      total: result.total 
    };
  }
};
