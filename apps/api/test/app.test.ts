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

  it("handles a push-to-talk voice turn: audio in → transcript + reply + audio out", async () => {
    const { sessionId } = await createSession("Gozie");
    const res = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/voice`,
      headers: { "content-type": "audio/webm" },
      payload: Buffer.from([1, 2, 3, 4, 5]),
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.transcript).toContain("mock transcription");
    expect(json.reply.length).toBeGreaterThan(10);
    expect(Buffer.from(json.audio, "base64").subarray(0, 4).toString()).toBe("RIFF");
    expect(json.audioMime).toBe("audio/wav");
  });

  it("rejects an empty voice upload", async () => {
    const { sessionId } = await createSession("Hafsat");
    const res = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/voice`,
      headers: { "content-type": "audio/webm" },
      payload: Buffer.alloc(0),
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts learning-format requests and rejects unknown formats", async () => {
    const { sessionId } = await createSession("Ify");
    const ok = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/message`,
      payload: { text: "explain fractions", format: "story" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain('"done":true');

    const bad = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/message`,
      payload: { text: "explain fractions", format: "hologram" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("runs the full family account lifecycle: register → add child → session → dashboard", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "mum@example.com", password: "sunshine123", displayName: "Mum", role: "parent" },
    });
    expect(reg.statusCode).toBe(200);
    const token = reg.json().token as string;
    const auth = { authorization: `Bearer ${token}` };

    const dup = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "mum@example.com", password: "different1", role: "parent" },
    });
    expect(dup.statusCode).toBe(409);

    const child = await app.inject({ method: "POST", url: "/students", headers: auth, payload: { displayName: "Nia" } });
    expect(child.statusCode).toBe(200);
    const studentId = child.json().id as string;

    const me = await app.inject({ method: "GET", url: "/me", headers: auth });
    expect(me.json().students).toHaveLength(1);

    const session = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: auth,
      payload: { studentId, personaId: "amara", packId: "math-ms" },
    });
    expect(session.statusCode).toBe(200);
    const sid = session.json().sessionId;
    await app.inject({ method: "POST", url: `/sessions/${sid}/practice`, payload: { problemIndex: 0, answer: "4" } });
    await app.inject({ method: "POST", url: `/sessions/${sid}/end` });

    const dash = await app.inject({ method: "GET", url: "/dashboard", headers: auth });
    const nia = dash.json().students.find((s: { displayName: string }) => s.displayName === "Nia");
    expect(nia.sessions.length).toBeGreaterThan(0);
    expect(nia.sessions[0].summary).toBeTruthy();
    expect(nia.mastery[0].level).toBeGreaterThan(0);
  });

  it("enforces auth boundaries: bad login, no token, someone else's child", async () => {
    const wrong = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "mum@example.com", password: "not-the-password" },
    });
    expect(wrong.statusCode).toBe(401);

    expect((await app.inject({ method: "GET", url: "/dashboard" })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "GET", url: "/me", headers: { authorization: "Bearer deadbeef" } })).statusCode,
    ).toBe(401);

    const stranger = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "stranger@example.com", password: "password99", role: "parent" },
    });
    const strangerAuth = { authorization: `Bearer ${stranger.json().token}` };
    const mum = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "mum@example.com", password: "sunshine123" },
    });
    const mumAuth = { authorization: `Bearer ${mum.json().token}` };
    const nia = (await app.inject({ method: "GET", url: "/me", headers: mumAuth })).json().students[0];

    const theft = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: strangerAuth,
      payload: { studentId: nia.id, personaId: "amara", packId: "math-ms" },
    });
    expect(theft.statusCode).toBe(403);
  });

  it("gives adult self-learners their own student profile on registration", async () => {
    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "adult@example.com", password: "learning42", displayName: "Tunde", role: "student" },
    });
    expect(reg.json().studentId).toBeTruthy();
    const session = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: { authorization: `Bearer ${reg.json().token}` },
      payload: { studentId: reg.json().studentId, personaId: "kofi", packId: "exam-prep" },
    });
    expect(session.statusCode).toBe(200);
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
