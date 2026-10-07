import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/store/memory.js";
import { dueJobs, provisionSecrets } from "../src/ops/provision.js";
import { buildApp } from "../src/app.js";
import {
  MockChatProvider,
  MockSttProvider,
  MockTtsProvider,
  MockVisionProvider,
  RulesModerationProvider,
} from "@tutor/ai-gateway";

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

describe("zero-terminal switch-on (sprint 37)", () => {
  it("provisions missing secrets once, persists them, and reuses them on the next boot", async () => {
    const store = new MemoryStore();
    const env: Record<string, string | undefined> = {};
    await provisionSecrets(store, env);
    expect(env.ADMIN_KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(env.VAPID_PUBLIC_KEY).toBeTruthy();
    expect(env.VAPID_PRIVATE_KEY).toBeTruthy();

    // A "restart": fresh env, same store. The keys must come back identical.
    const env2: Record<string, string | undefined> = {};
    await provisionSecrets(store, env2);
    expect(env2.ADMIN_KEY).toBe(env.ADMIN_KEY);
    expect(env2.VAPID_PUBLIC_KEY).toBe(env.VAPID_PUBLIC_KEY);
    expect(env2.VAPID_PRIVATE_KEY).toBe(env.VAPID_PRIVATE_KEY);
  });

  it("an env-supplied secret always wins and is never overwritten", async () => {
    const store = new MemoryStore();
    await provisionSecrets(store, {}); // generates and stores a pair
    const env: Record<string, string | undefined> = { ADMIN_KEY: "founder-chosen-key-0123456789abcdef" };
    await provisionSecrets(store, env);
    expect(env.ADMIN_KEY).toBe("founder-chosen-key-0123456789abcdef");
    // The stored one is untouched for anyone booting without the env var.
    expect(await store.getSetting("secret.adminKey")).not.toBe(env.ADMIN_KEY);
  });

  it("knows when the alarm clock's jobs are due", () => {
    const monday7am = new Date("2026-09-14T07:30:00Z");
    expect(dueJobs(monday7am, 7, 18)).toEqual(["nudge"]);
    const mondayNoon = new Date("2026-09-14T12:00:00Z");
    expect(dueJobs(mondayNoon, 7, 18)).toEqual([]);
    const sunday6pm = new Date("2026-09-13T18:05:00Z");
    expect(dueJobs(sunday6pm, 7, 18)).toEqual(["digest"]);
    const sunday7am = new Date("2026-09-13T07:59:00Z");
    expect(dueJobs(sunday7am, 7, 18)).toEqual(["nudge"]);
  });

  it("a daily job claim is won exactly once", async () => {
    const store = new MemoryStore();
    expect(await store.claimDailyJob("digest:2026-09-13")).toBe(true);
    expect(await store.claimDailyJob("digest:2026-09-13")).toBe(false);
    expect(await store.claimDailyJob("digest:2026-09-20")).toBe(true); // next week is a fresh claim
    expect(await store.claimDailyJob("nudge:2026-09-13")).toBe(true); // different job, same day
  });

  it("shows the master key to the owner in ops, and to nobody else", async () => {
    const app = await buildApp({
      gateway: gateway(),
      store: new MemoryStore(),
      env: {
        NODE_ENV: "test",
        RATE_LIMIT_MAX: "10000",
        AUTH_RATE_LIMIT: "100000",
        COMMAND_OWNER_EMAILS: "boss@dingba.ai",
        ADMIN_KEY: "sesame-sesame-sesame",
      },
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
    const ownerOps = await app.inject({ method: "GET", url: "/command/ops", headers: { authorization: `Bearer ${owner}` } });
    expect(ownerOps.json().adminKey).toBe("sesame-sesame-sesame");

    // An admin staffer can read ops, but the master key stays the owner's.
    const adminToken = await reg("coo@dingba.ai");
    await app.inject({
      method: "POST",
      url: "/command/staff",
      headers: { authorization: `Bearer ${owner}` },
      payload: { email: "coo@dingba.ai", role: "admin" },
    });
    const adminOps = await app.inject({ method: "GET", url: "/command/ops", headers: { authorization: `Bearer ${adminToken}` } });
    expect(adminOps.statusCode).toBe(200);
    expect(adminOps.json().adminKey).toBeUndefined();
    await app.close();
  });
});
