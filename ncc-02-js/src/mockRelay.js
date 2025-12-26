export class MockRelay {
  constructor() {
    this.events = [];
  }

  async publish(event) {
    // Basic verification
    this.events.push(event);
    return true;
  }

  async query(filter) {
    return this.events.filter(event => {
      if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
      if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
      
      // Handle tag filters like #d or #e
      for (const key in filter) {
        if (key.startsWith('#')) {
          const tagName = key.slice(1);
          const tagValues = filter[key];
          const eventTags = event.tags.filter(t => t[0] === tagName).map(t => t[1]);
          if (!tagValues.some(val => eventTags.includes(val))) return false;
        }
      }
      return true;
    });
  }
}
