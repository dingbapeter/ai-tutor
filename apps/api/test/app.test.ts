import { describe, expect, it, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  MockChatProvider,
  MockSttProvider,
  MockTtsProvider,
  MockVisionProvider,
} from "@tutor/ai-gateway";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/store/memory.js";

/**
 * Integration tests over the real Fastify app with mock AI + in-memory store:
 * the full session lifecycle, validation, and the cross-session memory loop.
 */

let app: FastifyInstance;

function gateway() {
  return {
    chat: new MockChatProvider(),
    planner: new MockChatProvider(),
    stt: new MockSttProvider(),
    tts: new MockTtsProvider(),
    vision: new MockVisionProvider(),
  };
}

beforeAll(async () => {
  app = await buildApp({
    gateway: gateway(),
    store: new MemoryStore(),
    env: { NODE_ENV: "test", RATE_LIMIT_MAX: "10000" },
  });
});

async function createSession(studentName = "Ada", parentEmail?: string) {
  const res = await app.inject({
    method: "POST",
    url: "/sessions",
    payload: { studentName, personaId: "amara", packId: "math-ms", parentEmail },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { sessionId: string; remembered: number };
}

describe("platform basics", () => {
  it("reports health with provider + store names", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.json()).toMatchObject({ ok: true, store: "memory" });
  });

  it("lists personas and packs", async () => {
    expect((await app.inject({ url: "/personas" })).json()).toHaveLength(3);
    expect((await app.inject({ url: "/packs" })).json()).toHaveLength(3);
  });

  it("serves problems without leaking answers or misconceptions", async () => {
    const res = await app.inject({ url: "/packs/math-ms/problems" });
    for (const p of res.json() as Array<Record<string, unknown>>) {
      expect(p).not.toHaveProperty("answer");
      expect(p).not.toHaveProperty("misconceptions");
      expect(p).not.toHaveProperty("check");
    }
  });
});

describe("validation & error paths", () => {
  it("rejects unknown persona, unknown pack, and malformed bodies", async () => {
    const bad = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { studentName: "Ada", personaId: "nobody", packId: "math-ms" },
    });
    expect(bad.statusCode).toBe(400);

    const badPack = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { studentName: "Ada", personaId: "amara", packId: "../etc/passwd" },
    });
    expect(badPack.statusCode).toBe(400);

    const noBody = await app.inject({ method: "POST", url: "/sessions", payload: {} });
    expect(noBody.statusCode).toBe(400);
  });

  it("rejects oversized messages and 404s unknown sessions", async () => {
    const { sessionId } = await createSession();
    const tooLong = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/message`,
      payload: { text: "x".repeat(5000) },
    });
    expect(tooLong.statusCode).toBe(400);

    const gone = await app.inject({
      method: "POST",
      url: "/sessions/00000000-0000-0000-0000-000000000000/message",
      payload: { text: "hi" },
    });
    expect(gone.statusCode).toBe(404);
  });
});

describe("session lifecycle", () => {
  it("streams SSE deltas that assemble into the tutor's reply", async () => {
    const { sessionId } = await createSession("Bola");
    const res = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/message`,
      payload: { text: "help me with fractions" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const deltas = [...res.body.matchAll(/data: (\{.*\})/g)]
      .map((m) => JSON.parse(m[1]))
      .filter((e) => e.delta)
      .map((e) => e.delta)
      .join("");
    expect(deltas.length).toBeGreaterThan(20);
    expect(res.body).toContain('"done":true');
  });

  it("verifies practice answers, tracks mastery, and diagnoses misconceptions", async () => {
    const { sessionId } = await createSession("Chi");
    // mathcheck service is not running in tests → falls back to answer-key compare
    const wrong = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/practice`,
      payload: { problemIndex: 0, answer: "7" },
    });
    expect(wrong.json().correct).toBe(false);

    const right = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/practice`,
      payload: { problemIndex: 0, answer: "4" },
    });
    expect(right.json().correct).toBe(true);

    const end = await app.inject({ method: "POST", url: `/sessions/${sessionId}/end` });
    const mastery = end.json().mastery as Array<{ skillId: string; level: number }>;
    expect(mastery).toHaveLength(1);
    expect(mastery[0].skillId).toBe("math-ms.linear-eq.two-step");
    expect(mastery[0].level).toBeGreaterThan(0);
  });

  it("carries memories from one session into the next (the core promise)", async () => {
    const first = await createSession("Dayo", "parent@example.com");
    await app.inject({
      method: "POST",
      url: `/sessions/${first.sessionId}/message`,
      payload: { text: "I keep messing up negative numbers" },
    });
    const end = await app.inject({ method: "POST", url: `/sessions/${first.sessionId}/end` });
    expect(end.statusCode).toBe(200);
    expect(end.json().recap.length).toBeGreaterThan(10);
    expect(end.json().emailStatus).toBe("skipped"); // no SMTP in tests

    const second = await createSession("Dayo", "parent@example.com");
    expect(second.remembered).toBeGreaterThan(0);
  });

  it("remembers even when the model refuses to extract memories (weak-model resilience)", async () => {
    // Regression: a real 0.5B model answered NONE to the extraction prompt,
    // which silently broke the memory promise. The deterministic factual line
    // must guarantee continuity regardless of model quality.
    const noneChat = {
      name: "none",
      async *chat() {
        yield "NONE";
      },
    };
    const isolated = await buildApp({
      gateway: { ...gateway(), planner: noneChat },
      store: new MemoryStore(),
      env: { NODE_ENV: "test", RATE_LIMIT_MAX: "10000" },
    });
    const create = await isolated.inject({
      method: "POST",
      url: "/sessions",
      payload: { studentName: "Femi", personaId: "amara", packId: "math-ms" },
    });
    const { sessionId } = create.json();
    await isolated.inject({
      method: "POST",
      url: `/sessions/${sessionId}/message`,
      payload: { text: "negatives confuse me" },
    });
    await isolated.inject({ method: "POST", url: `/sessions/${sessionId}/end` });

    const again = await isolated.inject({
      method: "POST",
      url: "/sessions",
      payload: { studentName: "Femi", personaId: "amara", packId: "math-ms" },
    });
    expect(again.json().remembered).toBeGreaterThan(0);
    await isolated.close();
  });

  it("keeps two families' same-named students separate", async () => {
    const a = await createSession("Sam", "family-a@example.com");
    await app.inject({ method: "POST", url: `/sessions/${a.sessionId}/end` });
    const b = await createSession("Sam", "family-b@example.com");
    expect(b.remembered).toBe(0); // family B's Sam must not inherit family A's memories
  });

  it("404s a double end-session instead of double-processing", async () => {
    const { sessionId } = await createSession("Efe");
    expect((await app.inject({ method: "POST", url: `/sessions/${sessionId}/end` })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/sessions/${sessionId}/end` })).statusCode).toBe(404);
  });

  it("produces a playable WAV voice note via /tts", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/tts",
      payload: { text: "Well done!", personaId: "amara" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("audio/");
    expect(res.rawPayload.subarray(0, 4).toString()).toBe("RIFF");
  });
});
