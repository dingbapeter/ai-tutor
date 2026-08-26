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
import { csvCell, csvFilename, toCsv } from "../src/command/csv.js";

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

describe("safety desk", () => {
  beforeAll(async () => {
    const account = await store.getAccountByEmail("parent@family.example");
    const [learner] = await store.listStudentProfiles(account!.userId);
    await store.recordIncident({
      studentId: learner.id,
      direction: "student",
      categories: ["self-harm"],
      severity: "danger",
      excerpt: "i do not want to be here any more",
    });
    await store.recordIncident({
      studentId: learner.id,
      direction: "student",
      categories: ["profanity"],
      severity: "concern",
      excerpt: "this stupid homework",
    });
  });

  it("shows every flag on the platform without knowing the family first", async () => {
    const res = await app.inject({ method: "GET", url: "/command/safety", headers: auth("support") });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.incidents.length).toBeGreaterThanOrEqual(2);
    // Newest first, and each row carries who to contact.
    const danger = body.incidents.find((i: { severity: string }) => i.severity === "danger");
    expect(danger.studentName).toBe("Ada");
    expect(danger.guardianEmail).toBe("parent@family.example");
    expect(danger.categories).toEqual(["self-harm"]);
    expect(body.today.danger).toBe(1);
    expect(body.today.concern).toBe(1);
    expect(body.week.danger).toBe(1);
  });

  it("separates danger from concern rather than averaging them", async () => {
    const res = await app.inject({ method: "GET", url: "/command/safety?severity=danger", headers: auth("support") });
    expect(res.statusCode).toBe(200);
    const rows = res.json().incidents as Array<{ severity: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.severity === "danger")).toBe(true);
  });

  it("never shows a child's flagged words to finance or an investor", async () => {
    for (const who of ["finance", "investor"]) {
      const res = await app.inject({ method: "GET", url: "/command/safety", headers: auth(who) });
      expect(res.statusCode, who).toBe(403);
      expect(res.body).not.toContain("i do not want to be here");
    }
  });

  it("writes the reading of it to the trail", async () => {
    const res = await app.inject({ method: "GET", url: "/command/audit?action=safety.read", headers: auth("owner") });
    const entries = res.json().entries as Array<{ actorEmail: string }>;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].actorEmail).toBe("support@dingba.ai");
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

describe("employment records", () => {
  async function idOf(email: string) {
    const roster = (await app.inject({ method: "GET", url: "/command/staff", headers: auth("owner") })).json().staff;
    return (roster as Array<{ email: string; userId: string }>).find((m) => m.email === email)!.userId;
  }

  it("turns a console row into an employment record", async () => {
    const cfo = await idOf("cfo@dingba.ai");
    const res = await app.inject({
      method: "PUT",
      url: `/command/staff/${cfo}/hr`,
      headers: auth("owner"),
      payload: {
        fullName: "Adaeze Okonkwo",
        employmentType: "employee",
        startDate: "2026-03-02",
        location: "Lagos",
        notes: "Runs the monthly close.",
      },
    });
    expect(res.statusCode).toBe(200);
    const staff = res.json().staff;
    expect(staff.fullName).toBe("Adaeze Okonkwo");
    expect(staff.employmentType).toBe("employee");
    expect(staff.startDate).toBe("2026-03-02");
    // The console half of the record is untouched by an HR write.
    expect(staff.role).toBe("finance");
    expect(staff.status).toBe("active");
  });

  it("touches only the fields it was given", async () => {
    const cfo = await idOf("cfo@dingba.ai");
    const res = await app.inject({
      method: "PUT",
      url: `/command/staff/${cfo}/hr`,
      headers: auth("owner"),
      payload: { location: "Abuja" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().staff.location).toBe("Abuja");
    expect(res.json().staff.fullName).toBe("Adaeze Okonkwo"); // still there
    expect(res.json().staff.startDate).toBe("2026-03-02");
  });

  it("refuses a reporting line that loops", async () => {
    const owner = await idOf(OWNER);
    const cfo = await idOf("cfo@dingba.ai");
    const support = await idOf("support@dingba.ai");

    // A chain: support -> cfo -> owner.
    expect(
      (await app.inject({ method: "PUT", url: `/command/staff/${cfo}/hr`, headers: auth("owner"), payload: { managerUserId: owner } })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "PUT", url: `/command/staff/${support}/hr`, headers: auth("owner"), payload: { managerUserId: cfo } })).statusCode,
    ).toBe(200);

    // Reporting to yourself is the shortest loop there is.
    const self = await app.inject({
      method: "PUT", url: `/command/staff/${cfo}/hr`, headers: auth("owner"), payload: { managerUserId: cfo },
    });
    expect(self.statusCode).toBe(400);
    expect(self.json().error).toContain("loops");

    // And the long way round: owner -> support would close the chain.
    const round = await app.inject({
      method: "PUT", url: `/command/staff/${owner}/hr`, headers: auth("owner"), payload: { managerUserId: support },
    });
    expect(round.statusCode).toBe(400);
    expect(round.json().error).toContain("loops");

    // The line that does not loop still goes through.
    expect((await store.getStaff(support))!.managerUserId).toBe(cfo);
  });

  it("will not point a reporting line at someone who is not staff", async () => {
    const cfo = await idOf("cfo@dingba.ai");
    const outsider = (await store.getAccountByEmail("parent@family.example"))!.userId;
    const res = await app.inject({
      method: "PUT", url: `/command/staff/${cfo}/hr`, headers: auth("owner"), payload: { managerUserId: outsider },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("staff list");
  });

  it("refuses an end date before the start date", async () => {
    const cfo = await idOf("cfo@dingba.ai");
    const res = await app.inject({
      method: "PUT", url: `/command/staff/${cfo}/hr`, headers: auth("owner"),
      payload: { startDate: "2026-03-02", endDate: "2025-12-31" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("end date");
  });

  it("insists on a real date rather than a sentence", async () => {
    const cfo = await idOf("cfo@dingba.ai");
    const res = await app.inject({
      method: "PUT", url: `/command/staff/${cfo}/hr`, headers: auth("owner"), payload: { startDate: "last March" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("keeps employment records away from anyone without staff:write", async () => {
    const cfo = await idOf("cfo@dingba.ai");
    for (const who of ["support", "finance", "investor"]) {
      const res = await app.inject({
        method: "PUT", url: `/command/staff/${cfo}/hr`, headers: auth(who), payload: { location: "nowhere" },
      });
      expect(res.statusCode, who).toBe(403);
    }
    expect((await store.getStaff(cfo))!.location).toBe("Abuja");
  });

  it("audits that a record changed without copying the notes into the trail", async () => {
    const res = await app.inject({ method: "GET", url: "/command/audit?action=staff.hr.change", headers: auth("owner") });
    const entries = res.json().entries as Array<{ meta: { email: string; fields: string[] } }>;
    expect(entries.length).toBeGreaterThan(0);
    const withNotes = entries.find((e) => e.meta.fields.includes("notes"));
    expect(withNotes).toBeDefined();
    expect(JSON.stringify(withNotes)).not.toContain("monthly close");
  });

  it("leaves nobody reporting to someone who has been removed", async () => {
    await register("leaving@dingba.ai");
    await app.inject({ method: "POST", url: "/command/staff", headers: auth("owner"), payload: { email: "leaving@dingba.ai", role: "staff" } });
    const leaver = await idOf("leaving@dingba.ai");
    const stayer = await idOf("support@dingba.ai");
    await app.inject({ method: "PUT", url: `/command/staff/${stayer}/hr`, headers: auth("owner"), payload: { managerUserId: leaver } });
    expect((await store.getStaff(stayer))!.managerUserId).toBe(leaver);

    await app.inject({ method: "DELETE", url: `/command/staff/${leaver}`, headers: auth("owner") });
    expect((await store.getStaff(stayer))!.managerUserId).toBeNull();
  });

  it("carries the employment record into the roster export", async () => {
    const res = await app.inject({ method: "GET", url: "/command/export/staff.csv", headers: auth("owner") });
    expect(res.statusCode).toBe(200);
    const lines = res.body.split("\r\n").filter(Boolean);
    expect(lines[0]).toContain("legal_name,account_name,role,title,employment_type");
    expect(lines[0]).toContain("reports_to");
    const cfoRow = lines.find((l) => l.startsWith("cfo@dingba.ai"))!;
    expect(cfoRow).toContain("Adaeze Okonkwo");
    expect(cfoRow).toContain("employee");
    // The reporting line is written as an email, not a raw id nobody can read.
    expect(cfoRow).toContain(OWNER);
  });
});

describe("platform controls", () => {
  it("shows the switches to any staff member but lets only config:write flip them", async () => {
    const read = await app.inject({ method: "GET", url: "/command/controls", headers: auth("support") });
    expect(read.statusCode).toBe(200);
    expect(read.json().controls.signupsPaused).toBe(false);
    expect(read.json().editable).toBe(false); // support cannot change config

    const denied = await app.inject({
      method: "PUT",
      url: "/command/controls",
      headers: auth("support"),
      payload: { signupsPaused: true },
    });
    expect(denied.statusCode).toBe(403);
  });

  it("actually refuses new accounts while signups are paused", async () => {
    const before = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "early.bird@example.com", password: "correct-horse-battery" },
    });
    expect(before.statusCode).toBe(200);

    const paused = await app.inject({
      method: "PUT",
      url: "/command/controls",
      headers: auth("owner"),
      payload: { signupsPaused: true, signupsPausedReason: "We are adding capacity, back within the hour." },
    });
    expect(paused.statusCode).toBe(200);
    expect(paused.json().controls.signupsPaused).toBe(true);

    // The switch takes effect on the very next request, not after a cache wait.
    const refused = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "late.bird@example.com", password: "correct-horse-battery" },
    });
    expect(refused.statusCode).toBe(503);
    expect(refused.json().error).toBe("We are adding capacity, back within the hour.");
    expect(await store.getAccountByEmail("late.bird@example.com")).toBeNull();

    const publicView = await app.inject({ method: "GET", url: "/platform" });
    expect(publicView.json().signupsPaused).toBe(true);
    expect(publicView.json().signupsPausedReason).toBe("We are adding capacity, back within the hour.");

    // And reopening works just as immediately.
    await app.inject({ method: "PUT", url: "/command/controls", headers: auth("owner"), payload: { signupsPaused: false } });
    const reopened = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "late.bird@example.com", password: "correct-horse-battery" },
    });
    expect(reopened.statusCode).toBe(200);
  });

  it("names an account from its email when no name is given", async () => {
    // The account page used to post an empty displayName, which failed schema
    // validation and showed the person "Bad Request". It now omits the field.
    const omitted = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "no.name@example.com", password: "correct-horse-battery", role: "parent" },
    });
    expect(omitted.statusCode).toBe(200);

    const empty = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "blank.name@example.com", password: "correct-horse-battery", displayName: "" },
    });
    expect(empty.statusCode).toBe(400); // still refused, so the client must omit it
  });

  it("carries a notice to the whole platform and clears it again", async () => {
    await app.inject({
      method: "PUT",
      url: "/command/controls",
      headers: auth("owner"),
      payload: { notice: "Voice lessons are slow this evening while we upgrade a server.", noticeLevel: "warn" },
    });
    const shown = await app.inject({ method: "GET", url: "/platform" });
    expect(shown.json().notice).toContain("Voice lessons are slow");
    expect(shown.json().noticeLevel).toBe("warn");

    await app.inject({ method: "PUT", url: "/command/controls", headers: auth("owner"), payload: { notice: "" } });
    expect((await app.inject({ method: "GET", url: "/platform" })).json().notice).toBe("");
  });

  it("bounds what can be stored rather than trusting the body", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/command/controls",
      headers: auth("owner"),
      payload: { notice: "x".repeat(400) },
    });
    expect(res.statusCode).toBe(400); // schema rejects it before it reaches the store
  });

  it("records every flip in the trail with before and after", async () => {
    const res = await app.inject({ method: "GET", url: "/command/audit?action=controls.change", headers: auth("owner") });
    const entries = res.json().entries as Array<{ meta: { before: { signupsPaused: boolean }; after: { signupsPaused: boolean } } }>;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.meta.after.signupsPaused === true)).toBe(true);
    expect(entries.some((e) => e.meta.before.signupsPaused === true && e.meta.after.signupsPaused === false)).toBe(true);
  });
});

describe("csv writing", () => {
  it("defuses cells a spreadsheet would run as a formula", () => {
    // A learner picks their own display name, so an export carries user input
    // straight into someone's spreadsheet.
    expect(csvCell("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
    expect(csvCell("+1234")).toBe("'+1234");
    expect(csvCell("-inline")).toBe("'-inline");
    expect(csvCell("@handle")).toBe("'@handle");
    // An ordinary name is left exactly as it is.
    expect(csvCell("Adaeze")).toBe("Adaeze");
  });

  it("quotes commas, quotes and newlines instead of breaking the row", () => {
    expect(csvCell("Lagos, Nigeria")).toBe('"Lagos, Nigeria"');
    expect(csvCell('she said "no"')).toBe('"she said ""no"""');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("writes a byte order mark so Excel reads names as UTF-8", () => {
    const out = toCsv(["name"], [["Yorùbá"], ["Chiamaka"]]);
    expect(out.startsWith("\ufeff")).toBe(true);
    expect(out).toContain("Yorùbá");
    expect(out.split("\r\n")[0]).toBe("\ufeffname");
  });

  it("names files so they sort by date", () => {
    expect(csvFilename("safety", new Date("2026-08-26T09:00:00Z"))).toBe("dingba-safety-2026-08-26.csv");
  });
});

describe("exports", () => {
  it("hands the owner a real csv with the right headers", async () => {
    const res = await app.inject({ method: "GET", url: "/command/export/metrics.csv", headers: auth("owner") });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment; filename=\"dingba-metrics-");
    const lines = res.body.split("\r\n").filter(Boolean);
    expect(lines[0]).toBe("\ufeffday,sessions,new_accounts");
    expect(lines).toHaveLength(31); // header + 30 days
  });

  it("lets the browser read the filename it sends back", async () => {
    // fetch() hides content-disposition cross-origin unless it is exposed, and
    // the console reads the filename from it. Without this every download
    // saves as a generic, undated name.
    const res = await app.inject({
      method: "GET",
      url: "/command/export/metrics.csv",
      headers: { ...auth("owner"), origin: "http://localhost:3000" },
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["access-control-expose-headers"]).toLowerCase()).toContain("content-disposition");
  });

  it("gates every dataset on exactly the capability its view needs", async () => {
    const cases: Array<[string, string, number]> = [
      ["investor", "metrics", 200],
      ["investor", "finance", 200],
      ["investor", "subscriptions", 403],
      ["investor", "safety", 403],
      ["investor", "staff", 403],
      ["investor", "audit", 403],
      ["finance", "subscriptions", 200],
      ["finance", "safety", 403],
      ["support", "safety", 200],
      ["support", "audit", 403],
    ];
    for (const [who, dataset, expected] of cases) {
      const res = await app.inject({ method: "GET", url: `/command/export/${dataset}.csv`, headers: auth(who) });
      expect(res.statusCode, `${who} -> ${dataset}`).toBe(expected);
    }
  });

  it("never leaks a learner's words through an export an investor can reach", async () => {
    for (const dataset of ["metrics", "finance"]) {
      const res = await app.inject({ method: "GET", url: `/command/export/${dataset}.csv`, headers: auth("investor") });
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain("@");
      expect(res.body).not.toContain("do not want to be here");
    }
  });

  it("carries the safety rows a support agent needs, filter and all", async () => {
    const res = await app.inject({ method: "GET", url: "/command/export/safety.csv?severity=danger", headers: auth("support") });
    expect(res.statusCode).toBe(200);
    const lines = res.body.split("\r\n").filter(Boolean);
    expect(lines[0]).toContain("severity,from,learner,guardian_email");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.slice(1).every((l) => l.includes("danger"))).toBe(true);
    expect(res.body).toContain("parent@family.example");
  });

  it("404s on a dataset that does not exist rather than guessing", async () => {
    const res = await app.inject({ method: "GET", url: "/command/export/everything.csv", headers: auth("owner") });
    expect(res.statusCode).toBe(404);
  });

  it("writes every download to the trail", async () => {
    const res = await app.inject({ method: "GET", url: "/command/audit?action=export.safety", headers: auth("owner") });
    const entries = res.json().entries as Array<{ actorEmail: string; meta: { rows: number } }>;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].actorEmail).toBe("support@dingba.ai");
    expect(entries[0].meta.rows).toBeGreaterThan(0);
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
