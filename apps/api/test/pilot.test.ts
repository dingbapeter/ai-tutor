import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { createDb, runMigrations } from "@tutor/db";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/store/memory.js";
import { PostgresStore } from "../src/store/postgres.js";
import type { Store } from "../src/store/types.js";
import { PACK_IDS } from "../src/tutor/prompt.js";
import { buildApp } from "../src/app.js";
import { loadPack } from "../src/tutor/prompt.js";
import { buildLessonBrief } from "../src/tutor/lesson.js";
import { assign, buildForms, heldOutIndexes, markable, seeded, testableSkills } from "../src/pilot/forms.js";
import { gainDifference, mean, median, pairedGain, sd, tCritical95 } from "../src/pilot/stats.js";
import { buildReport, reportCsv, scoreAttempt, type ReportAttempt, type ReportMember, type ReportPilot } from "../src/pilot/report.js";
import { markAnswer } from "../src/pilot/routes.js";
import {
  MockChatProvider,
  MockSttProvider,
  MockTtsProvider,
  MockVisionProvider,
  RulesModerationProvider,
} from "@tutor/ai-gateway";

// ---------------------------------------------------------------- the arithmetic

describe("the arithmetic behind a pilot report, against numbers worked by hand", () => {
  it("means, spreads and middles", () => {
    expect(mean([40, 50, 60, 70, 80])).toBe(60);
    // Squared distances from 60: 400, 100, 0, 100, 400 = 1000; over n - 1 = 250.
    expect(sd([40, 50, 60, 70, 80])).toBeCloseTo(Math.sqrt(250), 10);
    expect(sd([7])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("the 95% critical value of t matches the printed tables", () => {
    expect(tCritical95(1)).toBe(12.706);
    expect(tCritical95(4)).toBe(2.776);
    expect(tCritical95(9)).toBe(2.262);
    expect(tCritical95(11)).toBe(2.201);
    expect(tCritical95(29)).toBe(2.045);
    expect(tCritical95(30)).toBe(2.042);
    // Beyond the table, the series: 2.021 at 40, 2.000 at 60, 1.980 at 120, 1.960 in the limit.
    expect(tCritical95(40)).toBeCloseTo(2.021, 3);
    expect(tCritical95(60)).toBeCloseTo(2.0, 3);
    expect(tCritical95(120)).toBeCloseTo(1.98, 3);
    expect(tCritical95(100000)).toBeCloseTo(1.96, 3);
    // Between rows (Welch gives fractions), a straight line between neighbours.
    expect(tCritical95(6.5)).toBeCloseTo((2.447 + 2.365) / 2, 10);
    expect(Number.isNaN(tCritical95(0))).toBe(true);
  });

  it("a before-and-after for five learners", () => {
    // Changes: +10, +5, +15, 0, +15. Mean 9. Squared distances from 9:
    // 1, 16, 36, 81, 36 = 170; over 4 = 42.5; spread 6.519; standard error
    // 6.519 / sqrt(5) = 2.9155; t(4) = 2.776; so 9 plus or minus 8.0934.
    const g = pairedGain([40, 50, 60, 70, 80], [50, 55, 75, 70, 95])!;
    expect(g.n).toBe(5);
    expect(g.preMean).toBe(60);
    expect(g.postMean).toBe(69);
    expect(g.gain).toBe(9);
    expect(g.ci![0]).toBeCloseTo(0.9066, 3);
    expect(g.ci![1]).toBeCloseTo(17.0934, 3);
    // Against the starting spread of 15.811: 9 / 15.811.
    expect(g.effect).toBeCloseTo(0.5692, 4);
    expect(g.improved).toBe(0.8);
  });

  it("gives no interval for one learner, no effect when everyone started level, and nothing for nobody", () => {
    expect(pairedGain([50], [70])).toMatchObject({ n: 1, gain: 20, ci: null, effect: null });
    expect(pairedGain([50, 50, 50], [60, 70, 80])!.effect).toBeNull();
    expect(pairedGain([], [])).toBeNull();
    expect(() => pairedGain([1, 2], [1])).toThrow();
  });

  it("how much more one group gained than another", () => {
    // Tutored changes: mean 9, variance 42.5. Comparison changes
    // 0, 5, -5, 5, 0: mean 1, variance 17.5. Difference 8. Standard error
    // sqrt(42.5/5 + 17.5/5) = sqrt(12) = 3.4641. Welch's degrees of freedom
    // 144 / (8.5^2/4 + 3.5^2/4) = 6.8166, so t = 2.447 - 0.8166 * 0.082.
    const d = gainDifference([10, 5, 15, 0, 15], [0, 5, -5, 5, 0], [40, 50, 60, 70, 80, 40, 50, 60, 70, 80])!;
    expect(d.difference).toBe(8);
    const t = 2.447 - 0.8166 * 0.082;
    expect(d.ci![0]).toBeCloseTo(8 - t * Math.sqrt(12), 2);
    expect(d.ci![1]).toBeCloseTo(8 + t * Math.sqrt(12), 2);
    // The ten starting scores together spread 14.907 (2000 / 9, square root).
    expect(d.effect).toBeCloseTo(8 / Math.sqrt(2000 / 9), 6);
    expect(gainDifference([], [1, 2], [1, 2])).toBeNull();
  });
});

// ---------------------------------------------------------------- the two tests

describe("building the two tests", () => {
  const pack = loadPack("math-ms");

  it("covers a whole subject with twenty questions a test, one skill each, the same skills in the same order on both", () => {
    const { forms, skillIds } = buildForms(pack, undefined, "seed-one");
    expect(forms.A).toHaveLength(20);
    expect(forms.B).toHaveLength(20);
    expect(forms.A.map((i) => i.skillId)).toEqual(forms.B.map((i) => i.skillId));
    expect(new Set(skillIds).size).toBe(20);
    expect(forms.A.map((i) => i.id)).toEqual(Array.from({ length: 20 }, (_, k) => `a-${String(k + 1).padStart(2, "0")}`));
    expect(forms.B[0].id).toBe("b-01");
  });

  it("asks two questions a skill when ten skills or fewer are chosen", () => {
    const five = testableSkills(pack).slice(0, 5).map((s) => s.id);
    const { forms, skillIds } = buildForms(pack, five, "seed-one");
    expect(skillIds).toEqual(five);
    expect(forms.A).toHaveLength(10);
    for (const id of five) expect(forms.A.filter((i) => i.skillId === id)).toHaveLength(2);
  });

  it("never puts one question on both tests, and never one a lesson or a level check would use", () => {
    const { forms } = buildForms(pack, undefined, "seed-one");
    const a = new Set(forms.A.map((i) => i.prompt));
    for (const i of forms.B) expect(a.has(i.prompt)).toBe(false);
    const used = new Set([...forms.A, ...forms.B].map((i) => i.prompt));
    for (const skillId of new Set(forms.A.map((i) => i.skillId))) {
      // Lessons take the first four of a skill's bank; level checks the first two.
      const front = pack.problems.filter((p) => p.skillId === skillId && markable(p)).slice(0, 4);
      for (const p of front) expect(used.has(p.prompt), p.prompt).toBe(false);
    }
    expect(used.size).toBe(40);
  });

  it("treats a question the bank holds twice as one question, held out wherever it sits", () => {
    // The fractions bank repeats a question: once near the front, once near the end.
    const twice = pack.problems.filter((p) => p.prompt.startsWith("Add the fractions: 1/2 + 6/8"));
    expect(twice.length).toBe(2);
    const skillId = String(twice[0].skillId);
    const five = [skillId, ...testableSkills(pack).map((s) => s.id).filter((id) => id !== skillId).slice(0, 4)];
    for (const seed of ["s1", "s2", "s3", "s4"]) {
      const { forms } = buildForms(pack, five, seed);
      const prompts = [...forms.A, ...forms.B].map((i) => i.prompt);
      expect(new Set(prompts).size).toBe(prompts.length);
      const heldOut = heldOutIndexes(pack, forms);
      for (const i of heldOut) expect(prompts).toContain(pack.problems[i].prompt);
      // Every copy of a tested wording is held out, not just the one that was picked.
      for (const [i, p] of pack.problems.entries()) if (prompts.includes(p.prompt)) expect(heldOut.has(i)).toBe(true);
    }
  });

  it("is the same every time for one seed, and tosses the coin differently for another", () => {
    const one = buildForms(pack, undefined, "seed-one").forms;
    expect(buildForms(pack, undefined, "seed-one").forms).toEqual(one);
    const flips = ["s1", "s2", "s3", "s4", "s5", "s6"].map((s) => buildForms(pack, undefined, s).forms.A.map((i) => i.prompt).join("|"));
    expect(new Set(flips).size).toBeGreaterThan(1);
    // Whatever the coin, the pair of questions for a skill is the same pair.
    const other = buildForms(pack, undefined, "seed-two").forms;
    const pairs = (f: typeof one) => f.A.map((i, k) => [i.prompt, f.B[k].prompt].sort().join("|"));
    expect(pairs(other)).toEqual(pairs(one));
  });

  it("copies what marks an answer into the pilot, so a later curriculum edit cannot change a sat test", () => {
    const { forms } = buildForms(pack, undefined, "seed-one");
    for (const i of forms.A) expect(i.check).toBeTruthy();
    expect(forms.A[0]).not.toBe(pack.problems.find((p) => p.prompt === forms.A[0].prompt));
  });

  it("offers no pilot in a subject with nothing a machine can mark", () => {
    expect(testableSkills(loadPack("language"))).toEqual([]);
    expect(buildForms(loadPack("language"), undefined, "x").forms.A).toEqual([]);
  });

  it("a lesson leaves a set-aside question alone", () => {
    const skillId = testableSkills(pack)[0].id;
    const plain = buildLessonBrief(pack, skillId);
    const first = pack.problems.find((p) => p.skillId === skillId && p.answer)!;
    expect(plain.briefText).toContain(first.prompt);
    expect(buildLessonBrief(pack, skillId, new Set([first.prompt])).briefText).not.toContain(first.prompt);
  });

  it("splits a class by chance into two even groups, each half and half on which test comes first", () => {
    const ids = Array.from({ length: 24 }, (_, i) => `s${i}`);
    const split = assign(ids, true, seeded("groups"));
    expect(split.map((m) => m.studentId).sort()).toEqual([...ids].sort());
    for (const arm of ["tutor", "comparison"] as const) {
      const rows = split.filter((m) => m.arm === arm);
      expect(rows).toHaveLength(12);
      expect(rows.filter((m) => m.formOrder === "AB")).toHaveLength(6);
    }
    // The order learners were typed in does not decide their group.
    expect(split.map((m) => m.studentId)).not.toEqual(ids);
    expect(assign(ids, true, seeded("other")).filter((m) => m.arm === "tutor").map((m) => m.studentId).sort()).not.toEqual(
      split.filter((m) => m.arm === "tutor").map((m) => m.studentId).sort(),
    );
    const odd = assign([...ids, "s24"], true, seeded("groups"));
    expect(odd.filter((m) => m.arm === "tutor")).toHaveLength(13);
    const all = assign(ids, false, seeded("groups"));
    expect(all.every((m) => m.arm === "tutor")).toBe(true);
    expect(all.filter((m) => m.formOrder === "BA")).toHaveLength(12);
  });
});

// ---------------------------------------------------------------- marking and the report

describe("marking", () => {
  const item = { id: "a-01", skillId: "s", prompt: "2 + 2", check: { type: "solve", equation: "x = 4", variable: "x" }, answer: "4" };

  it("takes the checker's word when it answers", async () => {
    expect(await markAnswer(async () => true, item, "four")).toEqual({ answer: "four", correct: true });
    expect(await markAnswer(async () => false, item, "4")).toEqual({ answer: "4", correct: false });
  });

  it("falls back to plain matching when the checker is away, and says so", async () => {
    expect(await markAnswer(async () => null, item, " 4 ")).toEqual({ answer: " 4 ", correct: true, exact: true });
    expect(await markAnswer(async () => null, item, "5")).toEqual({ answer: "5", correct: false, exact: true });
    expect(await markAnswer(async () => { throw new Error("down"); }, item, "4")).toMatchObject({ correct: true, exact: true });
  });

  it("leaves an answer unmarked rather than guess when there is nothing to match against", async () => {
    const { answer: _gone, ...bare } = item;
    expect(await markAnswer(async () => null, bare, "4")).toEqual({ answer: "4", correct: null });
  });

  it("counts a blank as wrong and an unmarked answer as neither", () => {
    const items = [1, 2, 3, 4].map((n) => ({ ...item, id: `a-0${n}` }));
    const s = scoreAttempt(items, {
      "a-01": { answer: "4", correct: true },
      "a-02": { answer: "5", correct: false },
      "a-03": { answer: "?", correct: null },
    });
    // One right of the three that could be marked; the blank fourth is wrong.
    expect(s).toEqual({ pct: (100 * 1) / 3, correct: 1, marked: 3, unmarked: 1 });
    expect(scoreAttempt(items.slice(0, 1), { "a-01": { answer: "?", correct: null } }).pct).toBeNull();
  });
});

describe("the report says only what the data supports", () => {
  const items = (form: "a" | "b") => Array.from({ length: 10 }, (_, k) => ({ id: `${form}-${k}`, skillId: k < 5 ? "skill.one" : "skill.two", prompt: `${form}${k}`, check: {}, answer: "1" }));
  const pilot = (over: Partial<ReportPilot> = {}): ReportPilot => ({
    id: "p", name: "Term 1", packId: "math-ms", comparison: false, status: "closed",
    forms: { A: items("a"), B: items("b") },
    createdAt: new Date("2026-01-05"), endlineOpenedAt: new Date("2026-02-16"), closedAt: new Date("2026-02-20"), ...over,
  });
  /** A finished sitting with `right` of ten correct. */
  const sat = (studentId: string, phase: "baseline" | "endline", form: "A" | "B", right: number, day: string): ReportAttempt => ({
    studentId, phase, form, startedAt: new Date(`${day}T09:00:00Z`), finishedAt: new Date(`${day}T09:20:00Z`),
    answers: Object.fromEntries(Array.from({ length: 10 }, (_, k) => [`${form.toLowerCase()}-${k}`, { answer: "x", correct: k < right }])),
  });
  const member = (i: number, arm: "tutor" | "comparison" = "tutor"): ReportMember => ({ studentId: `s${i}`, displayName: `Learner ${String(i).padStart(2, "0")}`, arm, formOrder: i % 2 ? "BA" : "AB" });

  it("gives no average for a handful of learners, and says how many are needed", () => {
    const members = [0, 1, 2, 3].map((i) => member(i));
    const attempts = members.flatMap((m) => [sat(m.studentId, "baseline", "A", 4, "2026-01-06"), sat(m.studentId, "endline", "B", 8, "2026-02-17")]);
    const r = buildReport(pilot(), members, attempts, new Map());
    expect(r.strength).toBe("too-few");
    expect(r.tutor).toBeNull();
    expect(r.skills).toEqual([]);
    expect(r.reading[0]).toContain("Only 4 learners sat both tests");
    expect(r.reading[0]).toContain("at least 10");
    // Their own scores are still there.
    expect(r.learners.map((l) => l.gain)).toEqual([40, 40, 40, 40]);
  });

  it("with no comparison group, reports the rise and refuses to credit the tutor alone", () => {
    const members = Array.from({ length: 12 }, (_, i) => member(i));
    const attempts = members.flatMap((m, i) => [sat(m.studentId, "baseline", "A", 4, "2026-01-06"), sat(m.studentId, "endline", "B", i % 2 ? 7 : 6, "2026-02-17")]);
    const r = buildReport(pilot(), members, attempts, new Map());
    expect(r.design).toBe("before-and-after");
    expect(r.strength).toBe("early");
    expect(r.tutor).toMatchObject({ n: 12, preMean: 40, postMean: 65, gain: 25, improved: 1 });
    expect(r.tutor!.effect).toBeNull(); // everyone started on 40
    expect(r.difference).toBeNull();
    const text = r.reading.join(" ");
    expect(text).toContain("from 40% to 65%, a change of +25 points");
    expect(text).toContain("no comparison group");
    expect(text).toContain("not that the tutor alone caused it");
    expect(text).toContain("early signal");
    expect(text).not.toContain("evidence that the tutoring caused");
    // Per skill: the first five questions are skill one. Before, 4 of 5 right; after, all 5.
    expect(r.skills).toEqual([
      { skillId: "skill.one", before: 80, after: 100, answers: 120 },
      { skillId: "skill.two", before: 0, after: 30, answers: 120 },
    ]);
  });

  it("does not call a rise real when the interval includes zero", () => {
    const members = Array.from({ length: 10 }, (_, i) => member(i));
    // Half rise by 30 points, half fall by 30: an average of nothing.
    const attempts = members.flatMap((m, i) => [sat(m.studentId, "baseline", "A", 5, "2026-01-06"), sat(m.studentId, "endline", "B", i % 2 ? 8 : 2, "2026-02-17")]);
    const r = buildReport(pilot(), members, attempts, new Map());
    expect(r.tutor!.gain).toBe(0);
    expect(r.reading.join(" ")).toContain("cannot tell the change apart from chance");
  });

  it("counts everyone who dropped out, and whoever started a test and never handed it in", () => {
    const members = Array.from({ length: 13 }, (_, i) => member(i));
    const attempts = members.slice(0, 11).flatMap((m) => [sat(m.studentId, "baseline", "A", 4, "2026-01-06"), sat(m.studentId, "endline", "B", 6, "2026-02-17")]);
    attempts.push(sat("s11", "baseline", "A", 4, "2026-01-06")); // sat the first, never the second
    attempts.push({ ...sat("s12", "baseline", "A", 9, "2026-01-06"), finishedAt: null }); // never handed in
    const r = buildReport(pilot(), members, attempts, new Map());
    expect(r.flow.tutor).toEqual({ enrolled: 13, satBaseline: 12, satEndline: 11, matched: 11 });
    expect(r.integrity.startedNotFinished).toBe(1);
    expect(r.tutor!.n).toBe(11);
    expect(r.reading.join(" ")).toContain("2 enrolled learners are not in the averages");
  });

  it("counts tutoring only between a learner's own two tests, in sessions and in days they came", () => {
    const members = Array.from({ length: 10 }, (_, i) => member(i));
    const attempts = members.flatMap((m) => [sat(m.studentId, "baseline", "A", 4, "2026-01-06"), sat(m.studentId, "endline", "B", 6, "2026-02-17")]);
    const at = (day: string, hour = 15, ended = true) => ({ startedAt: new Date(`${day}T${hour}:00:00Z`), endedAt: ended ? new Date(`${day}T${hour}:30:00Z`) : null });
    const sessions = new Map([
      ["s0", [at("2026-01-02"), at("2026-01-10"), at("2026-01-10", 18), at("2026-02-01", 15, false), at("2026-02-18")]],
    ]);
    const r = buildReport(pilot(), members, attempts, sessions);
    const s0 = r.learners.find((l) => l.studentId === "s0")!;
    // Before the first test and after the second do not count: three
    // sessions, two of them on one day, one never closed and counted all the same.
    expect(s0.sessions).toBe(3);
    expect(s0.activeDays).toBe(2);
    expect(r.integrity.medianDaysBetweenTests).toBeCloseTo(42, 0);
  });

  it("writes a spreadsheet that can leave the school without a name in it", () => {
    const members = [{ ...member(0), displayName: "=HYPERLINK(\"http://x\")" }, { ...member(1), displayName: "Adé Ọbí, Jr" }];
    const attempts = [sat("s0", "baseline", "A", 6, "2026-01-06"), sat("s0", "endline", "B", 5, "2026-02-17"), sat("s1", "baseline", "A", 4, "2026-01-06")];
    const r = buildReport(pilot(), members, attempts, new Map());
    const named = reportCsv(r, true);
    const anon = reportCsv(r, false);
    expect(named.startsWith("﻿learner,name,group,form_order,baseline_pct,endline_pct,gain_points,sessions_between_tests,days_active_between_tests\r\n")).toBe(true);
    // A name that looks like a formula is defused; a comma in a name is quoted.
    expect(named).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(named).toContain(`"Adé Ọbí, Jr"`);
    // A fall of ten points is the number -10, not text.
    expect(named).toMatch(/,60,50,-10,0,0\r\n/);
    // No final test: empty cells, never a zero.
    expect(named).toMatch(/,40,,,0,0\r\n/);
    expect(anon).not.toContain("HYPERLINK");
    expect(anon).not.toContain("Adé");
    expect(anon).toContain("L01,tutor,");
  });
});

// ---------------------------------------------------------------- a whole pilot, through the API

const PASSWORD = "correct horse battery";
const OWNER = "founder@dingba.ai";

/**
 * Where a pilot is kept. Memory always; and a real Postgres, through every
 * migration, when TEST_DATABASE_URL points at a throwaway server (each run
 * makes its own database there and drops it after). Production is
 * Postgres, so the cascade on deletion and two answers landing at once are
 * proven against the real thing wherever one is to hand.
 */
type StoreKind = "memory" | "postgres";
const KINDS: StoreKind[] = process.env.TEST_DATABASE_URL ? ["memory", "postgres"] : ["memory"];

async function makeStore(kind: StoreKind): Promise<{ store: Store; dispose: () => Promise<void> }> {
  if (kind === "memory") return { store: new MemoryStore(), dispose: async () => {} };
  const base = new URL(process.env.TEST_DATABASE_URL!);
  const name = `pilot_${randomBytes(6).toString("hex")}`;
  const admin = createDb(base.toString());
  await admin.execute(sql.raw(`create database "${name}"`));
  const url = new URL(base.toString());
  url.pathname = `/${name}`;
  const applied = await runMigrations(url.toString(), join(dirname(fileURLToPath(import.meta.url)), "../../../packages/db/migrations"));
  expect(applied).toContain("0021_pilots.sql");
  const store = new PostgresStore(url.toString());
  await store.seedSkills([...PACK_IDS]);
  return { store, dispose: async () => void (await admin.execute(sql.raw(`drop database if exists "${name}" with (force)`)).catch(() => {})) };
}

/** The stand-in checker: a learner who writes RIGHT is right. */
async function setup(kind: StoreKind = "memory") {
  const { store, dispose } = await makeStore(kind);
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
    store,
    env: { NODE_ENV: "test", RATE_LIMIT_MAX: "100000", AUTH_RATE_LIMIT: "100000", AI_TTS_PROVIDER: "mock", COMMAND_OWNER_EMAILS: OWNER },
    checkAnswer: async (_check, answer) => answer === "RIGHT",
  });
  return { app, store, dispose };
}
type App = Awaited<ReturnType<typeof setup>>["app"];

async function school(app: App, email: string, learners: number) {
  const reg = (await app.inject({ method: "POST", url: "/auth/register", payload: { email, password: PASSWORD, role: "parent" } })).json();
  const auth = { authorization: `Bearer ${reg.token}` };
  await app.inject({ method: "POST", url: "/orgs", headers: auth, payload: { name: "Sunrise Academy", seats: 60 } });
  const names = Array.from({ length: learners }, (_, i) => `Learner ${String(i + 1).padStart(2, "0")}`);
  if (learners) await app.inject({ method: "POST", url: "/orgs/roster", headers: auth, payload: { names } });
  return { auth };
}

interface Member { studentId: string; displayName: string; group: "tutor" | "comparison"; code: string; baseline: string; endline: string }

/** Sits the open test through a learner's link, getting `right` questions right. */
async function sit(app: App, code: string, right: number) {
  const open = (await app.inject({ method: "POST", url: `/pilot-tests/${code}/open` })).json();
  for (const [k, q] of (open.questions as Array<{ id: string }>).entries()) {
    await app.inject({ method: "POST", url: `/pilot-tests/${code}/answer`, payload: { questionId: q.id, answer: k < right ? "RIGHT" : "WRONG" } });
  }
  return app.inject({ method: "POST", url: `/pilot-tests/${code}/finish` });
}

describe.each(KINDS)("a whole pilot, from enrolment to report (%s store)", (kind) => {
  const BASE = [3, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 8];
  const TUTOR_GAIN = [3, 2, 3, 2, 1, 3, 2, 2, 1, 2, 1, 1];
  const COMPARE_GAIN = [1, 0, 1, 0, -1, 1, 0, 1, 0, 0, 1, -1];

  it("runs a randomised comparison and reports it to the number", async () => {
    const { app, store, dispose } = await setup(kind);
    const { auth } = await school(app, "head@sunrise.example", 24);
    const pack = loadPack("math-ms");
    const skillIds = testableSkills(pack).slice(0, 5).map((s) => s.id);

    // Only subjects a machine can mark fairly are offered.
    const listed = (await app.inject({ method: "GET", url: "/orgs/pilots", headers: auth })).json();
    expect(listed.pilots).toEqual([]);
    expect(listed.options.map((o: { id: string }) => o.id)).toContain("math-ms");
    expect(listed.options.map((o: { id: string }) => o.id)).not.toContain("language");

    const made = await app.inject({ method: "POST", url: "/orgs/pilots", headers: auth, payload: { name: "Fractions, term one", packId: "math-ms", skillIds, comparison: true } });
    expect(made.statusCode).toBe(200);
    const pilotId = made.json().id as string;
    expect(made.json()).toMatchObject({ status: "baseline", comparison: true, questionsPerTest: 10 });
    expect(JSON.stringify(made.json())).not.toContain("check");

    // One pilot at a time.
    expect((await app.inject({ method: "POST", url: "/orgs/pilots", headers: auth, payload: { name: "Another", packId: "math-ms" } })).statusCode).toBe(409);

    const detail = async () => (await app.inject({ method: "GET", url: `/orgs/pilots/${pilotId}`, headers: auth })).json() as { members: Member[]; notEnrolled: number };
    const members = (await detail()).members;
    expect(members).toHaveLength(24);
    const tutored = members.filter((m) => m.group === "tutor");
    const waiting = members.filter((m) => m.group === "comparison");
    expect(tutored).toHaveLength(12);
    expect(waiting).toHaveLength(12);
    expect(new Set(members.map((m) => m.code)).size).toBe(24);
    for (const m of members) expect(m.code).toMatch(/^[a-f0-9]{32}$/);

    const start = (studentId: string, extra: Record<string, unknown> = {}) =>
      app.inject({ method: "POST", url: "/sessions", headers: auth, payload: { studentId, personaId: "amara", packId: "math-ms", ...extra } });

    // Nobody is tutored before their starting test; the comparison group waits throughout.
    const early = await start(tutored[0].studentId);
    expect(early.statusCode).toBe(403);
    expect(early.json()).toMatchObject({ pilot: true });
    expect(early.json().error).toContain("starting test");
    expect((await start(waiting[0].studentId)).json().error).toContain("starts with the tutor as soon as it ends");

    // A link that is not a link, and one nobody was given.
    expect((await app.inject({ method: "POST", url: "/pilot-tests/not-a-code/open" })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/pilot-tests/${"0".repeat(32)}/open` })).statusCode).toBe(404);

    // The test shows the questions and nothing that marks them.
    const first = await app.inject({ method: "POST", url: `/pilot-tests/${tutored[0].code}/open` });
    expect(first.json()).toMatchObject({ state: "open", phase: "baseline", learner: tutored[0].displayName, pilot: "Fractions, term one", answers: {} });
    const questions = first.json().questions as Array<Record<string, unknown>>;
    expect(questions).toHaveLength(10);
    for (const q of questions) expect(Object.keys(q).sort()).toEqual(["id", "prompt"]);
    const held = new Set(questions.map((q) => q.prompt as string));

    // An answer is saved and says nothing about right or wrong; a dropped connection loses nothing.
    const saved = await app.inject({ method: "POST", url: `/pilot-tests/${tutored[0].code}/answer`, payload: { questionId: questions[0].id, answer: "RIGHT" } });
    expect(saved.json()).toEqual({ saved: true });
    expect((await app.inject({ method: "POST", url: `/pilot-tests/${tutored[0].code}/answer`, payload: { questionId: "z-99", answer: "RIGHT" } })).statusCode).toBe(400);
    const again = (await app.inject({ method: "POST", url: `/pilot-tests/${tutored[0].code}/open` })).json();
    expect(again.answers).toEqual({ [questions[0].id as string]: "RIGHT" });
    expect((await detail()).members.find((m) => m.studentId === tutored[0].studentId)!.baseline).toBe("started");

    // Everyone sits the starting test.
    for (const [i, m] of tutored.entries()) expect((await sit(app, m.code, BASE[i])).json()).toEqual({ state: "done" });
    for (const [i, m] of waiting.entries()) await sit(app, m.code, BASE[i]);
    expect((await app.inject({ method: "POST", url: `/pilot-tests/${tutored[0].code}/open` })).json().state).toBe("done");
    expect((await app.inject({ method: "POST", url: `/pilot-tests/${tutored[0].code}/answer`, payload: { questionId: questions[0].id, answer: "WRONG" } })).statusCode).toBe(409);

    // Half the class sat each test first.
    const firstForms = (await store.listPilotAttempts(pilotId)).map((a) => a.form);
    expect(firstForms.filter((f) => f === "A")).toHaveLength(12);

    // Now the tutored group may learn, and their test questions are nowhere in it.
    const lesson = await start(tutored[0].studentId);
    expect(lesson.statusCode).toBe(200);
    const sessionId = lesson.json().sessionId as string;
    const everyTestPrompt = new Set([...(await store.getPilot(pilotId))!.forms.A, ...(await store.getPilot(pilotId))!.forms.B].map((i) => i.prompt));
    expect(everyTestPrompt.size).toBe(20);
    for (const p of held) expect(everyTestPrompt.has(p)).toBe(true);
    const offered = (await app.inject({ method: "GET", url: `/packs/math-ms/problems?session=${sessionId}` })).json() as Array<{ index: number; prompt: string }>;
    expect(offered.length).toBeLessThanOrEqual(pack.problems.length - 20);
    expect(offered.length).toBe(pack.problems.filter((p) => !everyTestPrompt.has(p.prompt)).length);
    for (const p of offered) expect(everyTestPrompt.has(p.prompt)).toBe(false);
    const heldIndex = pack.problems.findIndex((p) => everyTestPrompt.has(p.prompt));
    const sneaked = await app.inject({ method: "POST", url: `/sessions/${sessionId}/practice`, payload: { problemIndex: heldIndex, answer: "1" } });
    expect(sneaked.statusCode).toBe(400);
    expect(sneaked.json().error).toContain("set aside");
    const check = (await app.inject({ method: "POST", url: `/sessions/${sessionId}/diagnostic/start` })).json() as { problems: Array<{ prompt: string }> };
    for (const p of check.problems) expect(everyTestPrompt.has(p.prompt)).toBe(false);
    // Someone outside the pilot still sees the whole bank.
    expect((await app.inject({ method: "GET", url: "/packs/math-ms/problems" })).json()).toHaveLength(pack.problems.length);
    // The comparison group still waits, test sat or not.
    expect((await start(waiting[0].studentId)).statusCode).toBe(403);

    // Some learn more than others: six learners two more sessions each.
    for (const m of tutored.slice(1)) await start(m.studentId);
    for (const m of tutored.slice(0, 6)) for (let k = 0; k < 2; k++) await start(m.studentId);

    // Two learners join the roster late: enrolled by chance, the balance kept.
    await app.inject({ method: "POST", url: "/orgs/roster", headers: auth, payload: { names: ["Late One", "Late Two"] } });
    expect((await detail()).notEnrolled).toBe(2);
    expect((await app.inject({ method: "POST", url: `/orgs/pilots/${pilotId}/enrol`, headers: auth })).json()).toEqual({ added: 2 });
    const grown = (await detail()).members;
    expect(grown.filter((m) => m.group === "tutor")).toHaveLength(13);
    expect(grown.filter((m) => m.group === "comparison")).toHaveLength(13);
    const late = grown.find((m) => m.displayName === "Late One")!;

    // The final test opens. It is the other test, and only for those with a starting test.
    const moved = await app.inject({ method: "POST", url: `/orgs/pilots/${pilotId}/status`, headers: auth, payload: { status: "endline" } });
    expect(moved.json().status).toBe("endline");
    expect((await app.inject({ method: "POST", url: `/orgs/pilots/${pilotId}/enrol`, headers: auth })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/pilot-tests/${late.code}/open` })).json().state).toBe("missed-start");
    const final = (await app.inject({ method: "POST", url: `/pilot-tests/${tutored[0].code}/open` })).json();
    expect(final.phase).toBe("endline");
    expect((final.questions[0].id as string)[0]).not.toBe((questions[0].id as string)[0]);
    for (const q of final.questions as Array<{ prompt: string }>) expect(held.has(q.prompt)).toBe(false);

    for (const [i, m] of tutored.entries()) await sit(app, m.code, BASE[i] + TUTOR_GAIN[i]);
    for (const [i, m] of waiting.entries()) await sit(app, m.code, BASE[i] + COMPARE_GAIN[i]);

    const report = (await app.inject({ method: "GET", url: `/orgs/pilots/${pilotId}/report`, headers: auth })).json();
    expect(report).toMatchObject({ school: "Sunrise Academy", subject: pack.title, design: "randomised comparison", itemsPerForm: 10, strength: "early" });
    expect(report.flow).toEqual({
      tutor: { enrolled: 13, satBaseline: 12, satEndline: 12, matched: 12 },
      comparison: { enrolled: 13, satBaseline: 12, satEndline: 12, matched: 12 },
    });
    // Starting scores 30 to 80, mean 55. Tutored changes sum to 230 points over 12.
    expect(report.tutor.n).toBe(12);
    expect(report.tutor.preMean).toBeCloseTo(55, 6);
    expect(report.tutor.gain).toBeCloseTo(230 / 12, 6);
    expect(report.tutor.ci[0]).toBeCloseTo(14.128, 2);
    expect(report.tutor.ci[1]).toBeCloseTo(24.205, 2);
    expect(report.tutor.improved).toBe(1);
    expect(report.comparison.gain).toBeCloseTo(2.5, 6);
    // 16.67 points more, standard error 3.158, Welch t on 21.94 degrees of freedom.
    expect(report.difference.difference).toBeCloseTo(50 / 3, 6);
    expect(report.difference.ci[0]).toBeCloseTo(50 / 3 - 2.07434 * 3.158282, 2);
    expect(report.difference.ci[1]).toBeCloseTo(50 / 3 + 2.07434 * 3.158282, 2);
    expect(report.difference.effect).toBeCloseTo(1.1785, 3);
    const text = (report.reading as string[]).join(" ");
    expect(text).toContain("12 tutored learners sat both tests");
    expect(text).toContain("evidence that the tutoring caused the extra gain");
    expect(text).toContain("early signal");
    expect(text).toContain("2 enrolled learners are not in the averages");
    // Six learners had three sessions between their tests, six had one.
    expect(report.dosage.medianSessions).toBe(2);
    expect(report.dosage.moreSessions.n).toBe(6);
    expect(report.dosage.fewerSessions.n).toBe(6);
    expect(report.integrity).toMatchObject({ formOrders: { AB: 13, BA: 13 }, unmarkedAnswers: 0, exactMatchMarks: 0, comparisonSessions: 0, startedNotFinished: 0 });
    expect(report.skills).toHaveLength(5);
    expect(report.skills[0].title).toBe(pack.skills.find((s) => s.id === skillIds[0])!.title);

    // The spreadsheet, with and without names.
    const anon = await app.inject({ method: "GET", url: `/orgs/pilots/${pilotId}/results.csv`, headers: auth });
    expect(anon.headers["content-type"]).toContain("text/csv");
    expect(anon.headers["content-disposition"]).toContain("dingba-pilot-anonymous-");
    expect(anon.body).not.toContain("Learner 01");
    expect(anon.body.split("\r\n").filter(Boolean)).toHaveLength(27);
    expect((await app.inject({ method: "GET", url: `/orgs/pilots/${pilotId}/results.csv?names=1`, headers: auth })).body).toContain("Learner 01");

    // The founder reads the headline in the Command Centre; no learner is named there.
    const founder = (await app.inject({ method: "POST", url: "/auth/register", payload: { email: OWNER, password: PASSWORD, role: "parent" } })).json();
    const evidence = await app.inject({ method: "GET", url: "/command/pilots", headers: { authorization: `Bearer ${founder.token}` } });
    expect(evidence.statusCode).toBe(200);
    expect(evidence.json().pilots).toHaveLength(1);
    expect(evidence.json().pilots[0]).toMatchObject({ school: "Sunrise Academy", name: "Fractions, term one", design: "randomised comparison", strength: "early" });
    expect(evidence.json().pilots[0].difference.difference).toBeCloseTo(50 / 3, 6);
    expect(evidence.body).not.toContain("Learner 01");
    expect((await app.inject({ method: "GET", url: "/command/pilots", headers: auth })).statusCode).toBe(403);

    // Another school cannot see it.
    const other = await school(app, "head@other.example", 2);
    expect((await app.inject({ method: "GET", url: `/orgs/pilots/${pilotId}/report`, headers: other.auth })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/orgs/pilots/${pilotId}`, headers: other.auth })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/orgs/pilots/${pilotId}/report` })).statusCode).toBe(401);

    // Closing ends the wait for the comparison group, and the tests.
    expect((await app.inject({ method: "POST", url: `/orgs/pilots/${pilotId}/status`, headers: auth, payload: { status: "closed" } })).json().status).toBe("closed");
    expect((await app.inject({ method: "POST", url: `/orgs/pilots/${pilotId}/status`, headers: auth, payload: { status: "endline" } })).statusCode).toBe(409);
    expect((await start(waiting[0].studentId)).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/pilot-tests/${tutored[0].code}/open` })).json().state).toBe("closed");
    // With the pilot over, its questions go back into practice.
    const after = (await start(tutored[0].studentId)).json().sessionId as string;
    expect((await app.inject({ method: "GET", url: `/packs/math-ms/problems?session=${after}` })).json()).toHaveLength(pack.problems.length);

    // The school's own copy holds the pilot, and deleting the account erases it.
    const copy = (await app.inject({ method: "GET", url: "/me/export", headers: auth })).json();
    expect(copy.pilots).toHaveLength(1);
    expect(copy.pilots[0].members).toHaveLength(26);
    expect(copy.pilots[0].attempts).toHaveLength(48);
    expect((await app.inject({ method: "DELETE", url: "/me", headers: { ...auth, "content-type": "application/json" }, payload: { confirm: "DELETE" } })).statusCode).toBe(200);
    expect(await store.getPilot(pilotId)).toBeNull();
    expect(await store.listPilotAttempts(pilotId)).toEqual([]);
    expect(await store.listPilotMembers(pilotId)).toEqual([]);
    expect(await store.pilotMemberByCode(tutored[0].code)).toBeNull();
    await app.close();
    await dispose();
  }, 180_000);

  it("keeps every answer when ten land at once, and one sitting when the link is tapped twice", async () => {
    const { app, store, dispose } = await setup(kind);
    const { auth } = await school(app, "head@race.example", 2);
    const pilotId = (await app.inject({ method: "POST", url: "/orgs/pilots", headers: auth, payload: { name: "Race", packId: "math-ms" } })).json().id as string;
    const [m] = ((await app.inject({ method: "GET", url: `/orgs/pilots/${pilotId}`, headers: auth })).json() as { members: Member[] }).members;
    const [one, two] = await Promise.all([
      app.inject({ method: "POST", url: `/pilot-tests/${m.code}/open` }),
      app.inject({ method: "POST", url: `/pilot-tests/${m.code}/open` }),
    ]);
    expect(one.json().state).toBe("open");
    expect(two.json().state).toBe("open");
    expect(await store.listPilotAttempts(pilotId)).toHaveLength(1);
    const ids = (one.json().questions as Array<{ id: string }>).map((q) => q.id);
    await Promise.all(ids.map((questionId) => app.inject({ method: "POST", url: `/pilot-tests/${m.code}/answer`, payload: { questionId, answer: "RIGHT" } })));
    const [attempt] = await store.listPilotAttempts(pilotId);
    expect(Object.keys(attempt.answers).sort()).toEqual([...ids].sort());
    expect(Object.values(attempt.answers).every((a) => a.correct === true)).toBe(true);
    // A changed mind replaces the answer; handing in twice keeps the first hand-in time.
    await app.inject({ method: "POST", url: `/pilot-tests/${m.code}/answer`, payload: { questionId: ids[0], answer: "WRONG" } });
    expect((await store.listPilotAttempts(pilotId))[0].answers[ids[0]]).toMatchObject({ answer: "WRONG", correct: false });
    expect(Object.keys((await store.listPilotAttempts(pilotId))[0].answers)).toHaveLength(ids.length);
    await app.inject({ method: "POST", url: `/pilot-tests/${m.code}/finish` });
    const handedIn = (await store.listPilotAttempts(pilotId))[0].finishedAt!;
    expect(handedIn).toBeInstanceOf(Date);
    await app.close();
    await dispose();
  }, 60_000);

  it("refuses a pilot it could not run fairly", async () => {
    const { app } = await setup();
    const empty = await school(app, "head@empty.example", 0);
    expect((await app.inject({ method: "POST", url: "/orgs/pilots", headers: empty.auth, payload: { name: "No one", packId: "math-ms" } })).json().error).toContain("add learners");
    const one = await school(app, "head@one.example", 1);
    expect((await app.inject({ method: "POST", url: "/orgs/pilots", headers: one.auth, payload: { name: "Alone", packId: "math-ms", comparison: true } })).json().error).toContain("at least two");
    const { auth } = await school(app, "head@fair.example", 4);
    expect((await app.inject({ method: "POST", url: "/orgs/pilots", headers: auth, payload: { name: "Words", packId: "language" } })).statusCode).toBe(400);
    const thin = await app.inject({ method: "POST", url: "/orgs/pilots", headers: auth, payload: { name: "Thin", packId: "math-ms", skillIds: [testableSkills(loadPack("math-ms"))[0].id] } });
    expect(thin.statusCode).toBe(400);
    expect(thin.json().error).toContain("only 2 questions per test");
    const noOrg = (await app.inject({ method: "POST", url: "/auth/register", payload: { email: "parent@home.example", password: PASSWORD, role: "parent" } })).json();
    expect((await app.inject({ method: "GET", url: "/orgs/pilots", headers: { authorization: `Bearer ${noOrg.token}` } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/orgs/pilots" })).statusCode).toBe(401);
    await app.close();
  });

  it("re-marks answers once the checker is back, and a pilot can be deleted", async () => {
    const store = new MemoryStore();
    let checkerUp = false;
    const app = await buildApp({
      gateway: { chat: new MockChatProvider(), planner: new MockChatProvider(), premiumChat: new MockChatProvider(), stt: new MockSttProvider(), tts: new MockTtsProvider(), vision: new MockVisionProvider(), moderation: new RulesModerationProvider() },
      store,
      env: { NODE_ENV: "test", RATE_LIMIT_MAX: "100000", AUTH_RATE_LIMIT: "100000", AI_TTS_PROVIDER: "mock" },
      checkAnswer: async (_c, answer) => (checkerUp ? answer === "RIGHT" : null),
    });
    const { auth } = await school(app, "head@outage.example", 3);
    const pilotId = (await app.inject({ method: "POST", url: "/orgs/pilots", headers: auth, payload: { name: "Outage", packId: "math-ms" } })).json().id as string;
    const members = ((await app.inject({ method: "GET", url: `/orgs/pilots/${pilotId}`, headers: auth })).json() as { members: Member[] }).members;
    // The checker is away: "RIGHT" matches no stored answer, so plain matching marks it wrong, flagged.
    await sit(app, members[0].code, 20);
    const before = (await app.inject({ method: "GET", url: `/orgs/pilots/${pilotId}/report`, headers: auth })).json();
    expect(before.integrity.exactMatchMarks).toBe(20);
    expect(before.learners.find((l: { studentId: string }) => l.studentId === members[0].studentId).baseline).toBe(0);
    expect(before.reading.join(" ")).toContain("marked by plain matching");
    // The checker returns; reading the report again marks them properly.
    checkerUp = true;
    const after = (await app.inject({ method: "GET", url: `/orgs/pilots/${pilotId}/report`, headers: auth })).json();
    expect(after.integrity.exactMatchMarks).toBe(0);
    expect(after.learners.find((l: { studentId: string }) => l.studentId === members[0].studentId).baseline).toBe(100);

    expect((await app.inject({ method: "DELETE", url: `/orgs/pilots/${pilotId}`, headers: auth })).json()).toEqual({ deleted: true });
    expect((await app.inject({ method: "GET", url: "/orgs/pilots", headers: auth })).json().pilots).toEqual([]);
    expect((await app.inject({ method: "POST", url: `/pilot-tests/${members[0].code}/open` })).statusCode).toBe(404);
    await app.close();
  });
});
