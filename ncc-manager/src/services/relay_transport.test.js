import test from "node:test";
import assert from "node:assert/strict";
import { createRelayTransport } from "./relay_transport.js";

const event = { id: "event-1", kind: 30050, pubkey: "author", created_at: 1, tags: [], content: "" };

function createFakeRelay(url) {
  return {
    async *req(filters, { signal } = {}) {
      this.filters = filters;
      if (url === "wss://slow.example") {
        await new Promise((resolve) => {
          if (signal?.aborted) return resolve();
          signal?.addEventListener("abort", resolve, { once: true });
        });
        return;
      }
      yield ["EVENT", "sub", event];
      yield ["EOSE", "sub"];
    },
    async event(_event, { signal } = {}) {
      if (url === "wss://reject.example" || signal?.aborted) throw new Error("rejected");
    },
    async close() {}
  };
}

test("query uses explicit relays, deduplicates relays, and returns events", async () => {
  const opened = [];
  const transport = createRelayTransport({ openRelay: (url) => { opened.push(url); return createFakeRelay(url); } });

  const events = await transport.query(
    ["wss://fast.example", "wss://fast.example"],
    { kinds: [30050], limit: 20 },
    { maxWait: 100 }
  );

  assert.deepEqual(events.map(({ id }) => id), [event.id]);
  assert.deepEqual(opened, ["wss://fast.example"]);
  await transport.close();
});

test("query aborts slow relay requests at the caller's maxWait", async () => {
  const transport = createRelayTransport({ openRelay: createFakeRelay });
  const started = Date.now();

  const events = await transport.query(
    ["wss://slow.example"],
    { kinds: [30050], limit: 20 },
    { maxWait: 20 }
  );

  assert.deepEqual(events, []);
  assert.ok(Date.now() - started < 500);
  await transport.close();
});

test("publish reports partial relay acceptance", async () => {
  const transport = createRelayTransport({ openRelay: createFakeRelay });
  const result = await transport.publish(
    ["wss://accept.example", "wss://reject.example"],
    event,
    { timeoutMs: 100 }
  );

  assert.deepEqual(result, { accepted: 1, total: 2 });
  await transport.close();
});

test("subscription delivers events and closes through AbortSignal", async () => {
  const transport = createRelayTransport({ openRelay: createFakeRelay });
  const events = [];
  const subscription = transport.subscribe(
    ["wss://fast.example"],
    { kinds: [30050] },
    (received) => events.push(received)
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  subscription.close();

  assert.deepEqual(events.map(({ id }) => id), [event.id]);
  await transport.close();
});
