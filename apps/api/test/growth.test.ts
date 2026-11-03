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
const WEEK = 7 * DAY;

// A fixed Monday, so cohort weeks land exactly where the test says they do.
const MONDAY = Date.parse("2026-08-03T09:00:00Z");

async function accountWithSession(store: MemoryStore, email: string, sessionDays: number[]) {
  const acct = await store.createAccount(email, "hash", "parent", email.split("@")[0]);
  const { id: studentId } = await store.addStudentProfile(acct!.userId, "Kid");
  const base = Date.now();
  for (const d of sessionDays) {
    vi.setSystemTime(base + d * DAY);
    await store.createSession({
      studentId,
      personaId: "amara",
      packId: "math-ms",
      language: "en",
      plan: "free",
      ownerUserId: acct!.userId,
    });
  }
  vi.setSystemTime(base);
  return acct!.userId;
}

afterEach(() => vi.useRealTimers());

describe("growth analytics (sprint 36)", () => {
  it("computes the funnel and per-cohort retention, with unelapsed weeks null", async () => {
    vi.useFakeTimers();
    const store = new MemoryStore();

    // Cohort A signs up three weeks ago: one account keeps coming back
    // (weeks 0, 1 and 2), one never starts at all.
    vi.setSystemTime(MONDAY);
    await accountWithSession(store, "keen@example.com", [0, 1, 8, 15]);
    await store.createAccount("ghost@example.com", "hash", "parent", "ghost");

    // Cohort B signs up one week ago and practices only in its first week.
    vi.setSystemTime(MONDAY + 2 * WEEK);
    await accountWithSession(store, "fresh@example.com", [1]);

    // Today: mid-way through the week after cohort B's signup week.
    vi.setSystemTime(MONDAY + 3 * WEEK + 3 * DAY);
    const g = await store.growthAnalytics(new Date());

    expect(g.funnel).toEqual({
      registered: 3,
      startedSession: 2,
      returnedAnotherDay: 1, // only the keen account came back on other days
      subscribed: 0,
    });

    expect(g.cohorts).toHaveLength(2);
    const [a, b] = g.cohorts;
    expect(a.weekStart).toBe("2026-08-03");
    expect(a.signups).toBe(2);
    // Keen practiced in weeks 0-2 of a 2-account cohort: 50% each; week 3 is
    // the current, unfinished week.
    expect(a.retainedByWeek).toEqual([50, 50, 50, null, null, null]);
    expect(b.weekStart).toBe("2026-08-17");
    expect(b.signups).toBe(1);
    expect(b.retainedByWeek).toEqual([100, null, null, null, null, null]);
  });

  it("serves growth to metrics readers, investors included, and never to outsiders", async () => {
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
      store: new MemoryStore(),
      env: { NODE_ENV: "test", RATE_LIMIT_MAX: "10000", AUTH_RATE_LIMIT: "100000", COMMAND_OWNER_EMAILS: "boss@dingba.ai" },
    });
    const reg = async (email: string) =>
      (
        await app.inject({
          method: "POST",
          url: "/auth/register",
          payload: { email, password: "password12", role: "parent" },
        })
      ).json().token as string;

    const owner = await reg("boss@dingba.ai");
    const growth = await app.inject({ method: "GET", url: "/command/growth", headers: { authorization: `Bearer ${owner}` } });
    expect(growth.statusCode).toBe(200);
    expect(growth.json().funnel.registered).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(growth.json().cohorts)).toBe(true);

    // An investor's whole world is counts: growth is exactly what they get.
    const investorToken = await reg("vc@fund.example");
    await app.inject({
      method: "POST",
      url: "/command/staff",
      headers: { authorization: `Bearer ${owner}` },
      payload: { email: "vc@fund.example", role: "investor" },
    });
    const asInvestor = await app.inject({
      method: "GET",
      url: "/command/growth",
      headers: { authorization: `Bearer ${investorToken}` },
    });
    expect(asInvestor.statusCode).toBe(200);

    // A plain family account is not staff and sees nothing.
    const family = await reg("family@example.com");
    const refused = await app.inject({ method: "GET", url: "/command/growth", headers: { authorization: `Bearer ${family}` } });
    expect(refused.statusCode).toBe(403);
    await app.close();
  });
});
