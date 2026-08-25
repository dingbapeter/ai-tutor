import { describe, expect, it, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  MockChatProvider,
  MockSttProvider,
  MockTtsProvider,
  MockVisionProvider,
  RulesModerationProvider,
} from "@tutor/ai-gateway";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/store/memory.js";
import { capabilitiesFor, can, isStaffRole, STAFF_ROLES } from "../src/command/rbac.js";

/**
 * The Command Centre, tested against the real routes and a real store.
 *
 * The centre of gravity here is the investor case. Investors sit inside the
 * console next to the founder, so the tests assert that every surface which
 * could name a learner, a guardian or a payer refuses them, and that the
 * refusal comes from the API rather than from a hidden button.
 */

const OWNER = "founder@dingba.ai";

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

let app: FastifyInstance;
let store: MemoryStore;
const tokens: Record<string, string> = {};

async function register(email: string, role: "parent" | "student" = "parent") {
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "correct-horse-battery", displayName: email.split("@")[0], role },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

const auth = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });

beforeAll(async () => {
  store = new MemoryStore();
  app = await buildApp({
    gateway: gateway(),
    store,
    env: {
      NODE_ENV: "test",
      RATE_LIMIT_MAX: "10000",
      GUEST_IP_CAP: "100000",
      AUTH_RATE_LIMIT: "100000",
      COMMAND_OWNER_EMAILS: OWNER,
      PRICE_PLUS_MONTHLY: "9",
      PRICE_PREMIUM_MONTHLY: "19",
      PRICE_CURRENCY: "USD",
    },
  });

  tokens.owner = await register(OWNER);
  tokens.investor = await register("investor@fund.example");
  tokens.finance = await register("cfo@dingba.ai");
  tokens.support = await register("support@dingba.ai");
  tokens.outsider = await register("parent@family.example");

  // A family with real activity, so the metrics and support views have
  // something truthful to report.
  const family = await app.inject({
    method: "POST",
    url: "/sessions",
    payload: { studentName: "Ada", personaId: "amara", packId: "math-ms", parentEmail: "parent@family.example" },
  });
  expect(family.statusCode).toBe(200);

  // The owner staffs the console.
  for (const [email, role] of [
    ["investor@fund.example", "investor"],
    ["cfo@dingba.ai", "finance"],
    ["support@dingba.ai", "support"],
  ] as const) {
    const res = await app.inject({
      method: "POST",
      url: "/command/staff",
      headers: auth("owner"),
      payload: { email, role },
    });
    expect(res.statusCode).toBe(201);
  }
});

describe("capability matrix", () => {
  it("gives the investor the smallest surface in the system", () => {
    expect(capabilitiesFor("investor")).toEqual(["metrics:read", "finance:aggregate"]);
    for (const capability of ["people:read", "people:write", "safety:read", "finance:detail", "staff:read", "staff:write", "config:write", "audit:read"] as const) {
      expect(can("investor", capability)).toBe(false);
    }
  });

  it("keeps every role inside the declared role list", () => {
    for (const role of STAFF_ROLES) expect(isStaffRole(role)).toBe(true);
    expect(isStaffRole("superuser")).toBe(false);
    expect(capabilitiesFor("owner").length).toBeGreaterThan(capabilitiesFor("admin").length);
  });
});

describe("command centre access", () => {
  it("turns away anyone without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/command/metrics" });
    expect(res.statusCode).toBe(401);
  });

  it("turns away a signed-in account that is not staff", async () => {
    const res = await app.inject({ method: "GET", url: "/command/metrics", headers: auth("outsider") });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain("command centre access");
  });

  it("reports each actor's own capabilities", async () => {
    const owner = await app.inject({ method: "GET", url: "/command/me", headers: auth("owner") });
    expect(owner.json().role).toBe("owner");
    expect(owner.json().capabilities).toContain("staff:write");

    const investor = await app.inject({ method: "GET", url: "/command/me", headers: auth("investor") });
    expect(investor.json().role).toBe("investor");
    expect(investor.json().capabilities).toEqual(["metrics:read", "finance:aggregate"]);
  });
});

describe("investor containment", () => {
  it("refuses every route that could name a person", async () => {
    const forbidden: Array<[string, string]> = [
      ["GET", "/command/people?q=ada"],
      ["GET", "/command/staff"],
      ["GET", "/command/audit"],
    ];
    for (const [method, url] of forbidden) {
      const res = await app.inject({ method: method as "GET", url, headers: auth("investor") });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it("refuses to change anyone's plan", async () => {
    const account = await store.getAccountByEmail("parent@family.example");
    const res = await app.inject({
      method: "POST",
      url: `/command/people/${account!.userId}/plan`,
      headers: auth("investor"),
      payload: { plan: "premium" },
    });
    expect(res.statusCode).toBe(403);
    expect(await store.getUserPlan(account!.userId)).toBe("free");
  });

  it("gives the investor real aggregates with no identities in them", async () => {
    const res = await app.inject({ method: "GET", url: "/command/metrics", headers: auth("investor") });
    expect(res.statusCode).toBe(200);
    const { metrics } = res.json();
    expect(metrics.learners).toBeGreaterThan(0);
    expect(metrics.sessions).toBeGreaterThan(0);
    expect(metrics.sessionsSeries).toHaveLength(30);
    // Nothing anywhere in the payload may look like an email address.
    expect(JSON.stringify(res.json())).not.toMatch(/@/);
  });

  it("gives the investor revenue totals but never the payers", async () => {
    const res = await app.inject({ method: "GET", url: "/command/finance", headers: auth("investor") });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pricesConfigured).toBe(true);
    expect(body.currency).toBe("USD");
    expect(body.subscriptions).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/@/);
  });
});

describe("finance and support desks", () => {
  it("lets finance see payers and computes revenue from live subscriptions", async () => {
    const account = await store.getAccountByEmail("parent@family.example");
    await store.recordSubscription({
      userId: account!.userId,
      provider: "mock",
      customerRef: "cus_1",
      subscriptionRef: "sub_1",
      plan: "premium",
      status: "active",
    });
    await store.setUserPlan("parent@family.example", "premium");

    const res = await app.inject({ method: "GET", url: "/command/finance", headers: auth("finance") });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const premium = body.lines.find((l: { plan: string }) => l.plan === "premium");
    expect(premium.subscribers).toBe(1);
    expect(premium.monthlyRevenue).toBe(19);
    expect(body.mrr).toBe(19);
    expect(body.arr).toBe(228);
    expect(body.subscriptions[0].email).toBe("parent@family.example");
  });

  it("stops finance at the support desk door", async () => {
    const res = await app.inject({ method: "GET", url: "/command/people?q=parent", headers: auth("finance") });
    expect(res.statusCode).toBe(403);
  });

  it("lets support find a family and read its learners", async () => {
    const search = await app.inject({ method: "GET", url: "/command/people?q=family", headers: auth("support") });
    expect(search.statusCode).toBe(200);
    const hit = search.json().results.find((r: { email: string }) => r.email === "parent@family.example");
    expect(hit.students).toBe(1);

    const detail = await app.inject({ method: "GET", url: `/command/people/${hit.userId}`, headers: auth("support") });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().account.plan).toBe("premium");
    expect(detail.json().learners[0].displayName).toBe("Ada");
    expect(detail.json().learners[0].incidents).toEqual([]); // support holds safety:read
  });

  it("rejects a one-character search rather than dumping the database", async () => {
    const res = await app.inject({ method: "GET", url: "/command/people?q=a", headers: auth("support") });
    expect(res.statusCode).toBe(400);
  });

  it("lets support change a plan and refuses to let finance do it", async () => {
    const account = await store.getAccountByEmail("parent@family.example");
    const denied = await app.inject({
      method: "POST",
      url: `/command/people/${account!.userId}/plan`,
      headers: auth("finance"),
      payload: { plan: "plus" },
    });
    expect(denied.statusCode).toBe(403);

    const ok = await app.inject({
      method: "POST",
      url: `/command/people/${account!.userId}/plan`,
      headers: auth("support"),
      payload: { plan: "plus", reason: "goodwill after a billing mix-up" },
    });
    expect(ok.statusCode).toBe(200);
    expect(await store.getUserPlan(account!.userId)).toBe("plus");
  });

  it("404s on an account id that does not exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/command/people/00000000-0000-0000-0000-000000000000",
      headers: auth("support"),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("staff management", () => {
  it("lists the roster with roles and titles", async () => {
    const res = await app.inject({ method: "GET", url: "/command/staff", headers: auth("owner") });
    expect(res.statusCode).toBe(200);
    const roles = res.json().staff.map((s: { role: string }) => s.role).sort();
    expect(roles).toEqual(["finance", "investor", "owner", "support"]);
  });

  it("updates an existing member instead of duplicating them", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/command/staff",
      headers: auth("owner"),
      payload: { email: "support@dingba.ai", role: "support", title: "Head of Care" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().staff.title).toBe("Head of Care");
    const roster = await app.inject({ method: "GET", url: "/command/staff", headers: auth("owner") });
    expect(roster.json().staff).toHaveLength(4);
  });

  it("refuses to staff someone who has no account yet", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/command/staff",
      headers: auth("owner"),
      payload: { email: "nobody@nowhere.example", role: "staff" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("refuses self-promotion and self-removal", async () => {
    const me = await app.inject({ method: "GET", url: "/command/me", headers: auth("owner") });
    const ownerId = me.json().userId;

    const promote = await app.inject({
      method: "POST",
      url: "/command/staff",
      headers: auth("owner"),
      payload: { email: OWNER, role: "owner" },
    });
    expect(promote.statusCode).toBe(400);

    const remove = await app.inject({ method: "DELETE", url: `/command/staff/${ownerId}`, headers: auth("owner") });
    expect(remove.statusCode).toBe(400);
  });

  it("stops a support agent from staffing anyone", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/command/staff",
      headers: auth("support"),
      payload: { email: "cfo@dingba.ai", role: "owner" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("suspends access without deleting the record", async () => {
    const token = await register("temp@dingba.ai");
    const add = await app.inject({
      method: "POST",
      url: "/command/staff",
      headers: auth("owner"),
      payload: { email: "temp@dingba.ai", role: "staff" },
    });
    expect(add.statusCode).toBe(201);

    const before = await app.inject({
      method: "GET",
      url: "/command/metrics",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(before.statusCode).toBe(200);

    await app.inject({
      method: "POST",
      url: "/command/staff",
      headers: auth("owner"),
      payload: { email: "temp@dingba.ai", role: "staff", status: "suspended" },
    });
    const after = await app.inject({
      method: "GET",
      url: "/command/metrics",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(403);
    expect(after.json().error).toContain("suspended");

    const userId = (await store.getAccountByEmail("temp@dingba.ai"))!.userId;
    const removed = await app.inject({ method: "DELETE", url: `/command/staff/${userId}`, headers: auth("owner") });
    expect(removed.statusCode).toBe(200);
    const gone = await app.inject({
      method: "GET",
      url: "/command/metrics",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(gone.statusCode).toBe(403);
  });

  it("will not let the last owner be removed", async () => {
    const ownerId = (await store.getAccountByEmail(OWNER))!.userId;
    // A second owner is needed to even attempt the removal from another seat.
    await register("second.owner@dingba.ai");
    await app.inject({
      method: "POST",
      url: "/command/staff",
      headers: auth("owner"),
      payload: { email: "second.owner@dingba.ai", role: "owner" },
    });
    const secondId = (await store.getAccountByEmail("second.owner@dingba.ai"))!.userId;

    const ok = await app.inject({ method: "DELETE", url: `/command/staff/${secondId}`, headers: auth("owner") });
    expect(ok.statusCode).toBe(200);

    // Now only the bootstrap owner remains; removing them is refused.
    await store.upsertStaff({ userId: secondId, role: "admin" });
    const secondToken = await (async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "second.owner@dingba.ai", password: "correct-horse-battery" },
      });
      return (res.json() as { token: string }).token;
    })();
    // Admins do not hold staff:write, so the attempt stops on capability.
    const denied = await app.inject({
      method: "DELETE",
      url: `/command/staff/${ownerId}`,
      headers: { authorization: `Bearer ${secondToken}` },
    });
    expect(denied.statusCode).toBe(403);
  });
});

describe("audit trail", () => {
  it("records privileged reads and writes with the actor on them", async () => {
    const res = await app.inject({ method: "GET", url: "/command/audit", headers: auth("owner") });
    expect(res.statusCode).toBe(200);
    const actions = res.json().entries.map((e: { action: string }) => e.action);
    expect(actions).toContain("people.search");
    expect(actions).toContain("people.plan.change");
    expect(actions).toContain("staff.add");

    const planChange = res
      .json()
      .entries.find((e: { action: string }) => e.action === "people.plan.change");
    expect(planChange.actorEmail).toBe("support@dingba.ai");
    expect(planChange.actorRole).toBe("support");
    expect(planChange.meta.to).toBe("plus");
  });

  it("filters by action", async () => {
    const res = await app.inject({ method: "GET", url: "/command/audit?action=staff.add", headers: auth("owner") });
    expect(res.statusCode).toBe(200);
    const entries = res.json().entries as Array<{ action: string }>;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.action === "staff.add")).toBe(true);
  });

  it("keeps the trail away from support, who can act but not review", async () => {
    const res = await app.inject({ method: "GET", url: "/command/audit", headers: auth("support") });
    expect(res.statusCode).toBe(403);
  });
});
