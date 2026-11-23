import { describe, expect, it, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  MockChatProvider,
  MockSttProvider,
  MockTtsProvider,
  MockVisionProvider,
  RulesModerationProvider,
} from "@tutor/ai-gateway";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/store/memory.js";

/**
 * Sessions that survive. Two app instances share one store, standing in for
 * a restart or a second server behind the same database. A conversation
 * started on the first must continue on the second with its history, its
 * language, its owner and its metering intact.
 */

function gateway() {
  const planner = new MockChatProvider();
  return {
    chat: new MockChatProvider(),
    planner,
    premiumChat: planner,
    stt: new MockSttProvider(),
    tts: new MockTtsProvider(),
    vision: new MockVisionProvider(),
    moderation: new RulesModerationProvider(),
  };
}

const ENV = { NODE_ENV: "test", RATE_LIMIT_MAX: "10000", GUEST_IP_CAP: "100000", AUTH_RATE_LIMIT: "100000" };

/** The message route streams SSE; stitch the deltas back into the reply. */
function readStream(body: string): { reply: string } {
  let reply = "";
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const event = JSON.parse(line.slice(6)) as { delta?: string };
    if (event.delta) reply += event.delta;
  }
  return { reply };
}

let store: MemoryStore;
let first: FastifyInstance;
let second: FastifyInstance;

beforeAll(async () => {
  store = new MemoryStore();
  first = await buildApp({ gateway: gateway(), store, env: ENV });
  // The "restarted server": a brand new process image over the same store.
  second = await buildApp({ gateway: gateway(), store, env: ENV });
});

describe("a conversation across a restart", () => {
  it("continues on a fresh process with its history intact", async () => {
    const created = await first.inject({
      method: "POST",
      url: "/sessions",
      payload: { studentName: "Ada", personaId: "kofi", packId: "math-ms", parentEmail: "resume@example.com", language: "es" },
    });
    expect(created.statusCode).toBe(200);
    const { sessionId } = created.json();

    const before = await first.inject({
      method: "POST",
      url: `/sessions/${sessionId}/message`,
      payload: { text: "my dog is called Biscuit and I am stuck on equations" },
    });
    expect(before.statusCode).toBe(200);

    // The first server is gone. The second has never seen this session.
    const after = await second.inject({
      method: "POST",
      url: `/sessions/${sessionId}/message`,
      payload: { text: "still there?" },
    });
    expect(after.statusCode).toBe(200);
    expect(readStream(after.body).reply.length).toBeGreaterThan(0);

    // Everything said before the restart is still on the record, in order.
    const student = await store.getSessionMeta(sessionId);
    const transcript = await store.listSessionMessages(sessionId);
    const texts = transcript.map((m) => m.content);
    expect(texts).toContain("my dog is called Biscuit and I am stuck on equations");
    expect(texts).toContain("still there?");
    expect(texts.indexOf("my dog is called Biscuit and I am stuck on equations")).toBeLessThan(texts.indexOf("still there?"));

    // The session's identity survived too: persona, language, guardian.
    expect(student).toMatchObject({ personaId: "kofi", language: "es", parentEmail: "resume@example.com" });
  });

  it("serves a voice turn on the fresh process, language intact", async () => {
    const created = await first.inject({
      method: "POST",
      url: "/sessions",
      payload: { studentName: "Ada", personaId: "amara", packId: "math-ms", language: "es" },
    });
    const { sessionId } = created.json();

    // A spoken turn straight at the second server: audio in, audio out.
    const after = await second.inject({
      method: "POST",
      url: `/sessions/${sessionId}/voice`,
      headers: { "content-type": "audio/webm" },
      payload: Buffer.from("fake-opus-bytes"),
    });
    expect(after.statusCode).toBe(200);
    const body = after.json();
    expect(body.transcript.length).toBeGreaterThan(0);
    expect(body.reply.length).toBeGreaterThan(0);
    expect(body.audio.length).toBeGreaterThan(0);

    // The session's language crossed the restart with it.
    expect((await store.getSessionMeta(sessionId))!.language).toBe("es");
  });

  it("keeps the owner's plan limits attached to a resumed account session", async () => {
    const reg = await first.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "limits@example.com", password: "correct-horse-battery", role: "student", displayName: "Zee" },
    });
    const { token, studentId } = reg.json();
    const created = await first.inject({
      method: "POST",
      url: "/sessions",
      headers: { authorization: `Bearer ${token}` },
      payload: { studentId, personaId: "amara", packId: "math-ms" },
    });
    const { sessionId } = created.json();

    const account = await store.getAccountByEmail("limits@example.com");
    const usedBefore = await store.sumUsage({ userId: account!.userId }, "message", new Date(Date.now() - 60_000));

    const after = await second.inject({
      method: "POST",
      url: `/sessions/${sessionId}/message`,
      payload: { text: "counting this one" },
    });
    expect(after.statusCode).toBe(200);

    // The turn on the second server was metered to the same owner.
    const usedAfter = await store.sumUsage({ userId: account!.userId }, "message", new Date(Date.now() - 60_000));
    expect(usedAfter).toBe(usedBefore + 1);
  });

  it("refuses to raise the dead: an ended session stays ended", async () => {
    const created = await first.inject({
      method: "POST",
      url: "/sessions",
      payload: { studentName: "Ada", personaId: "amara", packId: "math-ms" },
    });
    const { sessionId } = created.json();
    expect((await first.inject({ method: "POST", url: `/sessions/${sessionId}/end` })).statusCode).toBe(200);

    const afterEnd = await second.inject({
      method: "POST",
      url: `/sessions/${sessionId}/message`,
      payload: { text: "one more thing" },
    });
    expect(afterEnd.statusCode).toBe(404);
  });

  it("404s an id that never existed instead of inventing a session", async () => {
    const res = await second.inject({
      method: "POST",
      url: "/sessions/00000000-0000-0000-0000-000000000000/message",
      payload: { text: "hello?" },
    });
    expect(res.statusCode).toBe(404);
  });
});
