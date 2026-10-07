import { describe, expect, it } from "vitest";
import { AiRequestQueue, TutorBusyError, queuedChat, queuedVision } from "../src/queue.js";
import type { ChatMessage, ChatOptions, ChatProvider } from "../src/types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A provider that records how many generations run at once. */
function slowProvider(deltas = 3, delayMs = 15) {
  let inFlight = 0;
  let peak = 0;
  const provider: ChatProvider = {
    name: "slow",
    async *chat(_m: ChatMessage[], _o?: ChatOptions) {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        for (let i = 0; i < deltas; i++) {
          await sleep(delayMs);
          yield `d${i} `;
        }
      } finally {
        inFlight -= 1;
      }
    },
  };
  return { provider, peak: () => peak, inFlight: () => inFlight };
}

async function drain(p: ChatProvider): Promise<string> {
  let out = "";
  for await (const d of p.chat([{ role: "user", content: "go" }])) out += d;
  return out;
}

describe("AiRequestQueue", () => {
  it("never lets more than maxConcurrent generations run at once, and serves everyone", async () => {
    const { provider, peak } = slowProvider();
    const queue = new AiRequestQueue({ maxConcurrent: 2, maxQueue: 32 });
    const q = queuedChat(provider, queue);
    const results = await Promise.all(Array.from({ length: 9 }, () => drain(q)));
    expect(results.every((r) => r === "d0 d1 d2 ")).toBe(true);
    expect(peak()).toBe(2);
    const s = queue.stats();
    expect(s.served).toBe(9);
    expect(s.running).toBe(0);
    expect(s.queued).toBe(0);
    expect(s.rejected).toBe(0);
  });

  it("refuses immediately once the line is full, with an honest retry hint", async () => {
    const { provider } = slowProvider(2, 30);
    const queue = new AiRequestQueue({ maxConcurrent: 1, maxQueue: 2 });
    const q = queuedChat(provider, queue);
    const running = [drain(q), drain(q), drain(q)]; // 1 running + 2 queued
    await sleep(5);
    await expect(drain(q)).rejects.toBeInstanceOf(TutorBusyError);
    const err = await drain(q).catch((e) => e);
    expect(err.retryAfterSec).toBeGreaterThan(0);
    await Promise.all(running); // the admitted ones still finish
    expect(queue.stats().rejected).toBe(2);
  });

  it("times a waiter out instead of letting it hang forever", async () => {
    const { provider } = slowProvider(4, 60);
    const queue = new AiRequestQueue({ maxConcurrent: 1, maxQueue: 8, queueTimeoutMs: 100 });
    const q = queuedChat(provider, queue);
    const first = drain(q);
    await sleep(5);
    await expect(drain(q)).rejects.toBeInstanceOf(TutorBusyError);
    await first;
    expect(queue.stats().timedOut).toBe(1);
  });

  it("frees the slot when the consumer stops reading mid-stream", async () => {
    const { provider } = slowProvider(50, 10);
    const queue = new AiRequestQueue({ maxConcurrent: 1, maxQueue: 8 });
    const q = queuedChat(provider, queue);
    for await (const _ of q.chat([{ role: "user", content: "go" }])) break; // abandons after 1 delta
    // The abandoned stream's finally must have released the slot.
    const { provider: p2 } = slowProvider(1, 1);
    const q2 = queuedChat(p2, queue);
    await expect(drain(q2)).resolves.toBe("d0 ");
    expect(queue.stats().running).toBe(0);
  });

  it("frees the slot when the generation throws", async () => {
    const queue = new AiRequestQueue({ maxConcurrent: 1, maxQueue: 8 });
    const boom: ChatProvider = {
      name: "boom",
      // eslint-disable-next-line require-yield
      async *chat() {
        throw new Error("model fell over");
      },
    };
    await expect(drain(queuedChat(boom, queue))).rejects.toThrow("model fell over");
    expect(queue.stats().running).toBe(0);
  });

  it("drops an aborted waiter from the line without corrupting the slot count", async () => {
    const { provider } = slowProvider(3, 40);
    const queue = new AiRequestQueue({ maxConcurrent: 1, maxQueue: 8 });
    const q = queuedChat(provider, queue);
    const first = drain(q);
    await sleep(5);
    const ac = new AbortController();
    const waiting = (async () => {
      let out = "";
      for await (const d of q.chat([{ role: "user", content: "go" }], { signal: ac.signal })) out += d;
      return out;
    })();
    await sleep(5);
    ac.abort();
    await expect(waiting).rejects.toThrow("aborted while queued");
    await first;
    await sleep(10);
    const s = queue.stats();
    expect(s.running).toBe(0);
    expect(s.queued).toBe(0);
    // The freed slot is still usable.
    await expect(drain(q)).resolves.toBe("d0 d1 d2 ");
  });

  it("vision shares the same line as chat", async () => {
    const queue = new AiRequestQueue({ maxConcurrent: 1, maxQueue: 0 });
    const { provider } = slowProvider(2, 40);
    const q = queuedChat(provider, queue);
    const chatting = drain(q);
    await sleep(5);
    const vision = queuedVision(
      { name: "v", see: async () => "seen" },
      queue,
    );
    await expect(vision.see(new Uint8Array(), "image/png", "read")).rejects.toBeInstanceOf(TutorBusyError);
    await chatting;
    await expect(vision.see(new Uint8Array(), "image/png", "read")).resolves.toBe("seen");
  });
});
