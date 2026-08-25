import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Store } from "../store/types.js";
import { audit } from "./audit.js";
import { capabilitiesFor, can, isStaffRole, STAFF_ROLES, type Capability, type StaffRole } from "./rbac.js";

/**
 * The Command Centre API: the backend of everything. Metrics, money, people,
 * staff, and the audit trail, behind one capability check per route.
 *
 * Two rules run through the whole file.
 *
 * 1. Access is decided here, on the server, per capability. The web console
 *    hides what you cannot use, but hiding is decoration; this is the lock.
 * 2. Investors and general staff never receive personally identifying data.
 *    Their roles simply do not hold `people:read`, `safety:read` or
 *    `finance:detail`, so every route that returns a name, an email, or a
 *    transcript line refuses them with a 403.
 */

export interface CommandActor {
  userId: string;
  email: string;
  role: StaffRole;
  title: string | null;
}

const PAID_PLANS = ["plus", "premium"] as const;

/** Emails that always hold the owner role, so the first login works. */
function bootstrapOwners(env: Record<string, string | undefined>): string[] {
  return (env.COMMAND_OWNER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

function monthlyPrice(env: Record<string, string | undefined>, plan: string): number | null {
  const raw = plan === "plus" ? env.PRICE_PLUS_MONTHLY : plan === "premium" ? env.PRICE_PREMIUM_MONTHLY : undefined;
  const n = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(n) && n >= 0 ? n : null;
}

export async function registerCommandCentre(
  app: FastifyInstance,
  store: Store,
  env: Record<string, string | undefined>,
  userFromRequest: (req: FastifyRequest) => Promise<{ userId: string; email: string; role: string } | null>,
) {
  const owners = bootstrapOwners(env);

  /**
   * Resolves the caller to a Command Centre actor, or answers the request and
   * returns null. A bootstrap owner is written into the roster on first sight
   * so the staff page shows a complete list rather than a mysterious gap.
   */
  async function actorFor(req: FastifyRequest, reply: FastifyReply): Promise<CommandActor | null> {
    const user = await userFromRequest(req);
    if (!user) {
      reply.code(401).send({ error: "sign in required" });
      return null;
    }
    const existing = await store.getStaff(user.userId);
    if (owners.includes(user.email.toLowerCase())) {
      if (!existing || existing.role !== "owner" || existing.status !== "active") {
        await store.upsertStaff({ userId: user.userId, role: "owner", status: "active" });
      }
      await store.touchStaffSeen(user.userId);
      return { userId: user.userId, email: user.email, role: "owner", title: existing?.title ?? null };
    }
    if (!existing) {
      reply.code(403).send({ error: "this account does not have command centre access" });
      return null;
    }
    if (existing.status !== "active") {
      reply.code(403).send({ error: "this command centre account is suspended" });
      return null;
    }
    if (!isStaffRole(existing.role)) {
      reply.code(403).send({ error: "this command centre account has no usable role" });
      return null;
    }
    await store.touchStaffSeen(user.userId);
    return { userId: user.userId, email: user.email, role: existing.role, title: existing.title };
  }

  /** Actor plus capability, in one call. Null means the reply is already sent. */
  async function requireCap(
    req: FastifyRequest,
    reply: FastifyReply,
    capability: Capability,
  ): Promise<CommandActor | null> {
    const actor = await actorFor(req, reply);
    if (!actor) return null;
    if (!can(actor.role, capability)) {
      reply.code(403).send({ error: `your role does not have access to this (${capability})` });
      return null;
    }
    return actor;
  }

  const ipOf = (req: FastifyRequest) => req.ip;
  const clampDays = (raw: unknown) => {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(1, Math.min(365, Math.floor(n))) : 30;
  };

  // ---- Identity ----

  /** What this console may show. The web app builds its nav from this. */
  app.get("/command/me", async (req, reply) => {
    const actor = await actorFor(req, reply);
    if (!actor) return;
    return {
      userId: actor.userId,
      email: actor.email,
      role: actor.role,
      title: actor.title,
      capabilities: capabilitiesFor(actor.role),
    };
  });

  // ---- Metrics ----

  app.get<{ Querystring: { days?: string } }>("/command/metrics", async (req, reply) => {
    const actor = await requireCap(req, reply, "metrics:read");
    if (!actor) return;
    const days = clampDays(req.query.days);
    const metrics = await store.platformMetrics(days);
    return { days, metrics };
  });

  // ---- Money ----

  /**
   * Revenue is computed from the live subscription table and the prices the
   * founder sets alongside the processor keys. When those prices are unset we
   * report `pricesConfigured: false` and return counts only, because a made-up
   * revenue figure in front of an investor is worse than an honest blank.
   */
  app.get("/command/finance", async (req, reply) => {
    const actor = await requireCap(req, reply, "finance:aggregate");
    if (!actor) return;

    const metrics = await store.platformMetrics(30);
    const byPlan = new Map<string, number>(metrics.planMix.map((p) => [p.plan, p.count]));
    const prices: Record<string, number | null> = Object.fromEntries(
      PAID_PLANS.map((p) => [p, monthlyPrice(env, p)]),
    );
    const pricesConfigured = PAID_PLANS.every((p) => prices[p] !== null);

    const lines = PAID_PLANS.map((plan) => {
      const subscribers = byPlan.get(plan) ?? 0;
      const price = prices[plan];
      return {
        plan,
        subscribers,
        monthlyPrice: price,
        monthlyRevenue: price === null ? null : Math.round(price * subscribers * 100) / 100,
      };
    });
    const mrr = pricesConfigured
      ? Math.round(lines.reduce((sum, l) => sum + (l.monthlyRevenue ?? 0), 0) * 100) / 100
      : null;

    const body: Record<string, unknown> = {
      currency: env.PRICE_CURRENCY ?? "USD",
      pricesConfigured,
      mrr,
      arr: mrr === null ? null : Math.round(mrr * 12 * 100) / 100,
      activeSubscriptions: metrics.paidSubscriptions,
      freeAccounts: byPlan.get("free") ?? 0,
      lines,
    };

    // Only finance:detail sees who is paying. Investors stop at the totals.
    if (can(actor.role, "finance:detail")) {
      body.subscriptions = await store.listSubscriptions(50);
      await audit(store, actor, "finance.detail.read", { ip: ipOf(req) });
    }
    return body;
  });

  // ---- People (support desk) ----

  app.get<{ Querystring: { q?: string } }>("/command/people", async (req, reply) => {
    const actor = await requireCap(req, reply, "people:read");
    if (!actor) return;
    const q = (req.query.q ?? "").trim();
    if (q.length < 2) {
      return reply.code(400).send({ error: "search with at least two characters" });
    }
    const results = await store.searchAccounts(q, 25);
    // Searching for people is itself a privileged act, so it leaves a trace.
    await audit(store, actor, "people.search", { meta: { query: q, hits: results.length }, ip: ipOf(req) });
    return { query: q, results };
  });

  app.get<{ Params: { userId: string } }>("/command/people/:userId", async (req, reply) => {
    const actor = await requireCap(req, reply, "people:read");
    if (!actor) return;
    const account = await store.getAccountById(req.params.userId);
    if (!account) return reply.code(404).send({ error: "no account with that id" });

    const profiles = await store.listStudentProfiles(account.userId);
    const learners = [];
    for (const p of profiles) {
      learners.push({
        id: p.id,
        displayName: p.displayName,
        streakDays: await store.getStreakDays(p.id),
        recentSessions: await store.listSessionSummaries(p.id, 5),
        // Safety detail is a separate capability; support has it, finance does not.
        incidents: can(actor.role, "safety:read") ? await store.listIncidents(p.id, 10) : undefined,
      });
    }
    await audit(store, actor, "people.read", { target: account.userId, ip: ipOf(req) });
    return {
      account,
      subscription: await store.getSubscription(account.userId),
      emailVerified: await store.isEmailVerified(account.userId),
      learners,
    };
  });

  app.post<{ Params: { userId: string }; Body: { plan: string; reason?: string } }>(
    "/command/people/:userId/plan",
    {
      schema: {
        body: {
          type: "object",
          required: ["plan"],
          properties: {
            plan: { type: "string", enum: ["free", "plus", "premium"] },
            reason: { type: "string", maxLength: 280 },
          },
        },
      },
    },
    async (req, reply) => {
      const actor = await requireCap(req, reply, "people:write");
      if (!actor) return;
      const account = await store.getAccountById(req.params.userId);
      if (!account) return reply.code(404).send({ error: "no account with that id" });
      const changed = await store.setUserPlan(account.email, req.body.plan);
      if (!changed) return reply.code(404).send({ error: "no account with that id" });
      await audit(store, actor, "people.plan.change", {
        target: account.userId,
        meta: { from: account.plan, to: req.body.plan, reason: req.body.reason ?? null },
        ip: ipOf(req),
      });
      return { userId: account.userId, plan: req.body.plan };
    },
  );

  // ---- Staff and investors ----

  app.get("/command/staff", async (req, reply) => {
    const actor = await requireCap(req, reply, "staff:read");
    if (!actor) return;
    return { roles: STAFF_ROLES, staff: await store.listStaff() };
  });

  app.post<{ Body: { email: string; role: string; title?: string; status?: "active" | "suspended" } }>(
    "/command/staff",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "role"],
          properties: {
            email: { type: "string", minLength: 3, maxLength: 254 },
            role: { type: "string", enum: [...STAFF_ROLES] },
            title: { type: "string", maxLength: 80 },
            status: { type: "string", enum: ["active", "suspended"] },
          },
        },
      },
    },
    async (req, reply) => {
      const actor = await requireCap(req, reply, "staff:write");
      if (!actor) return;
      const account = await store.getAccountByEmail(req.body.email);
      if (!account) {
        return reply.code(404).send({ error: "that person needs a Dingba account first" });
      }
      if (account.userId === actor.userId) {
        // No self-promotion, no self-demotion, no accidental self-lockout.
        return reply.code(400).send({ error: "you cannot change your own command centre role" });
      }
      const before = await store.getStaff(account.userId);
      await store.upsertStaff({
        userId: account.userId,
        role: req.body.role,
        title: req.body.title,
        status: req.body.status,
        invitedBy: actor.userId,
      });
      await audit(store, actor, before ? "staff.update" : "staff.add", {
        target: account.userId,
        meta: { email: req.body.email, from: before?.role ?? null, to: req.body.role },
        ip: ipOf(req),
      });
      return reply.code(before ? 200 : 201).send({ staff: await store.getStaff(account.userId) });
    },
  );

  app.delete<{ Params: { userId: string } }>("/command/staff/:userId", async (req, reply) => {
    const actor = await requireCap(req, reply, "staff:write");
    if (!actor) return;
    if (req.params.userId === actor.userId) {
      return reply.code(400).send({ error: "you cannot remove your own command centre access" });
    }
    const target = await store.getStaff(req.params.userId);
    if (!target) return reply.code(404).send({ error: "that person is not on the staff list" });
    if (target.role === "owner") {
      const ownerRows = (await store.listStaff()).filter((s) => s.role === "owner");
      // The platform must never be left without an owner.
      if (ownerRows.length <= 1) return reply.code(400).send({ error: "the last owner cannot be removed" });
    }
    await store.removeStaff(req.params.userId);
    await audit(store, actor, "staff.remove", {
      target: req.params.userId,
      meta: { email: target.email, role: target.role },
      ip: ipOf(req),
    });
    return { removed: req.params.userId };
  });

  // ---- The trail ----

  app.get<{ Querystring: { limit?: string; action?: string } }>("/command/audit", async (req, reply) => {
    const actor = await requireCap(req, reply, "audit:read");
    if (!actor) return;
    const n = Number(req.query.limit);
    const limit = Number.isFinite(n) ? Math.max(1, Math.min(200, Math.floor(n))) : 100;
    return { entries: await store.listAudit(limit, { action: req.query.action }) };
  });
}
