import { describe, expect, it } from "vitest";
import {
  MAX_WAITING,
  STALE_AFTER_MS,
  enqueue,
  loadQueue,
  newId,
  partitionStale,
  readyFor,
  remove,
  saveQueue,
  shouldWait,
  waitingLine,
  type Outgoing,
} from "../app/learn/outbox";

const msg = (id: string, at: number, sessionId = "s1"): Outgoing => ({
  id, sessionId, text: `q${id}`, format: "plain", queuedAt: at,
});

describe("the outbox: a child's question is never quietly lost", () => {
  it("waits for the connection, but never retries an answer the server gave", () => {
    // The network died mid-send: that is worth waiting for.
    expect(shouldWait({ threw: true })).toBe(true);
    // The server spoke. Out of messages today, session over, not signed in:
    // resending would be dishonest and would spend the family's allowance.
    expect(shouldWait({ threw: false, status: 402 })).toBe(false);
    expect(shouldWait({ threw: false, status: 404 })).toBe(false);
    expect(shouldWait({ threw: false, status: 500 })).toBe(false);
    expect(shouldWait({ threw: true, status: 503 })).toBe(false);
  });

  it("keeps order, refuses duplicates, and stops at a sane size", () => {
    let q: Outgoing[] = [];
    q = enqueue(q, msg("a", 1)).queue;
    q = enqueue(q, msg("b", 2)).queue;
    expect(q.map((m) => m.id)).toEqual(["a", "b"]);

    // The same message pressed twice is still one message.
    const again = enqueue(q, msg("a", 3));
    expect(again.accepted).toBe(false);
    expect(again.queue).toHaveLength(2);

    // A phone offline for an hour must not fill the browser's store.
    let full: Outgoing[] = [];
    for (let i = 0; i < MAX_WAITING; i++) full = enqueue(full, msg(`m${i}`, i)).queue;
    const overflow = enqueue(full, msg("one-too-many", 999));
    expect(overflow.accepted).toBe(false);
    expect(overflow.queue).toHaveLength(MAX_WAITING);
  });

  it("drops one only once it truly went, and leaves the rest alone", () => {
    const q = [msg("a", 1), msg("b", 2), msg("c", 3)];
    expect(remove(q, "b").map((m) => m.id)).toEqual(["a", "c"]);
    expect(remove(q, "nope")).toHaveLength(3);
  });

  it("lets go of questions too old to be worth answering", () => {
    const now = 10 * 60 * 60 * 1000;
    const { fresh, stale } = partitionStale(
      [msg("old", now - STALE_AFTER_MS - 1), msg("edge", now - STALE_AFTER_MS), msg("new", now - 60_000)],
      now,
    );
    expect(stale.map((m) => m.id)).toEqual(["old", "edge"]);
    expect(fresh.map((m) => m.id)).toEqual(["new"]);
  });

  it("sends the first thought before the second, and only for this session", () => {
    const q = [msg("later", 500), msg("other", 100, "s2"), msg("first", 100)];
    expect(readyFor(q, "s1").map((m) => m.id)).toEqual(["first", "later"]);
    expect(readyFor(q, "s2").map((m) => m.id)).toEqual(["other"]);
  });

  it("tells the learner plainly, and says nothing when there is nothing to say", () => {
    expect(waitingLine(0)).toBe("");
    expect(waitingLine(1)).toContain("1 message is waiting");
    expect(waitingLine(3)).toContain("3 messages are waiting");
  });

  it("survives a browser that will not remember, in either direction", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    saveQueue(storage, [msg("a", 1)]);
    expect(loadQueue(storage).map((m) => m.id)).toEqual(["a"]);

    // Private mode and a full disk both throw; neither may break the lesson.
    const refusing = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    };
    expect(() => saveQueue(refusing, [msg("a", 1)])).not.toThrow();
    expect(loadQueue(refusing)).toEqual([]);
    expect(loadQueue(undefined)).toEqual([]);

    // Rubbish in storage is not a crash, it is an empty queue.
    mem.set("dingba_outbox", "{not json");
    expect(loadQueue(storage)).toEqual([]);
    mem.set("dingba_outbox", '[{"id":"ok","sessionId":"s","text":"t","format":"plain","queuedAt":1},{"bad":true}]');
    expect(loadQueue(storage).map((m) => m.id)).toEqual(["ok"]);
  });

  it("makes ids without crypto.randomUUID, which older Safari does not have", () => {
    expect(newId(1, 0.5)).not.toBe(newId(2, 0.5));
    expect(newId(1, 0.1)).not.toBe(newId(1, 0.9));
    expect(newId(Date.now())).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
  });
});
