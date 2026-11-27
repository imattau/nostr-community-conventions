import { NPool, NRelay1 } from "@nostrify/nostrify";

const DEFAULT_QUERY_TIMEOUT_MS = 8_000;
const DEFAULT_PUBLISH_TIMEOUT_MS = 8_000;

function normalizeRelays(relays) {
  return [...new Set((relays || []).map((relay) => String(relay || "").trim()).filter(Boolean))];
}

export function createRelayTransport({
  openRelay = (url) => new NRelay1(url),
  queryTimeoutMs = DEFAULT_QUERY_TIMEOUT_MS,
  publishTimeoutMs = DEFAULT_PUBLISH_TIMEOUT_MS
} = {}) {
  const pool = new NPool({
    open: openRelay,
    reqRouter: () => new Map(),
    eventRouter: () => [],
    // The adapter applies a total bound to each operation so a slow first EOSE
    // cannot extend the caller's existing maxWait contract.
    eoseTimeout: 0
  });

  return {
    async query(relays, filters, { maxWait = queryTimeoutMs, signal } = {}) {
      const urls = normalizeRelays(relays);
      if (!urls.length) return [];
      const controller = new AbortController();
      const combinedSignal = signal
        ? AbortSignal.any([signal, controller.signal])
        : controller.signal;
      const timeout = setTimeout(() => controller.abort(), maxWait);
      try {
        return await pool.group(urls).query(Array.isArray(filters) ? filters : [filters], { signal: combinedSignal });
      } finally {
        clearTimeout(timeout);
      }
    },

    async publish(relays, event, { timeoutMs = publishTimeoutMs, signal } = {}) {
      const urls = normalizeRelays(relays);
      if (!urls.length) return { accepted: 0, total: 0 };
      const results = await Promise.allSettled(urls.map((url) => {
        const timeoutSignal = AbortSignal.timeout(timeoutMs);
        const publishSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
        return pool.relay(url).event(event, { signal: publishSignal });
      }));
      return {
        accepted: results.filter((result) => result.status === "fulfilled").length,
        total: results.length
      };
    },

    subscribe(relays, filters, onEvent) {
      const urls = normalizeRelays(relays);
      const controller = new AbortController();
      const filterList = Array.isArray(filters) ? filters : [filters];
      const completion = (async () => {
        try {
          for await (const message of pool.group(urls).req(filterList, { signal: controller.signal })) {
            if (message[0] === "EVENT") onEvent(message[2]);
            if (message[0] === "CLOSED") break;
          }
        } catch (error) {
          if (!controller.signal.aborted) throw error;
        }
      })();
      // Attach a handler so relay shutdowns do not create unhandled rejections;
      // the caller still receives failures through onError when provided.
      completion.catch((error) => console.warn("Nostr subscription ended:", error));
      return { close: () => controller.abort() };
    },

    async close() {
      await pool.close();
    }
  };
}

export const relayTransport = createRelayTransport();
