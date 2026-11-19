/**
 * School pilots: measure what learners gained, in a way that survives a
 * hard question from a head teacher, a researcher or an investor.
 *
 * A school enrols its roster, each learner sits a starting test, the class
 * uses the tutor for some weeks, each learner sits a matched final test,
 * and the report says what changed and how sure anyone can be about it.
 * With a comparison group, half the class (picked by chance) waits for the
 * tutor until the pilot ends, and the report can speak about cause.
 *
 * Tests are sat through a learner's own link, with no sign-in, so a child
 * can sit one on any phone. The link is good for nothing else.
 */
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Check } from "../mathcheck.js";
import type { PilotAnswer, PilotRecord, Store } from "../store/types.js";
import { loadPack, PACK_IDS, skillTitle, type CurriculumPack } from "../tutor/prompt.js";
import { assign, buildForms, heldOutIndexes, seeded, testableSkills, type PilotItem } from "./forms.js";
import { buildReport, reportCsv, type Phase, type SessionTime } from "./report.js";

type Verify = (check: Check, answer: string) => Promise<boolean | null>;

export interface PilotDeps {
  store: Store;
  userFromRequest: (req: FastifyRequest) => Promise<{ userId: string; email: string; role: string } | null>;
  verify: Verify;
}

/** A pilot needs at least this many questions per test to be worth sitting. */
const MIN_ITEMS = 6;
const CHECKER_WAIT_MS = 8_000;

const squash = (s: string) => s.replace(/\s/g, "").toLowerCase();

/**
 * Marks one answer. The maths checker decides when it can be reached. When
 * it cannot, a stored answer is matched plainly and the mark is flagged, so
 * the report can say so and re-mark it later; with neither, it stays unmarked.
 */
export async function markAnswer(verify: Verify, item: PilotItem, answer: string): Promise<PilotAnswer> {
  const verdict = await Promise.race([
    verify(item.check as Check, answer).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), CHECKER_WAIT_MS).unref?.()),
  ]);
  if (verdict !== null) return { answer, correct: verdict };
  if (item.answer !== undefined) return { answer, correct: squash(answer) === squash(String(item.answer)), exact: true };
  return { answer, correct: null };
}

/**
 * What a pilot means for a learner starting a lesson: whether they may,
 * and which questions are set aside for their tests.
 */
export async function pilotGate(
  store: Store,
  studentId: string,
  pack: CurriculumPack,
): Promise<{ blocked: string | null; heldOut: Set<number>; heldPrompts: Set<string> }> {
  const none = { blocked: null, heldOut: new Set<number>(), heldPrompts: new Set<string>() };
  const open = await store.openPilotOfStudent(studentId);
  if (!open) return none;
  const { pilot, arm } = open;
  if (arm === "comparison") {
    return { ...none, blocked: `Your class is taking part in "${pilot.name}". Your group starts with the tutor as soon as it ends.` };
  }
  if (pilot.status === "baseline") {
    const sat = await store.getPilotAttempt(pilot.id, studentId, "baseline");
    if (!sat?.finishedAt) {
      return { ...none, blocked: `Before your first lesson, sit the short starting test for "${pilot.name}". Your teacher has your link.` };
    }
  }
  if (pilot.packId !== pack.id) return none;
  return {
    blocked: null,
    heldOut: heldOutIndexes(pack, pilot.forms),
    heldPrompts: new Set([...pilot.forms.A, ...pilot.forms.B].map((i) => i.prompt)),
  };
}

async function sessionTimes(store: Store, studentIds: string[]): Promise<Map<string, SessionTime[]>> {
  const out = new Map<string, SessionTime[]>();
  for (const id of studentIds) out.set(id, await store.listSessionSummaries(id, 1000));
  return out;
}

/** The report for one pilot, from the marks as stored. */
export async function reportFor(store: Store, pilot: PilotRecord) {
  const members = await store.listPilotMembers(pilot.id);
  const attempts = await store.listPilotAttempts(pilot.id);
  return buildReport(pilot, members, attempts, await sessionTimes(store, members.map((m) => m.studentId)));
}

export async function registerPilots(app: FastifyInstance, { store, userFromRequest, verify }: PilotDeps) {
  /** The caller's school, or the reply is already sent. */
  async function orgOf(req: FastifyRequest, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
    const user = await userFromRequest(req);
    if (!user) {
      reply.code(401).send({ error: "sign in required" });
      return null;
    }
    const org = await store.getOrgByOwner(user.userId);
    if (!org) {
      reply.code(404).send({ error: "create an organization first" });
      return null;
    }
    return org;
  }

  /** A pilot of the caller's own school, or the reply is already sent. */
  async function ownPilot(req: FastifyRequest<{ Params: { id: string } }>, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
    const org = await orgOf(req, reply);
    if (!org) return null;
    const pilot = await store.getPilot(req.params.id);
    if (!pilot || pilot.orgId !== org.id) {
      reply.code(404).send({ error: "no such pilot" });
      return null;
    }
    return { org, pilot };
  }

  const idParam = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;

  const summary = (p: PilotRecord) => ({
    id: p.id,
    name: p.name,
    packId: p.packId,
    packTitle: loadPack(p.packId).title,
    comparison: p.comparison,
    status: p.status,
    questionsPerTest: p.forms.A.length,
    skills: p.skillIds.map((id) => ({ id, title: skillTitle(id) })),
    createdAt: p.createdAt,
    endlineOpenedAt: p.endlineOpenedAt,
    closedAt: p.closedAt,
  });

  /** Subjects a pilot can be run in: those with enough machine-marked questions to build two tests. */
  const options = () =>
    PACK_IDS.map((id) => loadPack(id))
      .map((pack) => ({ id: pack.id, title: pack.title, skills: testableSkills(pack).map((s) => ({ id: s.id, title: s.title })) }))
      .filter((p) => buildForms(loadPack(p.id), undefined, "probe").forms.A.length >= MIN_ITEMS);

  app.get("/orgs/pilots", async (req, reply) => {
    const org = await orgOf(req, reply);
    if (!org) return;
    return { options: options(), pilots: (await store.listPilots(org.id)).map(summary) };
  });

  app.post<{ Body: { name: string; packId: string; skillIds?: string[]; comparison?: boolean } }>(
    "/orgs/pilots",
    {
      schema: {
        body: {
          type: "object",
          required: ["name", "packId"],
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 2, maxLength: 120 },
            packId: { type: "string", maxLength: 40 },
            skillIds: { type: "array", maxItems: 60, items: { type: "string", maxLength: 80 } },
            comparison: { type: "boolean" },
          },
        },
      },
    },
    async (req, reply) => {
      const org = await orgOf(req, reply);
      if (!org) return;
      if ((await store.listPilots(org.id)).some((p) => p.status !== "closed")) {
        return reply.code(409).send({ error: "a pilot is already running. Close it before starting another" });
      }
      if (!options().some((o) => o.id === req.body.packId)) {
        return reply.code(400).send({ error: "that subject does not have enough machine-marked questions for a fair test yet" });
      }
      const pack = loadPack(req.body.packId);
      const roster = await store.listOrgStudents(org.id);
      const comparison = req.body.comparison ?? false;
      if (roster.length < (comparison ? 2 : 1)) {
        return reply.code(400).send({ error: comparison ? "a comparison needs at least two learners on the roster" : "add learners to the roster first" });
      }
      // Fresh randomness decides the tests and the groups; neither the
      // school nor we can steer who is tutored.
      const seed = randomBytes(16).toString("hex");
      const { forms, skillIds } = buildForms(pack, req.body.skillIds, seed);
      if (forms.A.length < MIN_ITEMS) {
        return reply.code(400).send({ error: `those skills give only ${forms.A.length} questions per test. Choose more skills (at least ${MIN_ITEMS} questions are needed)` });
      }
      const members = assign(roster.map((s) => s.id), comparison, seeded(`${seed}:groups`)).map((m) => ({ ...m, code: randomBytes(16).toString("hex") }));
      const { id } = await store.createPilot({ orgId: org.id, name: req.body.name.trim(), packId: pack.id, skillIds, comparison, forms, members });
      return summary((await store.getPilot(id))!);
    },
  );

  app.get<{ Params: { id: string } }>("/orgs/pilots/:id", { schema: { params: idParam } }, async (req, reply) => {
    const own = await ownPilot(req, reply);
    if (!own) return;
    const attempts = await store.listPilotAttempts(own.pilot.id);
    const state = (studentId: string, phase: Phase) => {
      const a = attempts.find((x) => x.studentId === studentId && x.phase === phase);
      return !a ? "not started" : a.finishedAt ? "done" : "started";
    };
    const members = (await store.listPilotMembers(own.pilot.id))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map((m) => ({ studentId: m.studentId, displayName: m.displayName, group: m.arm, code: m.code, baseline: state(m.studentId, "baseline"), endline: state(m.studentId, "endline") }));
    const roster = await store.listOrgStudents(own.org.id);
    return { ...summary(own.pilot), members, notEnrolled: roster.filter((s) => !members.some((m) => m.studentId === s.id)).length };
  });

  /** Brings learners added to the roster since the pilot began into it, while the starting test is still open. */
  app.post<{ Params: { id: string } }>("/orgs/pilots/:id/enrol", { schema: { params: idParam } }, async (req, reply) => {
    const own = await ownPilot(req, reply);
    if (!own) return;
    if (own.pilot.status !== "baseline") return reply.code(409).send({ error: "learners can only join while the starting test is open" });
    const members = await store.listPilotMembers(own.pilot.id);
    const fresh = (await store.listOrgStudents(own.org.id)).filter((s) => !members.some((m) => m.studentId === s.id));
    if (fresh.length === 0) return { added: 0 };
    // Late joiners are split by chance too, then steered to whichever group
    // and form order is behind, so the balance holds.
    const count = { tutor: members.filter((m) => m.arm === "tutor").length, comparison: members.filter((m) => m.arm === "comparison").length };
    const orders = { AB: members.filter((m) => m.formOrder === "AB").length, BA: members.filter((m) => m.formOrder === "BA").length };
    const added = assign(fresh.map((s) => s.id), false, seeded(randomBytes(16).toString("hex"))).map((m) => {
      const arm = own.pilot.comparison && count.comparison < count.tutor ? ("comparison" as const) : ("tutor" as const);
      count[arm] += 1;
      const formOrder = orders.BA < orders.AB ? ("BA" as const) : ("AB" as const);
      orders[formOrder] += 1;
      return { studentId: m.studentId, arm, formOrder, code: randomBytes(16).toString("hex") };
    });
    await store.addPilotMembers(own.pilot.id, added);
    return { added: added.length };
  });

  app.post<{ Params: { id: string }; Body: { status: "endline" | "closed" } }>(
    "/orgs/pilots/:id/status",
    {
      schema: {
        params: idParam,
        body: { type: "object", required: ["status"], additionalProperties: false, properties: { status: { type: "string", enum: ["endline", "closed"] } } },
      },
    },
    async (req, reply) => {
      const own = await ownPilot(req, reply);
      if (!own) return;
      const from = own.pilot.status;
      const to = req.body.status;
      // Forward only: a test that has been opened cannot be un-opened.
      if (from === "closed" || from === to) return reply.code(409).send({ error: `this pilot is already ${from === "closed" ? "closed" : "at the final test"}` });
      await store.setPilotStatus(own.pilot.id, to, new Date());
      return summary((await store.getPilot(own.pilot.id))!);
    },
  );

  /**
   * Answers the checker could not judge when they were given are tried
   * again here, so a report read after an outage is marked properly.
   */
  async function remark(pilot: PilotRecord) {
    const items = new Map([...pilot.forms.A, ...pilot.forms.B].map((i) => [i.id, i]));
    for (const attempt of await store.listPilotAttempts(pilot.id)) {
      for (const [itemId, a] of Object.entries(attempt.answers)) {
        if (!(a.correct === null || a.exact)) continue;
        const item = items.get(itemId);
        if (!item) continue;
        const again = await markAnswer(verify, item, a.answer);
        if (again.correct === null || again.exact) return; // the checker is still away; stop asking
        await store.savePilotAnswer(attempt.id, itemId, again);
      }
    }
  }

  const fullReport = async (pilot: PilotRecord, orgName: string) => {
    await remark(pilot);
    const report = await reportFor(store, pilot);
    return {
      ...report,
      school: orgName,
      subject: loadPack(pilot.packId).title,
      skills: report.skills.map((s) => ({ ...s, title: skillTitle(s.skillId) })),
      skillsTested: pilot.skillIds.map((id) => skillTitle(id)),
    };
  };

  app.get<{ Params: { id: string } }>("/orgs/pilots/:id/report", { schema: { params: idParam } }, async (req, reply) => {
    const own = await ownPilot(req, reply);
    if (!own) return;
    return fullReport(own.pilot, own.org.name);
  });

  app.get<{ Params: { id: string }; Querystring: { names?: string } }>(
    "/orgs/pilots/:id/results.csv",
    { schema: { params: idParam } },
    async (req, reply) => {
      const own = await ownPilot(req, reply);
      if (!own) return;
      const report = await fullReport(own.pilot, own.org.name);
      const withNames = req.query.names === "1";
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="dingba-pilot-${withNames ? "named" : "anonymous"}-${new Date().toISOString().slice(0, 10)}.csv"`)
        .send(reportCsv(report, withNames));
    },
  );

  app.delete<{ Params: { id: string } }>("/orgs/pilots/:id", { schema: { params: idParam } }, async (req, reply) => {
    const own = await ownPilot(req, reply);
    if (!own) return;
    await store.deletePilot(own.pilot.id);
    return { deleted: true };
  });

  // ---- Sitting a test, by the learner's own link ----

  const codeParam = { type: "object", required: ["code"], properties: { code: { type: "string", pattern: "^[a-f0-9]{32}$" } } } as const;

  /** The sitting this link opens right now, or why there is none. */
  async function sitting(code: string) {
    const member = await store.pilotMemberByCode(code);
    if (!member) return { state: "unknown" as const };
    const pilot = (await store.getPilot(member.pilotId))!;
    if (pilot.status === "closed") return { state: "closed" as const, member, pilot };
    const phase: Phase = pilot.status;
    if (phase === "endline") {
      const first = await store.getPilotAttempt(pilot.id, member.studentId, "baseline");
      // Without a starting test there is nothing to compare a final test with; nobody's time is spent on one.
      if (!first?.finishedAt) return { state: "missed-start" as const, member, pilot };
    }
    const form = (phase === "baseline" ? member.formOrder[0] : member.formOrder[1]) as "A" | "B";
    return { state: "open" as const, member, pilot, phase, form };
  }

  app.post<{ Params: { code: string } }>("/pilot-tests/:code/open", { schema: { params: codeParam } }, async (req, reply) => {
    const s = await sitting(req.params.code);
    if (s.state === "unknown") return reply.code(404).send({ error: "this test link is not recognised" });
    const who = { learner: s.member.displayName, pilot: s.pilot.name };
    if (s.state !== "open") return { state: s.state, ...who };
    const attempt = await store.startPilotAttempt(s.pilot.id, s.member.studentId, s.phase, s.form);
    if (attempt.finishedAt) return { state: "done", ...who, phase: s.phase };
    return {
      state: "open",
      ...who,
      phase: s.phase,
      // Prompts only: what marks an answer never leaves the server.
      questions: s.pilot.forms[attempt.form].map((i) => ({ id: i.id, prompt: i.prompt })),
      answers: Object.fromEntries(Object.entries(attempt.answers).map(([id, a]) => [id, a.answer])),
    };
  });

  app.post<{ Params: { code: string }; Body: { questionId: string; answer: string } }>(
    "/pilot-tests/:code/answer",
    {
      schema: {
        params: codeParam,
        body: {
          type: "object",
          required: ["questionId", "answer"],
          additionalProperties: false,
          properties: { questionId: { type: "string", maxLength: 12 }, answer: { type: "string", minLength: 1, maxLength: 500 } },
        },
      },
    },
    async (req, reply) => {
      const s = await sitting(req.params.code);
      if (s.state !== "open") return reply.code(409).send({ error: "this test is not open" });
      const attempt = await store.startPilotAttempt(s.pilot.id, s.member.studentId, s.phase, s.form);
      if (attempt.finishedAt) return reply.code(409).send({ error: "this test has been handed in" });
      const item = s.pilot.forms[attempt.form].find((i) => i.id === req.body.questionId);
      if (!item) return reply.code(400).send({ error: "not a question in this test" });
      await store.savePilotAnswer(attempt.id, item.id, await markAnswer(verify, item, req.body.answer.trim()));
      // Saved, and nothing about right or wrong: the test teaches nothing and tells nothing until the report.
      return { saved: true };
    },
  );

  app.post<{ Params: { code: string } }>("/pilot-tests/:code/finish", { schema: { params: codeParam } }, async (req, reply) => {
    const s = await sitting(req.params.code);
    if (s.state !== "open") return reply.code(409).send({ error: "this test is not open" });
    const attempt = await store.startPilotAttempt(s.pilot.id, s.member.studentId, s.phase, s.form);
    await store.finishPilotAttempt(attempt.id, new Date());
    return { state: "done" };
  });
}
