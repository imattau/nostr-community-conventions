/**
 * Minimal helpers for Nostr protocol framing.
 */

/**
 * Parse a Nostr protocol JSON string into an array payload.
 */
export function parseNostrMessage(messageString) {
  try {
    const payload = JSON.parse(messageString);
    if (!Array.isArray(payload) || payload.length === 0) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Serialize a Nostr protocol message array to JSON.
 */
export function serializeNostrMessage(messageArray) {
  return JSON.stringify(messageArray);
}

/**
 * Helper to build a REQ message for subscriptions.
 */
export function createReqMessage(subId, ...filters) {
  return ['REQ', subId, ...filters];
}
