// relay/store.js
import { verifyEvent, validateEvent, getPublicKey } from 'nostr-tools/pure';

class EventStore {
  constructor() {
    this.events = new Map(); // Store events by event.id
    this.eventsByKind = new Map(); // Store event IDs by kind for efficient filtering
    this.eventsByAuthor = new Map(); // Store event IDs by author for efficient filtering
    this.eventsByTag = new Map(); // Store event IDs by tag for efficient filtering (e.g., #d, #e)
  }

  /**
   * Adds an event to the store after validation and verification.
   * @param {object} event - The Nostr event object.
   * @returns {Array} - [event.id, boolean, string] indicating success/failure and message.
   */
  addEvent(event) {
    try {
      if (!validateEvent(event)) {
        return [event.id, false, "invalid: event failed validation"];
      }
      if (!verifyEvent(event)) {
        return [event.id, false, "invalid: event failed signature verification"];
      }

      if (this.events.has(event.id)) {
        return [event.id, true, "duplicate: event already exists"];
      }

      this.events.set(event.id, event);

      // Index by kind
      if (!this.eventsByKind.has(event.kind)) {
        this.eventsByKind.set(event.kind, new Set());
      }
      this.eventsByKind.get(event.kind).add(event.id);

      // Index by author
      if (!this.eventsByAuthor.has(event.pubkey)) {
        this.eventsByAuthor.set(event.pubkey, new Set());
      }
      this.eventsByAuthor.get(event.pubkey).add(event.id);

      // Index by tags (for #d, #e, etc.)
      event.tags.forEach(tag => {
        if (tag.length >= 2) {
          const tagName = tag[0];
          const tagValue = tag[1];
          const tagKey = `#${tagName}:${tagValue}`;
          if (!this.eventsByTag.has(tagKey)) {
            this.eventsByTag.set(tagKey, new Set());
          }
          this.eventsByTag.get(tagKey).add(event.id);
        }
      });

      return [event.id, true, "stored"];
    } catch (error) {
      console.error("Error adding event:", error);
      return [event.id, false, `error: ${error.message}`];
    }
  }

  /**
   * Queries events from the store based on an array of filters.
   * Filters are OR-ed, but conditions within a single filter are AND-ed.
   * @param {Array<object>} filters - An array of filter objects.
   * @returns {Array<object>} - An array of matching event objects.
   */
  queryEvents(filters) {
    let matchingEventIds = new Set();

    if (!filters || filters.length === 0) {
      // If no filters, return all events (or none, depending on desired behavior for empty filter - here, all)
      return Array.from(this.events.values());
    }

    filters.forEach(filter => {
      let currentFilterEventIds = new Set(this.events.keys()); // Start with all events for this filter

      if (filter.ids && filter.ids.length > 0) {
        currentFilterEventIds = new Set(Array.from(currentFilterEventIds).filter(id => filter.ids.includes(id)));
      }

      if (filter.kinds && filter.kinds.length > 0) {
        let kindFilteredIds = new Set();
        filter.kinds.forEach(kind => {
          if (this.eventsByKind.has(kind)) {
            this.eventsByKind.get(kind).forEach(id => kindFilteredIds.add(id));
          }
        });
        currentFilterEventIds = new Set(Array.from(currentFilterEventIds).filter(id => kindFilteredIds.has(id)));
      }

      if (filter.authors && filter.authors.length > 0) {
        let authorFilteredIds = new Set();
        filter.authors.forEach(author => {
          if (this.eventsByAuthor.has(author)) {
            this.eventsByAuthor.get(author).forEach(id => authorFilteredIds.add(id));
          }
        });
        currentFilterEventIds = new Set(Array.from(currentFilterEventIds).filter(id => authorFilteredIds.has(id)));
      }

      // Tag filtering (e.g., #d, #e)
      for (const key in filter) {
        if (key.startsWith('#') && Array.isArray(filter[key]) && filter[key].length > 0) {
          const tagName = key.substring(1); // Remove '#'
          let tagFilteredIds = new Set();
          filter[key].forEach(tagValue => {
            const tagKey = `#${tagName}:${tagValue}`;
            if (this.eventsByTag.has(tagKey)) {
              this.eventsByTag.get(tagKey).forEach(id => tagFilteredIds.add(id));
            }
          });
          currentFilterEventIds = new Set(Array.from(currentFilterEventIds).filter(id => tagFilteredIds.has(id)));
        }
      }

      // Apply since/until
      currentFilterEventIds = new Set(Array.from(currentFilterEventIds).filter(id => {
        const event = this.events.get(id);
        return (!filter.since || event.created_at >= filter.since) &&
               (!filter.until || event.created_at <= filter.until);
      }));

      // Add results of this filter to the overall matching set
      currentFilterEventIds.forEach(id => matchingEventIds.add(id));
    });

    // Retrieve full event objects and sort them (e.g., by created_at descending)
    const result = Array.from(matchingEventIds).map(id => this.events.get(id));
    // Sort by created_at descending, per NIP-01 best practices for REQ
    result.sort((a, b) => b.created_at - a.created_at);

    return result;
  }

  // Helper to get an event by ID (useful for other modules)
  getEventById(id) {
    return this.events.get(id);
  }
}

export const eventStore = new EventStore();
