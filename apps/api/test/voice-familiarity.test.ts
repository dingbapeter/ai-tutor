import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/store/memory.js";
import { buildApp } from "../src/app.js";
import {
  emptyProfile,
  familiar,
  familiarityStatus,
  hear,
  parseVoiceFeatures,
  readProfile,
  voiceFamiliarityAllowed,
  voiceNote,
  type VoiceProfile,
  type VoiceSample,
} from "../src/tutor/voice.js";
import type { ChatMessage } from "@tutor/ai-gateway";
import {
  MockChatProvider,
  MockSttProvider,
  MockTtsProvider,
  MockVisionProvider,
  RulesModerationProvider,
} from "@tutor/ai-gateway";

const SAID = "I think the answer is twelve because four times three is twelve";

/** Their usual voice, with the small wobble every real voice has. */
function usual(i: number): VoiceSample {
  const w = [0, 1, -1, 0.5, -0.5, 0.8, -0.8][i % 7];
  return { pitchHz: 220 * 2 ** ((w * 0.5) / 12), rangeSt: 3 + w * 0.3, level: 0.14 + w * 0.01, voicedSec: 4 + w * 0.3 };
}

/** Two lessons of three turns each: the first two encounters. */
function learned(): VoiceProfile {
  let p = emptyProfile();
  for (let i = 0; i < 6; i++) p = hear(p, usual(i), SAID, i < 3 ? "lesson-1" : "lesson-2").profile;
  return p;
}

describe("voice familiarity: the rules on their own", () => {
  it("reads the device's measurements, and nothing out of a human range", () => {
    expect(parseVoiceFeatures("pitch=212.5;range=3.1;level=0.142;voiced=3.4")).toEqual({ pitchHz: 212.5, rangeSt: 3.1, level: 0.142, voicedSec: 3.4 });
    // Pitch that could not be read is simply left out.
    expect(parseVoiceFeatures("level=0.1;voiced=2")).toEqual({ level: 0.1, voicedSec: 2, pitchHz: undefined, rangeSt: undefined });
    expect(parseVoiceFeatures("pitch=5000;level=0.1;voiced=2")?.pitchHz).toBeUndefined();
    expect(parseVoiceFeatures("pitch=200;voiced=2")).toBeNull();
    expect(parseVoiceFeatures("level=NaN;voiced=2")).toBeNull();
    expect(parseVoiceFeatures(undefined)).toBeNull();
    expect(parseVoiceFeatures("x".repeat(500))).toBeNull();
  });

  it("gets to know a voice over the first two lessons, and says nothing while it learns", () => {
    let p = emptyProfile();
    for (let i = 0; i < 6; i++) {
      const lesson = i < 3 ? "lesson-1" : "lesson-2";
      // Even a very different turn while learning earns no remark.
      const h = hear(p, i === 4 ? { ...usual(i), level: 0.02, voicedSec: 3 } : usual(i), SAID, lesson);
      expect(h.note).toBeNull();
      expect(h.known).toBe(false);
      p = h.profile;
    }
    expect(familiar(p)).toBe(true);
    expect(familiarityStatus(p)).toEqual({ stage: "knows", sessionsHeard: 2 });
    // Six turns in ONE lesson is not two encounters.
    let one = emptyProfile();
    for (let i = 0; i < 8; i++) one = hear(one, usual(i), SAID, "only-lesson").profile;
    expect(familiar(one)).toBe(false);
    expect(familiarityStatus(one)).toEqual({ stage: "listening", sessionsHeard: 1 });
  });

  it("notices when they sound unlike themselves, and says only what is audible", () => {
    const p = learned();
    // Much quieter, and slower: far fewer words in the same stretch of speech.
    const h = hear(p, { ...usual(0), level: 0.05, voicedSec: 9 }, SAID, "lesson-3");
    expect(h.known).toBe(true);
    // Strongest difference first, whichever that is today.
    expect(h.note).toMatch(/(quieter and slower|slower and quieter) than it usually is/);
    expect(h.note).toContain("Private note");
    expect(h.note).not.toMatch(/\b(sad|happy|angry|upset|anxious|depressed|tired|bored|worried)\b/i);
    expect(voiceNote(["quieter"])).toContain("do not guess or name how they feel");
  });

  it("does not remark on an ordinary wobble, or one thing a little off", () => {
    const p = learned();
    for (let i = 0; i < 7; i++) expect(hear(p, usual(i), SAID, "lesson-3").note).toBeNull();
    // A bit quieter than usual, and nothing else: an ordinary turn.
    expect(hear(p, { ...usual(0), level: 0.095 }, SAID, "lesson-3").note).toBeNull();
    // Far quieter on its own is worth a word.
    expect(hear(p, { ...usual(0), level: 0.03 }, SAID, "lesson-3").note).toContain("quieter");
  });

  it("asks once a lesson, not every turn", () => {
    let p = learned();
    const odd = { ...usual(0), level: 0.04, voicedSec: 9 };
    const first = hear(p, odd, SAID, "lesson-3");
    expect(first.note).not.toBeNull();
    p = first.profile;
    expect(hear(p, odd, SAID, "lesson-3").note).toBeNull();
    // A new lesson, still sounding unlike themselves: worth asking again.
    expect(hear(p, odd, SAID, "lesson-4").note).not.toBeNull();
  });

  it("does not let a day that sounded unlike them reshape their usual", () => {
    const p = learned();
    const after = hear(p, { ...usual(0), level: 0.04, voicedSec: 9 }, SAID, "lesson-3").profile;
    expect(after.level).toEqual(p.level);
    expect(after.pace).toEqual(p.pace);
    expect(after.turns).toBe(p.turns);
  });

  it("lets a gradual change become the new normal without remark, like a voice breaking", () => {
    let p = learned();
    // Pitch drifts down a whole octave over ninety turns, a little each time.
    for (let i = 0; i < 90; i++) {
      const hz = 220 * 2 ** (-(i + 1) / 90);
      const h = hear(p, { ...usual(i), pitchHz: hz }, SAID, `lesson-${3 + Math.floor(i / 5)}`);
      expect(h.note).toBeNull();
      p = h.profile;
    }
    // Their usual is now the lower voice: about an octave (twelve semitones) down.
    expect(p.pitch!.mean).toBeLessThan(12 * Math.log2(220 / 100) - 10);
    // And the old voice today would be the surprise.
    expect(hear(p, { ...usual(0), pitchHz: 220, level: 0.2 }, SAID, "lesson-99").note).toContain("higher");
  });

  it("ignores a turn too short to say anything about a voice", () => {
    const p = learned();
    const h = hear(p, { ...usual(0), level: 0.02, voicedSec: 0.8 }, "no", "lesson-3");
    expect(h.note).toBeNull();
    expect(h.profile).toBe(p);
  });

  it("starts afresh from anything it did not write itself", () => {
    expect(readProfile(null)).toEqual(emptyProfile());
    expect(readProfile({ v: 2, turns: 3 })).toEqual(emptyProfile());
    expect(readProfile("pitch")).toEqual(emptyProfile());
  });

  it("is only ever allowed for a signed-in learner the account holder switched on, off a school roster, not via an API key", () => {
    const base = { enabledByAccountHolder: true, signedIn: true, onSchoolRoster: false, viaApiKey: false };
    expect(voiceFamiliarityAllowed(base)).toBe(true);
    expect(voiceFamiliarityAllowed({ ...base, enabledByAccountHolder: false })).toBe(false);
    expect(voiceFamiliarityAllowed({ ...base, signedIn: false })).toBe(false);
    expect(voiceFamiliarityAllowed({ ...base, onSchoolRoster: true })).toBe(false);
    expect(voiceFamiliarityAllowed({ ...base, viaApiKey: true })).toBe(false);
  });
});

/** A chat provider that records the exact history each turn was asked with. */
class CapturingChat {
  readonly name = "mock";
  seen: ChatMessage[][] = [];
  async *chat(messages: ChatMessage[]): AsyncIterable<string> {
    this.seen.push(messages.map((m) => ({ ...m })));
    yield "Let us look at that step together.";
  }
}

async function setup() {
  const chat = new CapturingChat();
  const store = new MemoryStore();
  const app = await buildApp({
    gateway: {
      chat,
      planner: new MockChatProvider(),
      // The premium plan below is served here, so it is captured too.
      premiumChat: chat,
      stt: new MockSttProvider(),
      tts: new MockTtsProvider(),
      vision: new MockVisionProvider(),
      moderation: new RulesModerationProvider(),
    },
    store,
    env: { NODE_ENV: "test", RATE_LIMIT_MAX: "10000", AUTH_RATE_LIMIT: "100000", AI_TTS_PROVIDER: "mock", ADMIN_KEY: "sesame" },
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
  // Enough voice turns in a day for a few lessons of talking.
  await app.inject({ method: "POST", url: "/admin/plan", headers: { "x-admin-key": "sesame" }, payload: { email, plan: "premium" } });
  return { token, studentId: student.id };
}

async function start(app: App, token: string, studentId: string) {
  return (await app.inject({
    method: "POST",
    url: "/sessions",
    headers: { authorization: `Bearer ${token}` },
    payload: { studentId, personaId: "amara", packId: "math-ms" },
  })).json() as { sessionId: string; voiceFamiliarity: boolean };
}

const header = (s: VoiceSample) =>
  `pitch=${s.pitchHz};range=${s.rangeSt};level=${s.level};voiced=${s.voicedSec}`;

async function speak(app: App, sessionId: string, s: VoiceSample, extra: Record<string, string> = {}) {
  const res = await app.inject({
    method: "POST",
    url: `/sessions/${sessionId}/voice`,
    headers: { "content-type": "audio/webm", "x-voice-features": header(s), ...extra },
    payload: Buffer.from([1, 2, 3, 4]),
  });
  expect(res.statusCode).toBe(200);
}

const switchTo = (app: App, token: string, studentId: string, enabled: boolean) =>
  app.inject({
    method: "PUT",
    url: `/students/${studentId}/voice-familiarity`,
    headers: { authorization: `Bearer ${token}` },
    payload: { enabled },
  });

const familiarNote = (turn: ChatMessage[]) => turn.find((m) => m.role === "system" && m.content.includes("how they usually sound"));
const genericLow = (turn: ChatMessage[]) => turn.some((m) => m.content.includes("sounded quiet and flat"));

describe("voice familiarity through the API", () => {
  it("is off by default: nothing about a voice is kept for a learner nobody switched on", async () => {
    const { app, store } = await setup();
    const { token, studentId } = await family(app);
    const s = await start(app, token, studentId);
    expect(s.voiceFamiliarity).toBe(false);
    await speak(app, s.sessionId, usual(0));
    expect(await store.getVoiceProfile(studentId)).toBeNull();
  });

  it("only the account holder can switch it on; then the tutor learns, and later notices", async () => {
    const { app, store, chat } = await setup();
    const { token, studentId } = await family(app);
    const other = await family(app, "stranger@example.com");
    expect((await switchTo(app, other.token, studentId, true)).statusCode).toBe(403);
    expect((await switchTo(app, token, studentId, true)).statusCode).toBe(200);

    // Two lessons of ordinary turns.
    for (let lesson = 0; lesson < 2; lesson++) {
      const s = await start(app, token, studentId);
      expect(s.voiceFamiliarity).toBe(true);
      for (let i = 0; i < 3; i++) await speak(app, s.sessionId, usual(lesson * 3 + i));
      expect(familiarNote(chat.seen.at(-1)!)).toBeUndefined();
    }
    const status = (await app.inject({ method: "GET", url: `/students/${studentId}/voice-familiarity`, headers: { authorization: `Bearer ${token}` } })).json();
    expect(status).toMatchObject({ voiceFamiliarity: true, status: { stage: "knows", sessionsHeard: 2 } });

    // A naturally soft voice, read as "low" by the one-size rule, is simply
    // how this learner sounds: no nudge once the tutor knows them.
    const s3 = await start(app, token, studentId);
    await speak(app, s3.sessionId, usual(1), { "x-voice-tone": "low" });
    expect(genericLow(chat.seen.at(-1)!)).toBe(false);
    expect(familiarNote(chat.seen.at(-1)!)).toBeUndefined();

    // Today they sound unlike themselves.
    await speak(app, s3.sessionId, { ...usual(0), level: 0.04, voicedSec: 9 });
    expect(familiarNote(chat.seen.at(-1)!)?.content).toMatch(/quieter and slower|slower and quieter/);

    // Private: never in the transcript a family can read.
    const saved = await store.listSessionMessages(s3.sessionId);
    expect(saved.every((m) => !m.content.includes("usually sound"))).toBe(true);
  });

  it("forgets everything when switched off, from the very next turn", async () => {
    const { app, store } = await setup();
    const { token, studentId } = await family(app);
    await switchTo(app, token, studentId, true);
    const s = await start(app, token, studentId);
    await speak(app, s.sessionId, usual(0));
    expect(await store.getVoiceProfile(studentId)).not.toBeNull();

    await switchTo(app, token, studentId, false);
    expect(await store.getVoiceProfile(studentId)).toBeNull();
    // The lesson under way stops listening straight away.
    await speak(app, s.sessionId, usual(1));
    expect(await store.getVoiceProfile(studentId)).toBeNull();
  });

  it("is never available on a school roster, even if someone tries", async () => {
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
    expect((await switchTo(app, teacher, pupilId, true)).statusCode).toBe(409);
    expect(await store.getVoiceFamiliarity(pupilId)).toBe(false);

    await store.setVoiceFamiliarity(pupilId, true);
    const s = await start(app, teacher, pupilId);
    expect(s.voiceFamiliarity).toBe(false);
    await speak(app, s.sessionId, usual(0));
    expect(await store.getVoiceProfile(pupilId)).toBeNull();
  });

  it("is not for guests, who have no account holder to consent", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/sessions", payload: { studentName: "Guest", personaId: "amara", packId: "math-ms" } });
    expect(res.json().voiceFamiliarity).toBe(false);
  });

  it("notices on the very numbers a real browser measured (tools/device/voice-probe.mjs)", async () => {
    // Chromium, fake microphone: two lessons of the ordinary recording, then
    // the lower, slower, flatter one. Loudness came out levelled by the
    // browser, as it does for real microphones, so the change has to be
    // heard in pitch movement and pace.
    const USUAL = [
      "pitch=214.9;range=1.13;level=0.110;voiced=2.0",
      "pitch=214.9;range=1.11;level=0.110;voiced=2.0",
      "pitch=214.9;range=1.11;level=0.109;voiced=2.0",
      "pitch=215.0;range=1.12;level=0.109;voiced=2.0",
      "pitch=214.9;range=1.12;level=0.111;voiced=2.0",
      "pitch=214.9;range=1.11;level=0.110;voiced=2.0",
    ];
    const QUIET = "pitch=195.2;range=0.28;level=0.108;voiced=2.3";
    const { app, chat } = await setup();
    const { token, studentId } = await family(app);
    await switchTo(app, token, studentId, true);
    const raw = (sessionId: string, h: string) =>
      app.inject({ method: "POST", url: `/sessions/${sessionId}/voice`, headers: { "content-type": "audio/webm", "x-voice-features": h }, payload: Buffer.from([1, 2, 3, 4]) });
    for (let lesson = 0; lesson < 2; lesson++) {
      const s = await start(app, token, studentId);
      for (const h of USUAL.slice(lesson * 3, lesson * 3 + 3)) expect((await raw(s.sessionId, h)).statusCode).toBe(200);
    }
    const s3 = await start(app, token, studentId);
    // Their ordinary voice on a third day: nothing to say.
    await raw(s3.sessionId, USUAL[0]);
    expect(familiarNote(chat.seen.at(-1)!)).toBeUndefined();
    // The flat, slow day: the tutor is told, in audible terms only.
    await raw(s3.sessionId, QUIET);
    const note = familiarNote(chat.seen.at(-1)!)?.content ?? "";
    expect(note).toMatch(/flatter/);
    expect(note).toMatch(/slower/);
    expect(note).not.toMatch(/quieter/);
  });

  it("shows the family where it stands, on the dashboard", async () => {
    const { app } = await setup();
    const { token, studentId } = await family(app);
    await switchTo(app, token, studentId, true);
    const s = await start(app, token, studentId);
    await speak(app, s.sessionId, usual(0));
    const dash = (await app.inject({ method: "GET", url: "/dashboard", headers: { authorization: `Bearer ${token}` } })).json();
    const ada = dash.students.find((x: { id: string }) => x.id === studentId);
    expect(ada.voiceFamiliarity).toBe(true);
    expect(ada.voiceStatus).toEqual({ stage: "listening", sessionsHeard: 1 });
  });
});
