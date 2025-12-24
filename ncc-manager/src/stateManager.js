// A simple state manager with a subscription model.
const subscribers = [];

const state = {
  theme: "power",
  // All other state properties will be populated by main.js
};

export const stateManager = {
  getState: () => state,
  
  updateState: (newState) => {
    Object.assign(state, newState);
    subscribers.forEach(callback => callback(state));
  },

  subscribe: (callback) => {
    subscribers.push(callback);
    // Return an unsubscribe function
    return () => {
      const index = subscribers.indexOf(callback);
      if (index > -1) {
        subscribers.splice(index, 1);
      }
    };
  }
};
