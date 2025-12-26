/**
 * Simple in-memory mock relay for testing NCC-02 resolution.
 */
export class MockRelay {
  constructor() {
    /** @type {any[]} */
    this.events = [];
  }

  /**
   * @param {any} event 
   */
  async publish(event) {
    this.events.push(event);
    return true;
  }

  /**
   * @param {any} filter 
   * @returns {Promise<any[]>}
   */
  async query(filter) {
    return this.events.filter(event => {
      if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
      if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
      
      for (const key in filter) {
        if (key.startsWith('#')) {
          const tagName = key.slice(1);
          const tagValues = filter[key];
          const eventTags = event.tags.filter((/** @type {any[]} */ t) => t[0] === tagName).map((/** @type {any[]} */ t) => t[1]);
          if (!tagValues.some((/** @type {string} */ val) => eventTags.includes(val))) return false;
        }
      }
      return true;
    });
  }
}