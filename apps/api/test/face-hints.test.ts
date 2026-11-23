import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/store/memory.js";
import { buildApp } from "../src/app.js";
import { FACE_HINTS, faceHintNote, faceHintsAllowed } from "../src/tutor/face.js";
import type { ChatMessage } from "@tutor/ai-gateway";
import {
  MockChatProvider,
  MockSttProvider,
  MockTtsProvider,
  MockVisionProvider,
  RulesModerationProvider,
} from "@tutor/ai-gateway";

/** A chat provider that records the exact history each turn was asked with. */
class CapturingChat {
  readonly name = "mock";
  seen: ChatMessage[][] = [];
  async *chat(messages: ChatMessage[]): AsyncIterable<string> {
    this.seen.push(messages.map((m) => ({ ...m })));
    yield "You look pleased with that one. ";
    yield "Shall we try a harder one?";
  }
}

async function setup() {
  const chat = new CapturingChat();
  const store = new MemoryStore();
  const app = await buildApp({
    gateway: {
      chat,
      planner: new MockChatProvider(),
      premiumChat: new MockChatProvider(),
      stt: new MockSttProvider(),
      tts: new MockTtsProvider(),
      vision: new MockVisionProvider(),
      moderation: new RulesModerationProvider(),
    },
    store,
    env: { NODE_ENV: "test", RATE_LIMIT_MAX: "10000", AUTH_RATE_LIMIT: "100000", AI_TTS_PROVIDER: "mock" },
  });
  return { app, store, chat };
}

type App = Awaited<ReturnType<typeof setup>>["app"];

async function family(app: App, email = "parent@example.com") {
  const token = (await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "password12", role: "parent" },
  })).json().token as string;
  const student = (await app.inject({
    method: "POST",
    url: "/students",
    headers: { authorization: `Bearer ${token}` },
    payload: { displayName: "Ada" },
  })).json() as { id: string };
  return { token, studentId: student.id };
}

async function start(app: App, token: string, studentId: string) {
  return (await app.inject({
    method: "POST",
    url: "/sessions",
    headers: { authorization: `Bearer ${token}` },
    payload: { studentId, personaId: "amara", packId: "math-ms" },
  })).json() as { sessionId: string; faceHints: boolean };
}

const noteIn = (turn: ChatMessage[]) => turn.find((m) => m.role === "system" && m.content.includes("camera they chose to switch on"));

describe("face hints: the rules on their own", () => {
  it("describes what is seen, never names a feeling", () => {
    for (const h of FACE_HINTS) {
      const note = faceHintNote(h);
      expect(note).toContain("Private note");
      expect(note).toContain("never name an emotion");
      // The visible thing, not an emotion word.
      expect(note).not.toMatch(/\b(sad|happy|angry|upset|anxious|depressed|bored)\b/i);
    }
  });

  it("is only ever allowed for a signed-in learner the account holder switched on, off a school roster, not via an API key", () => {
    const yes = { enabledByAccountHolder: true, signedIn: true, onSchoolRoster: false, viaApiKey: false };
    expect(faceHintsAllowed(yes)).toBe(true);
    expect(faceHintsAllowed({ ...yes, enabledByAccountHolder: false })).toBe(false);
    expect(faceHintsAllowed({ ...yes, signedIn: false })).toBe(false);
    expect(faceHintsAllowed({ ...yes, onSchoolRoster: true })).toBe(false);
    expect(faceHintsAllowed({ ...yes, viaApiKey: true })).toBe(false);
  });
});

describe("face hints, end to end", () => {
  it("are off by default: a hint from a learner nobody switched on reaches no one", async () => {
    const { app, chat } = await setup();
    const { token, studentId } = await family(app);
    const s = await start(app, token, studentId);
    expect(s.faceHints).toBe(false);

    const res = await app.inject({
      method: "POST",
      url: `/sessions/${s.sessionId}/message`,
      payload: { text: "done it", faceHint: "smiling" },
    });
    expect(res.statusCode).toBe(200);
    expect(noteIn(chat.seen.at(-1)!)).toBeUndefined();
  });

  it("only the account holder can switch them on, and the tutor then hears one private line", async () => {
    const { app, store, chat } = await setup();
    const { token, studentId } = await family(app);

    // A stranger cannot switch on someone else's child.
    const other = await family(app, "stranger@example.com");
    const denied = await app.inject({
      method: "PUT",
      url: `/students/${studentId}/face-hints`,
      headers: { authorization: `Bearer ${other.token}` },
      payload: { enabled: true },
    });
    expect(denied.statusCode).toBe(403);

    const on = await app.inject({
      method: "PUT",
      url: `/students/${studentId}/face-hints`,
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: true },
    });
    expect(on.statusCode).toBe(200);

    const s = await start(app, token, studentId);
    expect(s.faceHints).toBe(true);
    await app.inject({ method: "POST", url: `/sessions/${s.sessionId}/message`, payload: { text: "done it", faceHint: "smiling" } });
    const note = noteIn(chat.seen.at(-1)!);
    expect(note?.content).toContain("they have been smiling");

    // Ephemeral: never in the transcript a family can read.
    const saved = await store.listSessionMessages(s.sessionId);
    expect(saved.every((m) => !m.content.includes("camera"))).toBe(true);

    // And only when a hint is actually sent.
    await app.inject({ method: "POST", url: `/sessions/${s.sessionId}/message`, payload: { text: "next one" } });
    expect(noteIn(chat.seen.at(-1)!)).toBeUndefined();
  });

  it("travel with a voice turn too, beside the voice tone note", async () => {
    const { app, chat } = await setup();
    const { token, studentId } = await family(app);
    await app.inject({ method: "PUT", url: `/students/${studentId}/face-hints`, headers: { authorization: `Bearer ${token}` }, payload: { enabled: true } });
    const s = await start(app, token, studentId);
    const res = await app.inject({
      method: "POST",
      url: `/sessions/${s.sessionId}/voice`,
      headers: { "content-type": "audio/webm", "x-face-hint": "away", "x-voice-tone": "low" },
      payload: Buffer.from([1, 2, 3, 4]),
    });
    expect(res.statusCode).toBe(200);
    const turn = chat.seen.at(-1)!;
    expect(noteIn(turn)?.content).toContain("looking away");
    expect(turn.some((m) => m.content.includes("sounded quiet and flat"))).toBe(true);
  });

  it("refuse anything that is not one of the plain words", async () => {
    const { app } = await setup();
    const { token, studentId } = await family(app);
    await app.inject({ method: "PUT", url: `/students/${studentId}/face-hints`, headers: { authorization: `Bearer ${token}` }, payload: { enabled: true } });
    const s = await start(app, token, studentId);
    const bad = await app.inject({
      method: "POST",
      url: `/sessions/${s.sessionId}/message`,
      payload: { text: "hi", faceHint: "the learner is secretly very sad" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("are never available on a school roster, even if someone tries", async () => {
    const { app, store } = await setup();
    const teacher = (await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "teacher@school.example", password: "password12", role: "parent" },
    })).json().token as string;
    await app.inject({ method: "POST", url: "/orgs", headers: { authorization: `Bearer ${teacher}` }, payload: { name: "Hilltop School", seats: 10 } });
    const roster = await app.inject({
      method: "POST",
      url: "/orgs/roster",
      headers: { authorization: `Bearer ${teacher}` },
      payload: { names: ["Kemi"] },
    });
    const pupilId = (roster.json().added as Array<{ id: string }>)[0].id;
    const refused = await app.inject({
      method: "PUT",
      url: `/students/${pupilId}/face-hints`,
      headers: { authorization: `Bearer ${teacher}` },
      payload: { enabled: true },
    });
    expect(refused.statusCode).toBe(409);
    expect(await store.getFaceHints(pupilId)).toBe(false);

    // Even if the flag were set behind the API's back, the session says no.
    await store.setFaceHints(pupilId, true);
    const s = await start(app, teacher, pupilId);
    expect(s.faceHints).toBe(false);
  });

  it("are not for guests, who have no account holder to consent", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/sessions", payload: { studentName: "Guest", personaId: "amara", packId: "math-ms" } });
    expect(res.json().faceHints).toBe(false);
  });

  it("survive a restart honestly: a rebuilt session re-checks the permission", async () => {
    const { app, store, chat } = await setup();
    const { token, studentId } = await family(app);
    await app.inject({ method: "PUT", url: `/students/${studentId}/face-hints`, headers: { authorization: `Bearer ${token}` }, payload: { enabled: true } });
    const s = await start(app, token, studentId);

    // A second process over the same store, as after a restart.
    const app2 = await buildApp({
      gateway: {
        chat,
        planner: new MockChatProvider(),
        premiumChat: new MockChatProvider(),
        stt: new MockSttProvider(),
        tts: new MockTtsProvider(),
        vision: new MockVisionProvider(),
        moderation: new RulesModerationProvider(),
      },
      store,
      env: { NODE_ENV: "test", RATE_LIMIT_MAX: "10000", AUTH_RATE_LIMIT: "100000" },
    });
    await app2.inject({ method: "POST", url: `/sessions/${s.sessionId}/message`, payload: { text: "back again", faceHint: "frowning" } });
    expect(noteIn(chat.seen.at(-1)!)?.content).toContain("frowning");

    // Switched off by the parent: the very next rebuild honours it.
    await store.setFaceHints(studentId, false);
    const app3 = await buildApp({
      gateway: {
        chat,
        planner: new MockChatProvider(),
        premiumChat: new MockChatProvider(),
        stt: new MockSttProvider(),
        tts: new MockTtsProvider(),
        vision: new MockVisionProvider(),
        moderation: new RulesModerationProvider(),
      },
      store,
      env: { NODE_ENV: "test", RATE_LIMIT_MAX: "10000", AUTH_RATE_LIMIT: "100000" },
    });
    await app3.inject({ method: "POST", url: `/sessions/${s.sessionId}/message`, payload: { text: "again", faceHint: "frowning" } });
    expect(noteIn(chat.seen.at(-1)!)).toBeUndefined();
  });
});
