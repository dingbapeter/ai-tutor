import { describe, expect, it, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildLessonBrief, UnknownSkillError } from "../src/tutor/lesson.js";
import { loadPack } from "../src/tutor/prompt.js";
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
 * Lessons: the deterministic brief tested to the word against the real
 * curriculum pack, then the session route carrying it.
 */

const pack = loadPack("math-ms");
// A skill with prerequisites and several bank problems, from the real pack.
const skillWithPrereqs = pack.skills.find(
  (s) => s.prerequisites.length > 0 && pack.problems.filter((p) => p.skillId === s.id && p.answer).length >= 2,
)!;

describe("the lesson brief", () => {
  it("builds the whole arc from the real pack: recall, example, practice, wrap-up", () => {
    const brief = buildLessonBrief(pack, skillWithPrereqs.id);
    expect(brief.title).toBe(skillWithPrereqs.title);
    expect(brief.recallTitles.length).toBeGreaterThan(0);
    expect(brief.workedExample).not.toBeNull();
    expect(brief.practice.length).toBeGreaterThan(0);
    // The order of the arc is in the text the persona receives.
    const t = brief.briefText;
    expect(t.indexOf("Recall:")).toBeLessThan(t.indexOf("Explain the idea"));
    expect(t.indexOf("Explain the idea")).toBeLessThan(t.indexOf("Work this exact problem"));
    expect(t.indexOf("Work this exact problem")).toBeLessThan(t.indexOf("Guided practice"));
    expect(t.indexOf("Guided practice")).toBeLessThan(t.indexOf("say the idea back"));
  });

  it("takes every problem and answer from the verified bank, never inventing them", () => {
    const brief = buildLessonBrief(pack, skillWithPrereqs.id);
    const bank = pack.problems.filter((p) => p.skillId === skillWithPrereqs.id && p.answer);
    expect(brief.workedExample!.prompt).toBe(bank[0].prompt);
    expect(brief.workedExample!.answer).toBe(bank[0].answer);
    for (const p of brief.practice) {
      const source = bank.find((b) => b.prompt === p.prompt);
      expect(source, p.prompt).toBeDefined();
      expect(p.answer).toBe(source!.answer);
    }
    // And the brief tells the persona to guide, not to hand the answer over.
    expect(brief.briefText).toContain("guide them to it, never just state it");
  });

  it("is deterministic, so the same lesson comes out every time", () => {
    expect(buildLessonBrief(pack, skillWithPrereqs.id)).toEqual(buildLessonBrief(pack, skillWithPrereqs.id));
  });

  it("refuses a skill the pack does not teach", () => {
    expect(() => buildLessonBrief(pack, "math-ms.no-such-skill")).toThrow(UnknownSkillError);
  });
});

describe("a lesson session", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const planner = new MockChatProvider();
    app = await buildApp({
      gateway: {
        chat: new MockChatProvider(), planner, premiumChat: planner,
        stt: new MockSttProvider(), tts: new MockTtsProvider(),
        vision: new MockVisionProvider(), moderation: new RulesModerationProvider(),
      },
      store: new MemoryStore(),
      env: { NODE_ENV: "test", RATE_LIMIT_MAX: "10000", GUEST_IP_CAP: "100000", AUTH_RATE_LIMIT: "100000" },
    });
  });

  it("starts a session carrying the lesson and says so in the response", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: {
        studentName: "Ada",
        personaId: "amara",
        packId: "math-ms",
        lessonSkillId: skillWithPrereqs.id,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.lesson).toMatchObject({
      skillId: skillWithPrereqs.id,
      title: skillWithPrereqs.title,
      practiceCount: expect.any(Number),
    });
    // The client learns the shape of the lesson, never the answer key.
    expect(JSON.stringify(body.lesson)).not.toContain("answer");
    expect(body.greeting.length).toBeGreaterThan(0);

    // The session still converses normally afterwards.
    const msg = await app.inject({
      method: "POST",
      url: `/sessions/${body.sessionId}/message`,
      payload: { text: "ready when you are" },
    });
    expect(msg.statusCode).toBe(200);
  });

  it("refuses a lesson on a skill the chosen pack does not teach", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: {
        studentName: "Ada",
        personaId: "amara",
        packId: "math-ms",
        lessonSkillId: "visa-prep.interview.small-talk",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("has no skill");
  });

  it("stays an ordinary session when no lesson is asked for", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { studentName: "Ada", personaId: "amara", packId: "math-ms" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().lesson).toBeNull();
  });
});
