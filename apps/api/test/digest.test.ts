import { describe, expect, it, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { composeWeeklyDigest } from "../src/email.js";
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
 * The guardian weekly digest: the composed wording pinned exactly, then the
 * run over the real app deciding who hears from us and who is left in peace.
 */

describe("the digest wording", () => {
  it("reads like a person wrote it, with the specifics in place", () => {
    const { subject, text } = composeWeeklyDigest({
      to: "parent@example.com",
      learners: [
        {
          name: "Ada",
          sessionsThisWeek: 3,
          streakDays: 5,
          dueSkills: ["One-step equations", "Adding fractions"],
          safetyFlags: 0,
          planHeadline: "2 skills due for review this week, spaced so nothing fades",
        },
      ],
    });
    expect(subject).toBe("Ada's week with Dingba");
    expect(text).toContain("Sessions this week: 3. The streak is at 5 days.");
    expect(text).toContain("Due for review: One-step equations, Adding fractions.");
    expect(text).toContain("The week ahead: 2 skills due for review");
    expect(text).not.toContain("Heads up"); // no flags, no scare line
    expect(text).not.toContain("—"); // house rule: no em dashes anywhere
  });

  it("names both learners in a family and nudges the quiet one gently", () => {
    const { subject, text } = composeWeeklyDigest({
      to: "parent@example.com",
      learners: [
        { name: "Ada", sessionsThisWeek: 2, streakDays: 2, dueSkills: [], safetyFlags: 0, planHeadline: "steady" },
        { name: "Kola", sessionsThisWeek: 0, streakDays: 0, dueSkills: [], safetyFlags: 0, planHeadline: "fresh" },
      ],
    });
    expect(subject).toBe("This week with Dingba: Ada and Kola");
    expect(text).toContain("No sessions this week. A ten minute session keeps things warm.");
  });

  it("says plainly when something was flagged, and where to look", () => {
    const { text } = composeWeeklyDigest({
      to: "parent@example.com",
      learners: [
        { name: "Ada", sessionsThisWeek: 1, streakDays: 1, dueSkills: [], safetyFlags: 2, planHeadline: "steady" },
      ],
    });
    expect(text).toContain("Heads up: 2 messages were flagged this week. The details are on your dashboard.");
  });
});

describe("the digest run", () => {
  let app: FastifyInstance;
  let store: MemoryStore;

  async function register(email: string, role: "parent" | "student" = "parent") {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password: "correct-horse-battery", displayName: email.split("@")[0], role },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as { token: string; studentId?: string };
  }

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
      env: {
        NODE_ENV: "test", RATE_LIMIT_MAX: "10000", GUEST_IP_CAP: "100000", AUTH_RATE_LIMIT: "100000",
        ADMIN_KEY: "secret-admin",
      },
    });

    // Busy family, verified: gets a digest.
    const busy = await register("busy@example.com");
    const kid = await app.inject({
      method: "POST", url: "/students",
      headers: { authorization: `Bearer ${busy.token}` },
      payload: { displayName: "Ada" },
    });
    await store.markEmailVerified((await store.getAccountByEmail("busy@example.com"))!.userId);
    await store.recordAttempt(kid.json().id, "math-ms.linear-eq.one-step", false);

    // Verified but completely quiet: left in peace.
    const calm = await register("calm@example.com", "student");
    await store.markEmailVerified((await store.getAccountByEmail("calm@example.com"))!.userId);

    // Active but never verified their email: skipped, and counted as such.
    const unver = await register("unverified@example.com", "student");
    await store.recordAttempt(unver.studentId!, "math-ms.linear-eq.one-step", false);
  });

  it("is admin-gated like every ops surface", async () => {
    expect((await app.inject({ method: "POST", url: "/admin/weekly-digest" })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: "POST", url: "/admin/weekly-digest", headers: { "x-admin-key": "guess" } })).statusCode,
    ).toBe(403);
  });

  it("writes to the busy family, spares the quiet one, skips the unverified one", async () => {
    const res = await app.inject({
      method: "POST", url: "/admin/weekly-digest", headers: { "x-admin-key": "secret-admin" },
    });
    expect(res.statusCode).toBe(200);
    // SMTP is not configured in tests, so composed counts and delivered stays 0.
    expect(res.json()).toEqual({ composed: 1, delivered: 0, quiet: 1, unverified: 1 });
  });
});
