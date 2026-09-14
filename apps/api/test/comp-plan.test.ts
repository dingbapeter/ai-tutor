import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../src/store/memory.js";
import { buildApp } from "../src/app.js";
import { grantStatus, grantGivesAccess, nextReviewFrom } from "../src/command/access.js";
import {
  MockChatProvider,
  MockSttProvider,
  MockTtsProvider,
  MockVisionProvider,
  RulesModerationProvider,
} from "@tutor/ai-gateway";

function gateway() {
  return {
    chat: new MockChatProvider(),
    planner: new MockChatProvider(),
    premiumChat: new MockChatProvider(),
    stt: new MockSttProvider(),
    tts: new MockTtsProvider(),
    vision: new MockVisionProvider(),
    moderation: new RulesModerationProvider(),
  };
}
async function build(store: MemoryStore) {
  return buildApp({
    gateway: gateway(),
    store,
    env: { NODE_ENV: "test", RATE_LIMIT_MAX: "10000", AUTH_RATE_LIMIT: "100000", COMMAND_OWNER_EMAILS: "boss@dingba.ai" },
  });
}
type App = Awaited<ReturnType<typeof build>>;
async function register(app: App, email: string) {
  return (await app.inject({ method: "POST", url: "/auth/register", payload: { email, password: "password12", role: "parent" } })).json().token as string;
}
async function plan(app: App, token: string) {
  return (await app.inject({ method: "GET", url: "/me/usage", headers: { authorization: `Bearer ${token}` } })).json().plan as string;
}
async function idOf(store: MemoryStore, email: string) {
  return (await store.getAccountByEmail(email))!.userId;
}
afterEach(() => vi.useRealTimers());

describe("comp access: pure grant rules (sprint 45)", () => {
  const base = {
    userId: "u",
    level: "unlimited",
    reason: null,
    grantedBy: null,
    grantedAt: new Date("2026-01-01"),
    reviewIntervalDays: 30,
    lastReviewAt: null,
    lastRating: null,
  };
  const now = new Date("2026-02-01T00:00:00Z");
  it("active only when not revoked, not expired, review not overdue", () => {
    expect(grantStatus({ ...base, expiresAt: null, nextReviewAt: nextReviewFrom(now, 30), revokedAt: null }, now)).toBe("active");
    expect(grantStatus({ ...base, expiresAt: new Date("2026-01-15"), nextReviewAt: null, revokedAt: null }, now)).toBe("expired");
    expect(grantStatus({ ...base, expiresAt: null, nextReviewAt: new Date("2026-01-20"), revokedAt: null }, now)).toBe("review_overdue");
    expect(grantStatus({ ...base, expiresAt: null, nextReviewAt: null, revokedAt: new Date("2026-01-10") }, now)).toBe("revoked");
    expect(grantGivesAccess({ ...base, expiresAt: null, nextReviewAt: new Date("2026-01-20"), revokedAt: null }, now)).toBe(false);
  });
});

describe("comp access, end to end (sprint 45)", () => {
  it("owner is always unlimited; a plain teammate is not, until granted", async () => {
    const store = new MemoryStore();
    const app = await build(store);
    const boss = await register(app, "boss@dingba.ai");
    const mate = await register(app, "mate@example.com");
    expect(await plan(app, boss)).toBe("unlimited");
    expect(await plan(app, mate)).toBe("free");

    // Being staff grants nothing on its own — the abuse we are preventing.
    await store.upsertStaff({ userId: await idOf(store, "mate@example.com"), role: "support", status: "active" });
    expect(await plan(app, mate)).toBe("free");
  });

  it("owner grants a reviewed comp; it works, lapses when the review goes overdue, renews, and revokes", async () => {
    // Real time throughout (faking Date would age out the auth token). We
    // simulate an overdue review by setting the grant's clock to the past.
    const store = new MemoryStore();
    const app = await build(store);
    const boss = await register(app, "boss@dingba.ai");
    const tester = await register(app, "tester@example.com");
    const tid = await idOf(store, "tester@example.com");

    const granted = await app.inject({
      method: "POST",
      url: `/command/people/${tid}/access`,
      headers: { authorization: `Bearer ${boss}` },
      payload: { level: "unlimited", reason: "beta testing", reviewIntervalDays: 30 },
    });
    expect(granted.statusCode).toBe(200);
    expect(await plan(app, tester)).toBe("unlimited");

    // The monthly review comes due and is missed: access lapses on its own.
    await store.setAccessGrant({
      userId: tid,
      level: "unlimited",
      reason: "beta testing",
      grantedBy: null,
      expiresAt: null,
      reviewIntervalDays: 30,
      nextReviewAt: new Date(Date.now() - 86_400_000),
    });
    expect(await plan(app, tester)).toBe("free");

    // A recorded review renews it.
    const review = await app.inject({
      method: "POST",
      url: `/command/people/${tid}/access/review`,
      headers: { authorization: `Bearer ${boss}` },
      payload: { rating: "meets", decision: "renew", note: "still testing" },
    });
    expect(review.statusCode).toBe(200);
    expect(await plan(app, tester)).toBe("unlimited");

    // A revoking review ends it.
    await app.inject({
      method: "POST",
      url: `/command/people/${tid}/access/review`,
      headers: { authorization: `Bearer ${boss}` },
      payload: { rating: "below", decision: "revoke" },
    });
    expect(await plan(app, tester)).toBe("free");
  });

  it("a grant with an expiry self-ends after the testing window", async () => {
    const store = new MemoryStore();
    const app = await build(store);
    const boss = await register(app, "boss@dingba.ai");
    const tester = await register(app, "t2@example.com");
    const tid = await idOf(store, "t2@example.com");
    // A live window: expires in the future, review not due.
    await app.inject({
      method: "POST",
      url: `/command/people/${tid}/access`,
      headers: { authorization: `Bearer ${boss}` },
      payload: { level: "unlimited", expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), reviewIntervalDays: 30 },
    });
    expect(await plan(app, tester)).toBe("unlimited");
    // The window closes: expiry now in the past.
    await store.setAccessGrant({
      userId: tid,
      level: "unlimited",
      reason: null,
      grantedBy: null,
      expiresAt: new Date(Date.now() - 1000),
      reviewIntervalDays: 30,
      nextReviewAt: new Date(Date.now() + 30 * 86_400_000),
    });
    expect(await plan(app, tester)).toBe("free");
  });

  it("only an owner can grant; the access list shows live status", async () => {
    const store = new MemoryStore();
    const app = await build(store);
    const boss = await register(app, "boss@dingba.ai");
    const tester = await register(app, "t3@example.com");
    const tid = await idOf(store, "t3@example.com");
    // A support-role admin (not owner) cannot grant comp access.
    const helper = await register(app, "helper@example.com");
    await store.upsertStaff({ userId: await idOf(store, "helper@example.com"), role: "support", status: "active" });
    const denied = await app.inject({
      method: "POST",
      url: `/command/people/${tid}/access`,
      headers: { authorization: `Bearer ${helper}` },
      payload: { level: "unlimited" },
    });
    expect(denied.statusCode).toBe(403);

    await app.inject({
      method: "POST",
      url: `/command/people/${tid}/access`,
      headers: { authorization: `Bearer ${boss}` },
      payload: { level: "unlimited", reason: "qa" },
    });
    const list = await app.inject({ method: "GET", url: "/command/access", headers: { authorization: `Bearer ${boss}` } });
    expect(list.statusCode).toBe(200);
    const grants = list.json().grants as Array<{ email: string; level: string; status: string }>;
    expect(grants).toEqual([expect.objectContaining({ email: "t3@example.com", level: "unlimited", status: "active" })]);
  });
});
