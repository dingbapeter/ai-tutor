import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { EMPLOYMENT_TYPES, type StaffHr, type StaffMember, type Store } from "../store/types.js";
import { audit } from "./audit.js";
import { capabilitiesFor, can, isStaffRole, STAFF_ROLES, type Capability, type StaffRole } from "./rbac.js";
import { normalize, type ControlsReader, type PlatformControls } from "./settings.js";
import { csvFilename, toCsv } from "./csv.js";
import type { Metrics } from "../ops/metrics.js";

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
  controls: ControlsReader,
  metrics: Metrics,
  aiQueue?: { stats(): unknown } | null,
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

    // Trouble is aggregate: how many renewals failed and refunds went out,
    // with nobody named. Investors deserve the honest number too.
    const now = Date.now();
    body.trouble = {
      week: await store.countBillingTroubleSince(new Date(now - 7 * 86_400_000)),
      month: await store.countBillingTroubleSince(new Date(now - 30 * 86_400_000)),
    };

    // Only finance:detail sees who is paying. Investors stop at the totals.
    if (can(actor.role, "finance:detail")) {
      body.subscriptions = await store.listSubscriptions(50);
      body.events = await store.listBillingEvents(50);
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

  // ---- Platform controls ----

  /**
   * The switches, and flipping them. Everything here is honoured on the
   * request path, so a control that reads "signups paused" means the next
   * registration is actually refused.
   */
  app.get("/command/controls", async (req, reply) => {
    const actor = await requireCap(req, reply, "metrics:read");
    if (!actor) return;
    return { controls: await controls.get(), editable: can(actor.role, "config:write") };
  });

  app.put<{ Body: Partial<PlatformControls> }>(
    "/command/controls",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            signupsPaused: { type: "boolean" },
            signupsPausedReason: { type: "string", maxLength: 280 },
            notice: { type: "string", maxLength: 280 },
            noticeLevel: { type: "string", enum: ["info", "warn"] },
          },
        },
      },
    },
    async (req, reply) => {
      const actor = await requireCap(req, reply, "config:write");
      if (!actor) return;
      const before = await controls.get();
      const after = await controls.set(normalize({ ...before, ...req.body } as Record<string, unknown>), actor.userId);
      await audit(store, actor, "controls.change", { meta: { before, after }, ip: ipOf(req) });
      return { controls: after };
    },
  );

  /**
   * The platform's pulse: request rates, latency, failures, memory, the
   * event loop. Owner and admin only, because raw error messages can name
   * internals that nobody else needs to see.
   */
  app.get("/command/ops", async (req, reply) => {
    const actor = await requireCap(req, reply, "config:write");
    if (!actor) return;
    // aiQueue is the bounded line in front of the model box; null means the
    // configured providers need no queue (mock, or a paid API).
    return { ...metrics.summary(), aiQueue: aiQueue ? aiQueue.stats() : null };
  });

  // ---- Safety desk ----

  /**
   * Every flag on the platform, without having to know which family to look
   * for first. On a product children use, this is the screen that matters
   * most, so danger is separated from concern rather than averaged into it.
   */
  app.get<{ Querystring: { severity?: string; limit?: string } }>("/command/safety", async (req, reply) => {
    const actor = await requireCap(req, reply, "safety:read");
    if (!actor) return;
    const severity = req.query.severity === "danger" || req.query.severity === "concern" ? req.query.severity : undefined;
    const n = Number(req.query.limit);
    const limit = Number.isFinite(n) ? Math.max(1, Math.min(200, Math.floor(n))) : 50;
    const now = Date.now();
    const [incidents, today, week] = await Promise.all([
      store.listPlatformIncidents(limit, { severity }),
      store.countIncidentsSince(new Date(now - 24 * 60 * 60 * 1000)),
      store.countIncidentsSince(new Date(now - 7 * 24 * 60 * 60 * 1000)),
    ]);
    // Reading children's flagged words is as privileged as it gets here.
    await audit(store, actor, "safety.read", { meta: { severity: severity ?? "all", shown: incidents.length }, ip: ipOf(req) });
    return { severity: severity ?? null, today, week, incidents };
  });

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

  // ---- Exports ----

  /**
   * The same views, as files. Each dataset needs exactly the capability its
   * on-screen view needs, so an export can never be a way around the matrix,
   * and every download is written to the trail.
   */
  const EXPORTS: Record<string, Capability> = {
    metrics: "metrics:read",
    finance: "finance:aggregate",
    subscriptions: "finance:detail",
    payments: "finance:detail",
    safety: "safety:read",
    staff: "staff:read",
    audit: "audit:read",
  };

  app.get<{ Params: { dataset: string }; Querystring: { days?: string; severity?: string } }>(
    "/command/export/:dataset.csv",
    async (req, reply) => {
      const dataset = req.params.dataset;
      const needed = EXPORTS[dataset];
      if (!needed) return reply.code(404).send({ error: "there is no export by that name" });
      const actor = await requireCap(req, reply, needed);
      if (!actor) return;

      let headers: string[] = [];
      let rows: Array<Array<unknown>> = [];

      if (dataset === "metrics") {
        const days = clampDays(req.query.days);
        const m = await store.platformMetrics(days);
        const signups = new Map(m.signupsSeries.map((p) => [p.day, p.count]));
        headers = ["day", "sessions", "new_accounts"];
        rows = m.sessionsSeries.map((p) => [p.day, p.count, signups.get(p.day) ?? 0]);
      } else if (dataset === "finance") {
        const m = await store.platformMetrics(30);
        headers = ["plan", "accounts"];
        rows = m.planMix.map((p) => [p.plan, p.count]);
      } else if (dataset === "subscriptions") {
        headers = ["account", "plan", "status", "processor", "reference", "updated_at"];
        rows = (await store.listSubscriptions(1000)).map((r) => [
          r.email, r.plan, r.status, r.provider, r.subscriptionRef, r.updatedAt,
        ]);
      } else if (dataset === "payments") {
        headers = ["at", "provider", "type", "account", "plan", "amount_minor", "currency", "matched", "reference"];
        rows = (await store.listBillingEvents(1000)).map((e) => [
          e.createdAt, e.provider, e.type, e.email ?? "", e.plan ?? "",
          e.amountMinor ?? "", e.currency ?? "", e.matched ? "yes" : "NO", e.subscriptionRef ?? e.customerRef ?? "",
        ]);
      } else if (dataset === "safety") {
        const severity = req.query.severity === "danger" || req.query.severity === "concern" ? req.query.severity : undefined;
        headers = ["raised_at", "severity", "from", "learner", "guardian_email", "categories", "excerpt"];
        rows = (await store.listPlatformIncidents(500, { severity })).map((i) => [
          i.createdAt, i.severity, i.direction, i.studentName, i.guardianEmail ?? "", i.categories.join(" "), i.excerpt,
        ]);
      } else if (dataset === "staff") {
        const roster = await store.listStaff();
        const emailOf = new Map(roster.map((m) => [m.userId, m.email]));
        headers = [
          "email", "legal_name", "account_name", "role", "title", "employment_type",
          "start_date", "end_date", "reports_to", "location", "console_status", "added_at", "last_seen_at",
        ];
        rows = roster.map((m) => [
          m.email, m.fullName ?? "", m.displayName ?? "", m.role, m.title ?? "", m.employmentType ?? "",
          m.startDate ?? "", m.endDate ?? "", m.managerUserId ? emailOf.get(m.managerUserId) ?? "" : "",
          m.location ?? "", m.status, m.createdAt, m.lastSeenAt ?? "",
        ]);
      } else {
        headers = ["at", "actor", "role", "action", "target", "details", "ip"];
        rows = (await store.listAudit(1000)).map((e) => [
          e.createdAt, e.actorEmail, e.actorRole, e.action, e.target ?? "",
          Object.keys(e.meta).length ? JSON.stringify(e.meta) : "", e.ip ?? "",
        ]);
      }

      await audit(store, actor, `export.${dataset}`, { meta: { rows: rows.length }, ip: ipOf(req) });
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${csvFilename(dataset, new Date())}"`)
        .send(toCsv(headers, rows));
    },
  );

  // ---- Employment records ----

  /**
   * A reporting line must be a tree, not a knot. Walking up from the proposed
   * manager, anyone who reaches the person being edited would create a loop,
   * which would hang every org chart that ever tried to render it.
   */
  function wouldLoop(roster: StaffMember[], userId: string, managerUserId: string): boolean {
    if (managerUserId === userId) return true;
    const byId = new Map(roster.map((m) => [m.userId, m]));
    const seen = new Set<string>();
    let cursor: string | null = managerUserId;
    while (cursor && !seen.has(cursor)) {
      if (cursor === userId) return true;
      seen.add(cursor);
      cursor = byId.get(cursor)?.managerUserId ?? null;
    }
    return false;
  }

  app.put<{ Params: { userId: string }; Body: StaffHr }>(
    "/command/staff/:userId/hr",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            fullName: { type: ["string", "null"], maxLength: 120 },
            employmentType: { type: ["string", "null"], enum: [...EMPLOYMENT_TYPES, null] },
            // A start date is a day, so it is stored as one.
            startDate: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            endDate: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            managerUserId: { type: ["string", "null"], format: "uuid" },
            location: { type: ["string", "null"], maxLength: 120 },
            notes: { type: ["string", "null"], maxLength: 2000 },
          },
        },
      },
    },
    async (req, reply) => {
      const actor = await requireCap(req, reply, "staff:write");
      if (!actor) return;
      const roster = await store.listStaff();
      const target = roster.find((m) => m.userId === req.params.userId);
      if (!target) return reply.code(404).send({ error: "that person is not on the staff list" });

      const hr = req.body;
      if (hr.startDate && hr.endDate && hr.endDate < hr.startDate) {
        return reply.code(400).send({ error: "the end date cannot fall before the start date" });
      }
      if (hr.managerUserId) {
        if (!roster.some((m) => m.userId === hr.managerUserId)) {
          return reply.code(400).send({ error: "a manager has to be on the staff list too" });
        }
        if (wouldLoop(roster, target.userId, hr.managerUserId)) {
          return reply.code(400).send({ error: "that reporting line loops back on itself" });
        }
      }

      await store.updateStaffHr(target.userId, hr);
      // Notes can carry sensitive detail, so record that it changed, not what to.
      await audit(store, actor, "staff.hr.change", {
        target: target.userId,
        meta: { email: target.email, fields: Object.keys(hr) },
        ip: ipOf(req),
      });
      return { staff: await store.getStaff(target.userId) };
    },
  );

  // ---- The trail ----

  app.get<{ Querystring: { limit?: string; action?: string } }>("/command/audit", async (req, reply) => {
    const actor = await requireCap(req, reply, "audit:read");
    if (!actor) return;
    const n = Number(req.query.limit);
    const limit = Number.isFinite(n) ? Math.max(1, Math.min(200, Math.floor(n))) : 100;
    return { entries: await store.listAudit(limit, { action: req.query.action }) };
  });
}
