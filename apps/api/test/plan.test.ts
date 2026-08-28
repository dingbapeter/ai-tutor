import { describe, expect, it, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildStudyPlan, planReminder, type PlanInputs } from "../src/tutor/plan.js";
import {
  MockChatProvider,
  MockSttProvider,
  MockTtsProvider,
  MockVisionProvider,
  RulesModerationProvider,
} from "@tutor/ai-gateway";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/store/memory.js";

/**
 * The study planner. Pure-function rules first, then the endpoint over the
 * real app so ownership gating and input assembly are covered too.
 */

const NOW = new Date("2026-08-31T08:00:00Z"); // a Monday

function inputs(over: Partial<PlanInputs> = {}): PlanInputs {
  return {
    dueSkills: [],
    mastery: [],
    routine: null,
    streakDays: 0,
    now: NOW,
    ...over,
  };
}

describe("the planning rules", () => {
  it("always produces seven days starting today, in order", () => {
    const plan = buildStudyPlan(inputs());
    expect(plan.days).toHaveLength(7);
    expect(plan.days[0].date).toBe("2026-08-31");
    expect(plan.days[0].weekday).toBe("Monday");
    expect(plan.days[6].date).toBe("2026-09-06");
    // Every day has something, even when there is nothing to do.
    expect(plan.days.every((d) => d.items.length > 0)).toBe(true);
    expect(plan.days.every((d) => d.items.every((i) => i.why.length > 0))).toBe(true);
  });

  it("puts overdue review before new practice, because forgetting compounds", () => {
    const plan = buildStudyPlan(
      inputs({
        dueSkills: [{ skillId: "s.due", title: "One-step equations", level: 0.8 }],
        mastery: [
          { skillId: "s.due", title: "One-step equations", level: 0.8, attempts: 5 },
          { skillId: "s.weak", title: "Fractions", level: 0.3, attempts: 2 },
        ],
      }),
    );
    const first = plan.days[0].items;
    expect(first[0]).toMatchObject({ kind: "review", skillId: "s.due" });
    expect(first[1]).toMatchObject({ kind: "practice", skillId: "s.weak" });
  });

  it("skips practice for skills never attempted and for skills already strong", () => {
    const plan = buildStudyPlan(
      inputs({
        mastery: [
          { skillId: "s.new", title: "Untouched", level: 0, attempts: 0 },
          { skillId: "s.strong", title: "Solid", level: 0.9, attempts: 6 },
        ],
      }),
    );
    const kinds = plan.days.flatMap((d) => d.items).map((i) => i.kind);
    expect(kinds).not.toContain("practice");
    expect(plan.days[0].items[0].kind).toBe("rest");
  });

  it("lightens the plan on days the real timetable is heavy", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      skillId: `s${i}`, title: `Skill ${i}`, level: 0.4,
    }));
    const plan = buildStudyPlan(
      inputs({
        dueSkills: many,
        routine: {
          subjects: ["Maths"],
          weekly: [
            { day: "Tuesday", blocks: Array.from({ length: 6 }, () => ({ subject: "School" })) },
            { day: "Wednesday", blocks: [{ subject: "Football" }] },
          ],
          examDates: [],
          notes: "",
        },
      }),
    );
    const byDay = Object.fromEntries(plan.days.map((d) => [d.weekday, d]));
    expect(byDay.Tuesday.load).toBe("busy");
    expect(byDay.Tuesday.items).toHaveLength(1);
    expect(byDay.Wednesday.load).toBe("light");
    expect(byDay.Wednesday.items).toHaveLength(2);
    expect(byDay.Monday.load).toBe("free");
    expect(byDay.Monday.items).toHaveLength(3);
  });

  it("hands the exam eve and the exam day to revision, never new material", () => {
    const plan = buildStudyPlan(
      inputs({
        dueSkills: [{ skillId: "s.alg", title: "Algebra", level: 0.6 }],
        mastery: [{ skillId: "s.alg", title: "Algebra", level: 0.6, attempts: 4 }],
        routine: {
          subjects: ["Maths"],
          weekly: [],
          examDates: [{ date: "2026-09-02", label: "Maths mid-term" }],
          notes: "",
        },
      }),
    );
    const byDate = Object.fromEntries(plan.days.map((d) => [d.date, d]));
    expect(byDate["2026-09-01"].items[0]).toMatchObject({ kind: "exam-prep" });
    expect(byDate["2026-09-01"].items[0].why).toContain("tomorrow");
    expect(byDate["2026-09-02"].items[0].why).toContain("today");
    expect(byDate["2026-09-02"].examLabel).toBe("Maths mid-term");
    expect(plan.headline).toContain("Maths mid-term");
  });

  it("keeps the exam on its own day even when the clock reads evening", () => {
    // The browser pass caught this: an afternoon `now` compared against the
    // exam's midnight used to round the exam day itself into "yesterday",
    // leaving a rest card on the one day that matters most.
    const evening = new Date("2026-08-31T21:45:00Z");
    const plan = buildStudyPlan(
      inputs({
        now: evening,
        dueSkills: [{ skillId: "s.alg", title: "Algebra", level: 0.6 }],
        routine: {
          subjects: [],
          weekly: [],
          examDates: [{ date: "2026-09-02", label: "Maths mid-term" }],
          notes: "",
        },
      }),
    );
    const byDate = Object.fromEntries(plan.days.map((d) => [d.date, d]));
    expect(byDate["2026-09-02"].items[0].kind).toBe("exam-prep");
    expect(byDate["2026-09-02"].items[0].why).toContain("today");
    expect(byDate["2026-09-01"].items[0].why).toContain("tomorrow");
  });

  it("ignores exam dates that are past or beyond the fortnight, and garbage dates", () => {
    const plan = buildStudyPlan(
      inputs({
        routine: {
          subjects: [],
          weekly: [],
          examDates: [
            { date: "2026-08-01", label: "Long gone" },
            { date: "2026-12-01", label: "Months away" },
            { date: "sometime soon", label: "Unparseable" },
          ],
          notes: "",
        },
      }),
    );
    expect(plan.days.flatMap((d) => d.items).every((i) => i.kind !== "exam-prep")).toBe(true);
    expect(plan.headline).not.toContain("Long gone");
  });

  it("says something honest when there is nothing to do", () => {
    expect(buildStudyPlan(inputs({ streakDays: 9 })).headline).toContain("9 day streak");
    expect(buildStudyPlan(inputs()).headline).toContain("fresh start");
  });

  it("is deterministic: same inputs, same plan", () => {
    const args = inputs({
      dueSkills: [{ skillId: "a", title: "A", level: 0.5 }],
      mastery: [{ skillId: "b", title: "B", level: 0.2, attempts: 1 }],
    });
    expect(buildStudyPlan(args)).toEqual(buildStudyPlan(args));
  });
});

describe("the reminder line", () => {
  it("names the actual item, never a generic come-study line", () => {
    const plan = buildStudyPlan(
      inputs({ dueSkills: [{ skillId: "s.frac", title: "Adding fractions", level: 0.5 }] }),
    );
    const note = planReminder(plan, "Ada");
    expect(note).toEqual({
      title: "Today's plan for Ada",
      body: "Review Adding fractions. Due for review before it fades.",
    });
  });

  it("leads with the exam on exam day", () => {
    const plan = buildStudyPlan(
      inputs({
        dueSkills: [{ skillId: "s.alg", title: "Algebra", level: 0.6 }],
        routine: { subjects: [], weekly: [], examDates: [{ date: "2026-08-31", label: "Maths mid-term" }], notes: "" },
      }),
    );
    const note = planReminder(plan, "Ada")!;
    expect(note.title).toBe("Maths mid-term is today");
    expect(note.body).toContain("revise algebra");
  });

  it("stays silent on a free day, so reminders keep meaning something", () => {
    expect(planReminder(buildStudyPlan(inputs()), "Ada")).toBeNull();
  });

  it("never carries an em dash or an internal id", () => {
    const plan = buildStudyPlan(
      inputs({ dueSkills: [{ skillId: "math-ms.frac.add", title: "Adding fractions", level: 0.5 }] }),
    );
    const note = planReminder(plan, "Ada")!;
    const text = `${note.title} ${note.body}`;
    expect(text).not.toContain("\u2014");
    expect(text).not.toContain("math-ms.");
  });
});

describe("the plan endpoint", () => {
  let app: FastifyInstance;
  let store: MemoryStore;
  let token: string;
  let studentId: string;

  beforeAll(async () => {
    store = new MemoryStore();
    const planner = new MockChatProvider();
    app = await buildApp({
      gateway: {
        chat: new MockChatProvider(), planner, premiumChat: planner,
        stt: new MockSttProvider(), tts: new MockTtsProvider(),
        vision: new MockVisionProvider(), moderation: new RulesModerationProvider(),
      },
      store,
      env: { NODE_ENV: "test", RATE_LIMIT_MAX: "10000", GUEST_IP_CAP: "100000", AUTH_RATE_LIMIT: "100000" },
    });
    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "planner@example.com", password: "correct-horse-battery", role: "student", displayName: "Zee" },
    });
    token = reg.json().token;
    studentId = reg.json().studentId;
  });

  it("requires ownership", async () => {
    const res = await app.inject({ method: "GET", url: `/students/${studentId}/plan` });
    expect(res.statusCode).toBe(401);

    const other = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "other@example.com", password: "correct-horse-battery", role: "student" },
    });
    const stranger = await app.inject({
      method: "GET",
      url: `/students/${studentId}/plan`,
      headers: { authorization: `Bearer ${other.json().token}` },
    });
    expect(stranger.statusCode).toBe(403);
  });

  it("guards the reminder run and cleans up dead devices", async () => {
    // Not configured: refused before anything else.
    const noKey = await app.inject({ method: "POST", url: "/admin/nudge-plans" });
    expect(noKey.statusCode).toBe(501);

    const webpush = (await import("web-push")).default;
    const vapid = webpush.generateVAPIDKeys();
    const armed = await buildApp({
      gateway: {
        chat: new MockChatProvider(), planner: new MockChatProvider(), premiumChat: new MockChatProvider(),
        stt: new MockSttProvider(), tts: new MockTtsProvider(),
        vision: new MockVisionProvider(), moderation: new RulesModerationProvider(),
      },
      store,
      env: {
        NODE_ENV: "test", RATE_LIMIT_MAX: "10000", GUEST_IP_CAP: "100000", AUTH_RATE_LIMIT: "100000",
        ADMIN_KEY: "secret-admin", VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey,
      },
    });

    const wrongKey = await armed.inject({ method: "POST", url: "/admin/nudge-plans", headers: { "x-admin-key": "guess" } });
    expect(wrongKey.statusCode).toBe(403);

    // A device that no longer exists: the push fails and the run prunes it
    // instead of failing forever. The learner needs something due first, or
    // the run stays quiet and never touches the device at all.
    await store.recordAttempt(studentId, "math-ms.linear-eq.one-step", false);
    const account = await store.getAccountByEmail("planner@example.com");
    await store.savePushSubscription(account!.userId, {
      endpoint: "https://push.invalid/gone-device",
      p256dh: "BOa1BB6cZTcVvQIzrwuUUyEQ_lBEYo9pV6rtNq1kZTrEbBB4bkgLraQwG1BbCgKcnln0eYdvTsK4kOfVCUt6QW8",
      auth: "8VbXY8m5nJq9pRs2tUv4Wg",
    });
    const run = await armed.inject({ method: "POST", url: "/admin/nudge-plans", headers: { "x-admin-key": "secret-admin" } });
    expect(run.statusCode).toBe(200);
    const out = run.json();
    expect(out.users).toBe(1);
    expect(out.sent).toBe(0);
    expect(out.stale).toBe(1); // the dead endpoint is gone from the store now
    expect(await store.listPushSubscriptions(account!.userId)).toHaveLength(0);
  });

  it("builds a real week from the learner's actual state", async () => {
    // A miss puts the skill straight back in the due queue.
    await store.recordAttempt(studentId, "math-ms.linear-eq.one-step", false);
    await store.saveRoutine(studentId, {
      subjects: ["Maths"],
      weekly: [{ day: "Monday", blocks: [{ subject: "School" }] }],
      examDates: [],
      notes: "",
    });
    const res = await app.inject({
      method: "GET",
      url: `/students/${studentId}/plan`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const plan = res.json();
    expect(plan.days).toHaveLength(7);
    const reviews = plan.days.flatMap((d: { items: Array<{ kind: string; title: string }> }) => d.items)
      .filter((i: { kind: string }) => i.kind === "review");
    expect(reviews.length).toBeGreaterThan(0);
    // The item names the skill in words, not an internal id.
    expect(reviews[0].title).toContain("Review ");
    expect(reviews[0].title).not.toContain("math-ms.");
  });
});
