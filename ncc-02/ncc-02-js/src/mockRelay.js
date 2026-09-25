import { verifyEvent } from 'nostr-tools/pure';

/**
 * Simple in-memory mock relay for testing NCC-02 resolution.
 * Adheres to standard Nostr relay filtering rules.
 */
export class MockRelay {
  constructor() {
    /** @type {any[]} */
    this.events = [];
  }

  /**
   * Publishes an event to the relay. 
   * Mimics a standard relay by verifying signatures before acceptance.
   * @param {any} event 
   */
  async publish(event) {
    if (!verifyEvent(event)) {
      return false;
    }
    this.events.push(event);
    return true;
  }

  /**
   * Queries events using standard Nostr filters.
   * Supports kinds, authors, ids, and tag filters (e.g. #d, #e).
   * @param {any} filter 
   * @returns {Promise<any[]>}
   */
  async query(filter) {
    return this.events.filter(event => {
      if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
      if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
      if (filter.ids && !filter.ids.includes(event.id)) return false;
      
      for (const key in filter) {
        if (key.startsWith('#')) {
          const tagName = key.slice(1);
          const filterValues = filter[key];
          const eventTagValues = event.tags
            .filter((/** @type {any[]} */ t) => t[0] === tagName)
            .map((/** @type {any[]} */ t) => t[1]);
          
          if (!filterValues.some((/** @type {string} */ fv) => eventTagValues.includes(fv))) {
            return false;
          }
        }
      }
      return true;
    });
  }
}
