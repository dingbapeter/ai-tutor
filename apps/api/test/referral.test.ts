import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../src/store/memory.js";
import { buildApp } from "../src/app.js";
import {
  MockChatProvider,
  MockSttProvider,
  MockTtsProvider,
  MockVisionProvider,
  RulesModerationProvider,
} from "@tutor/ai-gateway";

const DAY = 24 * 60 * 60 * 1000;

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

async function build(store: MemoryStore, extraEnv: Record<string, string> = {}) {
  return buildApp({
    gateway: gateway(),
    store,
    env: {
      NODE_ENV: "test",
      RATE_LIMIT_MAX: "10000",
      AUTH_RATE_LIMIT: "100000",
      WEB_ORIGIN: "https://dingba.ai",
      ...extraEnv,
    },
  });
}

type App = Awaited<ReturnType<typeof build>>;

async function register(app: App, email: string, ref?: string) {
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "password12", role: "parent", ...(ref ? { ref } : {}) },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

/** Verify the way the product does: mint a link, use it once. */
async function verifyEmail(app: App, store: MemoryStore, email: string) {
  const raw = randomBytes(24).toString("hex");
  const account = await store.getAccountByEmail(email);
  await store.createEmailVerification(account!.userId, createHash("sha256").update(raw).digest("hex"));
  const res = await app.inject({ method: "POST", url: "/auth/verify", payload: { token: raw } });
  expect(res.statusCode).toBe(200);
}

afterEach(() => vi.useRealTimers());

describe("referral loop (sprint 39)", () => {
  it("friend joins via my link, verifies, and BOTH of us get the thank-you days, exactly once", async () => {
    const store = new MemoryStore();
    const app = await build(store);

    const ada = await register(app, "ada@example.com");
    const mine = await app.inject({ method: "GET", url: "/account/referral", headers: { authorization: `Bearer ${ada}` } });
    expect(mine.statusCode).toBe(200);
    const { code, link, invited, rewardDays } = mine.json() as {
      code: string;
      link: string;
      invited: number;
      rewardDays: number;
    };
    expect(code).toMatch(/^[a-z0-9]{8}$/);
    expect(link).toBe(`https://dingba.ai/?ref=${code}`);
    expect(invited).toBe(0);
    expect(rewardDays).toBe(7);

    // The friend signs up through the link but has NOT verified yet:
    // visible as invited, nothing paid, nobody boosted.
    const ben = await register(app, "ben@example.com", code);
    const midway = (await app.inject({ method: "GET", url: "/account/referral", headers: { authorization: `Bearer ${ada}` } })).json();
    expect(midway.invited).toBe(1);
    expect(midway.rewarded).toBe(0);
    const adaId = (await store.getAccountByEmail("ada@example.com"))!.userId;
    expect(await store.getUserPlan(adaId)).toBe("free");

    await verifyEmail(app, store, "ben@example.com");

    // Both sides now run on plus, and the inviter's summary says so.
    const benId = (await store.getAccountByEmail("ben@example.com"))!.userId;
    expect(await store.getUserPlan(adaId)).toBe("plus");
    expect(await store.getUserPlan(benId)).toBe("plus");
    const after = (await app.inject({ method: "GET", url: "/account/referral", headers: { authorization: `Bearer ${ada}` } })).json();
    expect(after.rewarded).toBe(1);
    expect(after.boostPlan).toBe("plus");
    const until = new Date(after.boostUntil).getTime();
    expect(until).toBeGreaterThan(Date.now() + 6 * DAY);
    expect(until).toBeLessThan(Date.now() + 8 * DAY);

    // A second verification round can never pay twice.
    await verifyEmail(app, store, "ben@example.com");
    const replay = (await app.inject({ method: "GET", url: "/account/referral", headers: { authorization: `Bearer ${ada}` } })).json();
    expect(new Date(replay.boostUntil).getTime()).toBe(until);
    expect(replay.rewarded).toBe(1);

    // The friend's own /me/usage shows the boosted plan and its limits.
    const usage = (await app.inject({ method: "GET", url: "/me/usage", headers: { authorization: `Bearer ${ben}` } })).json();
    expect(usage.plan).toBe("plus");
  });

  it("a nonsense or self-referral code never breaks signup and never credits anyone", async () => {
    const store = new MemoryStore();
    const app = await build(store);
    await register(app, "solo@example.com", "nosuchcode");
    await verifyEmail(app, store, "solo@example.com");
    const soloId = (await store.getAccountByEmail("solo@example.com"))!.userId;
    expect(await store.getUserPlan(soloId)).toBe("free");
    expect((await store.referralStats(5)).totalReferred).toBe(0);
  });

  it("the boost expires on its own and can never downgrade a paid plan", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-09-01T12:00:00Z"));
    const store = new MemoryStore();

    const a = await store.createAccount("payer@example.com", "hash", "parent", "payer");
    await store.setUserPlan("payer@example.com", "premium");
    await store.grantPlanBoost(a!.userId, "plus", 7);
    // premium outranks the plus boost the whole way through
    expect(await store.getUserPlan(a!.userId)).toBe("premium");

    const b = await store.createAccount("freebie@example.com", "hash", "parent", "freebie");
    await store.grantPlanBoost(b!.userId, "plus", 7);
    expect(await store.getUserPlan(b!.userId)).toBe("plus");
    // stacking a second reward extends from the current expiry, not from now
    const secondUntil = await store.grantPlanBoost(b!.userId, "plus", 7);
    expect(secondUntil.getTime()).toBe(Date.now() + 14 * DAY);

    vi.setSystemTime(Date.parse("2026-09-16T12:00:00Z"));
    expect(await store.getUserPlan(b!.userId)).toBe("free");
    expect(await store.getUserPlan(a!.userId)).toBe("premium");
  });

  it("the Command Centre growth page carries the loop's numbers", async () => {
    const store = new MemoryStore();
    const app = await build(store, { COMMAND_OWNER_EMAILS: "boss@dingba.ai" });
    const boss = await register(app, "boss@dingba.ai");
    const bossReferral = (
      await app.inject({ method: "GET", url: "/account/referral", headers: { authorization: `Bearer ${boss}` } })
    ).json();
    await register(app, "friend1@example.com", bossReferral.code);
    await register(app, "friend2@example.com", bossReferral.code);
    await verifyEmail(app, store, "friend1@example.com");

    const growth = await app.inject({ method: "GET", url: "/command/growth", headers: { authorization: `Bearer ${boss}` } });
    expect(growth.statusCode).toBe(200);
    const { referrals } = growth.json() as {
      referrals: { totalReferred: number; rewarded: number; top: Array<{ email: string; invited: number; rewarded: number }> };
    };
    expect(referrals.totalReferred).toBe(2);
    expect(referrals.rewarded).toBe(1);
    expect(referrals.top).toEqual([{ email: "boss@dingba.ai", invited: 2, rewarded: 1 }]);
  });
});
