// lib/protocol.js

/**
 * Parses an incoming WebSocket message string into a Nostr protocol message array.
 * @param {string} messageString - The raw message string from the WebSocket.
 * @returns {Array} - A Nostr protocol message array (e.g., ["EVENT", ...]) or null if invalid.
 */
export function parseNostrMessage(messageString) {
  try {
    const message = JSON.parse(messageString);
    if (!Array.isArray(message) || message.length === 0) {
      console.warn("Received invalid message format:", messageString);
      return null;
    }
    return message;
  } catch (error) {
    console.error("Failed to parse Nostr message JSON:", error, "Message:", messageString);
    return null;
  }
}

/**
 * Formats an outgoing Nostr protocol message array into a JSON string.
 * @param {Array} messageArray - The Nostr protocol message array.
 * @returns {string} - The JSON string representation of the message.
 */
export function serializeNostrMessage(messageArray) {
  return JSON.stringify(messageArray);
}

/**
 * Creates an 'OK' message for an EVENT.
 * @param {string} eventId - The ID of the event.
 * @param {boolean} accepted - Whether the event was accepted.
 * @param {string} message - A descriptive message (e.g., "stored", "duplicate", "invalid").
 * @returns {Array} - The 'OK' message array.
 */
export function createOkMessage(eventId, accepted, message) {
  return ["OK", eventId, accepted, message];
}

/**
 * Creates an 'EOSE' (End Of Stored Events) message for a REQ subscription.
 * @param {string} subId - The subscription ID.
 * @returns {Array} - The 'EOSE' message array.
 */
export function createEoseMessage(subId) {
  return ["EOSE", subId];
}

/**
 * Creates an 'EVENT' message to send to a client.
 * @param {string} subId - The subscription ID.
 * @param {object} event - The event object.
 * @returns {Array} - The 'EVENT' message array.
 */
export function createEventMessage(subId, event) {
  return ["EVENT", subId, event];
}

/**
 * Creates a 'NOTICE' message.
 * @param {string} message - The notice message.
 * @returns {Array} - The 'NOTICE' message array.
 */
export function createNoticeMessage(message) {
  return ["NOTICE", message];
}

/**
 * Creates a 'REQ' message for a client subscription.
 * @param {string} subId - The subscription ID.
 * @param {Array<object>} filters - An array of filter objects.
 * @returns {Array} - The 'REQ' message array.
 */
export function createReqMessage(subId, ...filters) {
  return ["REQ", subId, ...filters];
}
