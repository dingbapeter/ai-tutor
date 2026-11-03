import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/store/memory.js";
import { buildApp } from "../src/app.js";
import {
  MockChatProvider,
  MockSttProvider,
  MockTtsProvider,
  MockVisionProvider,
  RulesModerationProvider,
} from "@tutor/ai-gateway";

async function setup(env: Record<string, string> = {}) {
  const store = new MemoryStore();
  const app = await buildApp({
    gateway: {
      chat: new MockChatProvider(),
      planner: new MockChatProvider(),
      premiumChat: new MockChatProvider(),
      stt: new MockSttProvider(),
      tts: new MockTtsProvider(),
      vision: new MockVisionProvider(),
      moderation: new RulesModerationProvider(),
    },
    store,
    env: { NODE_ENV: "test", RATE_LIMIT_MAX: "10000", AUTH_RATE_LIMIT: "100000", AI_TTS_PROVIDER: "mock", ADMIN_KEY: "sesame", ...env },
  });
  return { app, store };
}
type App = Awaited<ReturnType<typeof setup>>["app"];

const PASSWORD = "correct horse battery";
const PUSH = {
  endpoint: "https://fcm.googleapis.com/fcm/send/device-address-that-must-stay-private",
  keys: { p256dh: "BPUSHPUBLICKEYVALUE0123456789", auth: "PUSHAUTHSECRET42" },
};

/** A family that has used everything: lessons, voice, a care contact, a key, a phone. */
async function busyFamily(app: App, email = "family@example.com", child = "Ada") {
  const reg = (await app.inject({ method: "POST", url: "/auth/register", payload: { email, password: PASSWORD, role: "parent" } })).json();
  const token = reg.token as string;
  const auth = { authorization: `Bearer ${token}` };
  await app.inject({ method: "POST", url: "/admin/plan", headers: { "x-admin-key": "sesame" }, payload: { email, plan: "premium" } });
  const student = (await app.inject({ method: "POST", url: "/students", headers: auth, payload: { displayName: child } })).json() as { id: string };
  await app.inject({ method: "PUT", url: `/students/${student.id}/face-hints`, headers: auth, payload: { enabled: true } });
  await app.inject({ method: "PUT", url: `/students/${student.id}/voice-familiarity`, headers: auth, payload: { enabled: true } });
  await app.inject({ method: "PUT", url: `/students/${student.id}/care-contact`, headers: auth, payload: { name: "Aunt Bisi", phone: "+234 800 000 0000", relationship: "aunt" } });
  const s = (await app.inject({ method: "POST", url: "/sessions", headers: auth, payload: { studentId: student.id, personaId: "amara", packId: "math-ms" } })).json();
  await app.inject({ method: "POST", url: `/sessions/${s.sessionId}/message`, payload: { text: `${child} says seven times eight is fifty six` } });
  await app.inject({
    method: "POST",
    url: `/sessions/${s.sessionId}/voice`,
    headers: { "content-type": "audio/webm", "x-voice-features": "pitch=220;range=1.1;level=0.11;voiced=2.0" },
    payload: Buffer.from([1, 2, 3, 4]),
  });
  const key = (await app.inject({ method: "POST", url: "/apikeys", headers: auth, payload: { name: "Homework app" } })).json() as { key?: string };
  await app.inject({ method: "POST", url: "/push/subscribe", headers: auth, payload: PUSH });
  return { token, auth, studentId: student.id, sessionId: s.sessionId as string, apiKey: key.key ?? null, userId: reg.user?.id as string | undefined };
}

/** Every key anywhere in a JSON value. */
function keysOf(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out); }
  return out;
}

describe("the family's own copy of their data", () => {
  it("needs the account holder to be signed in", async () => {
    const { app } = await setup();
    expect((await app.inject({ method: "GET", url: "/me/export" })).statusCode).toBe(401);
  });

  it("downloads as a dated file, never cached", async () => {
    const { app } = await setup();
    const fam = await busyFamily(app);
    const res = await app.inject({ method: "GET", url: "/me/export", headers: fam.auth });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="dingba-data-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json().format).toBe("dingba-export/1");
  });

  it("holds everything: the account, each learner, every lesson word for word, and their settings", async () => {
    const { app } = await setup();
    const fam = await busyFamily(app);
    const data = (await app.inject({ method: "GET", url: "/me/export", headers: fam.auth })).json();

    expect(data.account.email).toBe("family@example.com");
    expect(data.account.plan).toBe("premium");
    expect(data.learners).toHaveLength(1);
    const ada = data.learners[0];
    expect(ada.learner.displayName).toBe("Ada");
    expect(ada.learner.faceHints).toBe(true);
    expect(ada.learner.voiceFamiliarity).toBe(true);
    expect(ada.learner.voiceProfile).toMatchObject({ v: 1, turns: 1 });
    expect(ada.careContact).toMatchObject({ name: "Aunt Bisi" });

    const lesson = ada.sessions.find((x: { session: { id: string } }) => x.session.id === fam.sessionId);
    const words = lesson.messages.map((m: { content: string }) => m.content).join("\n");
    expect(words).toContain("Ada says seven times eight is fifty six");
    // The spoken turn's transcript is there too.
    expect(words).toContain("mock transcription");
    expect(lesson.messages.every((m: { createdAt: unknown }) => Boolean(m.createdAt))).toBe(true);

    expect(ada.usage.length + data.usage.length).toBeGreaterThan(0);
    expect(fam.apiKey).toBeTruthy();
    expect(data.apiKeys.map((k: { name: string }) => k.name)).toContain("Homework app");
    expect(data.pushDevices).toEqual([{ service: "fcm.googleapis.com", createdAt: null }]);
  });

  it("includes the payments the card processors reported for their email, and only theirs", async () => {
    const { app, store } = await setup();
    const fam = await busyFamily(app, "Payer@Example.com");
    const base = { provider: "paystack", plan: "premium", amountMinor: 500000, currency: "NGN", matched: true, customerRef: "CUS_1", subscriptionRef: "SUB_1" };
    await store.recordBillingEvent({ ...base, eventRef: "evt-1", type: "activated", email: "payer@example.com" });
    await store.recordBillingEvent({ ...base, eventRef: "evt-2", type: "activated", email: "someone-else@example.com" });
    const data = (await app.inject({ method: "GET", url: "/me/export", headers: fam.auth })).json();
    expect(data.paymentRecords).toHaveLength(1);
    expect(data.paymentRecords[0]).toMatchObject({ eventRef: "evt-1", amountMinor: 500000, currency: "NGN" });
  });

  it("never contains a secret", async () => {
    const { app } = await setup();
    const fam = await busyFamily(app);
    const res = await app.inject({ method: "GET", url: "/me/export", headers: fam.auth });
    const body = res.body;
    const keys = keysOf(res.json());
    for (const k of ["passwordHash", "keyHash", "tokenHash", "p256dh", "auth", "endpoint"]) expect(keys.has(k), k).toBe(false);
    expect(body).not.toContain(PASSWORD);
    expect(body).not.toContain(fam.token);
    expect(body).not.toContain(fam.apiKey!);
    expect(body).not.toContain(PUSH.endpoint);
    expect(body).not.toContain(PUSH.keys.p256dh);
    expect(body).not.toContain(PUSH.keys.auth);
    // A bcrypt hash, had one slipped through under another name.
    expect(body).not.toMatch(/\$2[aby]\$\d{2}\$/);
  });

  it("never contains another family", async () => {
    const { app } = await setup();
    const ours = await busyFamily(app, "ours@example.com", "Ada");
    await busyFamily(app, "theirs@example.com", "Kemi");
    const body = (await app.inject({ method: "GET", url: "/me/export", headers: ours.auth })).body;
    expect(body).toContain("Ada");
    expect(body).not.toContain("Kemi");
    expect(body).not.toContain("theirs@example.com");
  });

  it("is limited to a few downloads an hour, so a stolen sign-in cannot hammer it", async () => {
    const { app } = await setup({ EXPORT_RATE_LIMIT: "2" });
    const fam = await busyFamily(app);
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await app.inject({ method: "GET", url: "/me/export", headers: fam.auth })).statusCode);
    expect(codes).toEqual([200, 200, 429]);
    // Another family on the same network address is not held up by them.
    const neighbour = await busyFamily(app, "neighbour@example.com", "Kemi");
    expect((await app.inject({ method: "GET", url: "/me/export", headers: neighbour.auth })).statusCode).toBe(200);
  });
});

describe("download, then delete", () => {
  it("deleting erases everything the download held", async () => {
    const { app, store } = await setup();
    const fam = await busyFamily(app);
    const userId = (await app.inject({ method: "GET", url: "/me/export", headers: fam.auth })).json().account.id as string;
    expect(await store.exportAccount(userId)).not.toBeNull();

    const del = await app.inject({ method: "DELETE", url: "/me", headers: fam.auth, payload: { confirm: "DELETE" } });
    expect(del.statusCode).toBe(200);
    expect(await store.exportAccount(userId)).toBeNull();
    expect(await store.getVoiceProfile(fam.studentId)).toBeNull();
    expect(await store.listSessionMessages(fam.sessionId)).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/me/export", headers: fam.auth })).statusCode).toBe(401);
  });

  it("erases someone who once held free access too, grant and reviews included", async () => {
    const { app, store } = await setup();
    const fam = await busyFamily(app);
    const userId = (await app.inject({ method: "GET", url: "/me/export", headers: fam.auth })).json().account.id as string;
    await store.setAccessGrant({ userId, level: "premium", reason: "tester", grantedBy: null, expiresAt: null, reviewIntervalDays: 30, nextReviewAt: null });
    await store.recordAccessReview({ userId, reviewedBy: null, rating: "good", decision: "keep", note: "helpful", nextReviewAt: null, revoke: false });
    const before = (await app.inject({ method: "GET", url: "/me/export", headers: fam.auth })).json();
    expect(before.accessGrant).toMatchObject({ level: "premium" });
    expect(before.accessReviews).toHaveLength(1);

    await app.inject({ method: "DELETE", url: "/me", headers: fam.auth, payload: { confirm: "DELETE" } });
    expect(await store.getAccessGrant(userId)).toBeNull();
    expect(await store.exportAccount(userId)).toBeNull();
  });
});
