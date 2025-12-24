// A simple pub/sub event emitter.

const events = {};

export const eventBus = {
  /**
   * Subscribes to an event.
   * @param {string} eventName 
   * @param {Function} callback 
   * @returns {Function} An unsubscribe function.
   */
  on: (eventName, callback) => {
    if (!events[eventName]) {
      events[eventName] = [];
    }
    events[eventName].push(callback);
    return () => {
      events[eventName] = events[eventName].filter(cb => cb !== callback);
    };
  },

  /**
   * Emits an event, calling all subscribed callbacks.
   * @param {string} eventName 
   * @param {*} payload 
   */
  emit: (eventName, payload) => {
    if (events[eventName]) {
      events[eventName].forEach(callback => callback(payload));
    }
  }
};
