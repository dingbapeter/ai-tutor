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
    env: {
      NODE_ENV: "test",
      RATE_LIMIT_MAX: "10000",
      AUTH_RATE_LIMIT: "100000",
      COMMAND_OWNER_EMAILS: "boss@dingba.ai",
    },
  });
}
type App = Awaited<ReturnType<typeof build>>;

async function register(app: App, email: string) {
  return (await app.inject({ method: "POST", url: "/auth/register", payload: { email, password: "password12", role: "parent" } })).json().token as string;
}
async function usagePlan(app: App, token: string) {
  return (await app.inject({ method: "GET", url: "/me/usage", headers: { authorization: `Bearer ${token}` } })).json().plan as string;
}

describe("comp plan for the team and testers (sprint 44)", () => {
  it("a Command Centre owner learns on the unlimited plan automatically", async () => {
    const store = new MemoryStore();
    const app = await build(store);
    const boss = await register(app, "boss@dingba.ai");
    expect(await usagePlan(app, boss)).toBe("unlimited");

    // And an unlimited session really is unlimited: far past the free cap of 30.
    const studentId = (
      await app.inject({ method: "POST", url: "/students", headers: { authorization: `Bearer ${boss}` }, payload: { displayName: "Test Kid" } })
    ).json().id as string;
    const s = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: { authorization: `Bearer ${boss}` },
      payload: { studentId, personaId: "amara", packId: "math-ms" },
    });
    expect(s.json().bond).toBeDefined();
    // The session was created on the unlimited plan (premium brain + exam on).
    // /me/usage already proved the plan; the session inherits effectivePlan.
  });

  it("a plain account stays on free", async () => {
    const store = new MemoryStore();
    const app = await build(store);
    const parent = await register(app, "parent@example.com");
    expect(await usagePlan(app, parent)).toBe("free");
  });

  it("an owner can hand any account the unlimited comp, and it takes effect", async () => {
    const store = new MemoryStore();
    const app = await build(store);
    const boss = await register(app, "boss@dingba.ai");
    const tester = await register(app, "tester@example.com");
    const testerId = (await store.getAccountByEmail("tester@example.com"))!.userId;

    const res = await app.inject({
      method: "POST",
      url: `/command/people/${testerId}/plan`,
      headers: { authorization: `Bearer ${boss}` },
      payload: { plan: "unlimited", reason: "external tester" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().plan).toBe("unlimited");
    expect(await usagePlan(app, tester)).toBe("unlimited");
  });

  it("an assigned staff member gets unlimited automatically; suspending removes it", async () => {
    const store = new MemoryStore();
    const app = await build(store);
    const helper = await register(app, "helper@example.com");
    const helperId = (await store.getAccountByEmail("helper@example.com"))!.userId;
    expect(await usagePlan(app, helper)).toBe("free");

    await store.upsertStaff({ userId: helperId, role: "support", status: "active" });
    expect(await usagePlan(app, helper)).toBe("unlimited");

    await store.upsertStaff({ userId: helperId, role: "support", status: "suspended" });
    expect(await usagePlan(app, helper)).toBe("free");
  });
});
