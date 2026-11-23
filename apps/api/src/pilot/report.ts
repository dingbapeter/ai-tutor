/**
 * A pilot's outcome report, assembled from what was actually sat.
 *
 * The rule throughout: say only what the data supports. A before-and-after
 * with no comparison group cannot show the tutor caused a gain, so the
 * report says so in words. A handful of learners cannot support an
 * average, so none is given. Anyone who did not sit both tests is counted
 * and shown, never quietly dropped.
 */
import type { Arm, FormOrder, PilotForms, PilotItem } from "./forms.js";
import { csvCell } from "../command/csv.js";
import { gainDifference, mean, median, pairedGain, type GainDifference, type PairedGain } from "./stats.js";

export type Phase = "baseline" | "endline";

export interface ReportPilot {
  id: string;
  name: string;
  packId: string;
  comparison: boolean;
  status: "baseline" | "endline" | "closed";
  forms: PilotForms;
  createdAt: Date;
  endlineOpenedAt: Date | null;
  closedAt: Date | null;
}
export interface ReportMember {
  studentId: string;
  displayName: string;
  arm: Arm;
  formOrder: FormOrder;
}
export interface ReportAttempt {
  studentId: string;
  phase: Phase;
  form: "A" | "B";
  startedAt: Date;
  finishedAt: Date | null;
  answers: Record<string, { answer: string; correct: boolean | null; exact?: boolean }>;
}
export interface SessionTime {
  startedAt: Date;
  endedAt: Date | null;
}

/** Fewer matched learners than this and no average is reported at all. */
export const MIN_FOR_AVERAGE = 10;
/** Fewer than this and the result is labelled an early signal. */
export const MIN_FOR_RESULT = 30;

export interface Score {
  pct: number | null;
  correct: number;
  marked: number;
  unmarked: number;
}

/**
 * One sitting, marked. A question left blank is wrong. A question whose
 * answer could not be marked (the checker was unreachable) is left out of
 * the total rather than guessed either way, and counted.
 */
export function scoreAttempt(items: PilotItem[], answers: ReportAttempt["answers"]): Score {
  let correct = 0;
  let unmarked = 0;
  for (const item of items) {
    const a = answers[item.id];
    if (a && a.correct === null) unmarked += 1;
    else if (a?.correct) correct += 1;
  }
  const marked = items.length - unmarked;
  return { pct: marked > 0 ? (100 * correct) / marked : null, correct, marked, unmarked };
}

export interface LearnerRow {
  /** A code that carries no name, for sharing results outside the school. */
  code: string;
  studentId: string;
  displayName: string;
  arm: Arm;
  formOrder: FormOrder;
  baseline: number | null;
  endline: number | null;
  gain: number | null;
  /** Tutoring sessions between this learner's two tests. */
  sessions: number;
  /**
   * Different days they came to the tutor between the two tests. Days, not
   * minutes: a child closes the tab without ending a session, so a clock on
   * sessions would be a guess, and a count of days is not.
   */
  activeDays: number;
}

export interface ArmFlow {
  enrolled: number;
  satBaseline: number;
  satEndline: number;
  /** Sat both, and both could be marked: the learners the averages are about. */
  matched: number;
}

export interface PilotReport {
  pilot: { id: string; name: string; packId: string; status: string; createdAt: string; endlineOpenedAt: string | null; closedAt: string | null };
  design: "before-and-after" | "randomised comparison";
  itemsPerForm: number;
  flow: Record<Arm, ArmFlow>;
  /** "too-few": no averages. "early": averages, labelled an early signal. "result": enough to report plainly. */
  strength: "not-finished" | "too-few" | "early" | "result";
  tutor: PairedGain | null;
  comparison: PairedGain | null;
  difference: GainDifference | null;
  skills: Array<{ skillId: string; before: number; after: number; answers: number }>;
  dosage: {
    medianSessions: number;
    medianActiveDays: number;
    /** Mean gain of learners above the median number of sessions, and of the rest. Null when either group is under five. */
    moreSessions: { n: number; gain: number } | null;
    fewerSessions: { n: number; gain: number } | null;
  } | null;
  integrity: {
    formOrders: Record<FormOrder, number>;
    unmarkedAnswers: number;
    /** Answers judged by plain matching because the maths checker could not be reached. */
    exactMatchMarks: number;
    startedNotFinished: number;
    comparisonSessions: number;
    medianDaysBetweenTests: number | null;
  };
  /** The result in plain sentences, each one no stronger than the numbers. */
  reading: string[];
  learners: LearnerRow[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const pts = (n: number) => `${n > 0 ? "+" : ""}${round1(n)} points`;

export function buildReport(
  pilot: ReportPilot,
  members: ReportMember[],
  attempts: ReportAttempt[],
  sessionsOf: Map<string, SessionTime[]>,
): PilotReport {
  const find = (studentId: string, phase: Phase) => attempts.find((a) => a.studentId === studentId && a.phase === phase);
  const sorted = [...members].sort((a, b) => a.displayName.localeCompare(b.displayName) || a.studentId.localeCompare(b.studentId));
  let unmarkedAnswers = 0;
  let exactMatchMarks = 0;
  let startedNotFinished = 0;
  let comparisonSessions = 0;
  const daysBetween: number[] = [];

  const learners: LearnerRow[] = sorted.map((m, i) => {
    const sit = (phase: Phase) => {
      const a = find(m.studentId, phase);
      if (!a) return null;
      if (!a.finishedAt) {
        startedNotFinished += 1;
        return null;
      }
      const s = scoreAttempt(pilot.forms[a.form], a.answers);
      unmarkedAnswers += s.unmarked;
      exactMatchMarks += Object.values(a.answers).filter((x) => x.exact).length;
      return { attempt: a, score: s.pct };
    };
    const base = sit("baseline");
    const end = sit("endline");
    // Tutoring counts from the moment the first test was handed in to the
    // moment the second was started (or now, while the pilot still runs).
    let sessions = 0;
    const days = new Set<string>();
    if (base?.attempt.finishedAt) {
      const from = base.attempt.finishedAt.getTime();
      const to = (end?.attempt.startedAt ?? pilot.closedAt ?? new Date()).getTime();
      for (const s of sessionsOf.get(m.studentId) ?? []) {
        const t = s.startedAt.getTime();
        if (t < from || t > to) continue;
        sessions += 1;
        days.add(s.startedAt.toISOString().slice(0, 10));
      }
      if (end) daysBetween.push((end.attempt.startedAt.getTime() - from) / 86_400_000);
    }
    if (m.arm === "comparison") comparisonSessions += sessions;
    const baseline = base?.score ?? null;
    const endline = end?.score ?? null;
    return {
      code: `L${String(i + 1).padStart(2, "0")}`,
      studentId: m.studentId,
      displayName: m.displayName,
      arm: m.arm,
      formOrder: m.formOrder,
      baseline,
      endline,
      gain: baseline !== null && endline !== null ? endline - baseline : null,
      sessions,
      activeDays: days.size,
    };
  });

  const flowFor = (arm: Arm): ArmFlow => {
    const rows = learners.filter((l) => l.arm === arm);
    return {
      enrolled: rows.length,
      satBaseline: rows.filter((l) => l.baseline !== null).length,
      satEndline: rows.filter((l) => l.endline !== null).length,
      matched: rows.filter((l) => l.gain !== null).length,
    };
  };
  const flow = { tutor: flowFor("tutor"), comparison: flowFor("comparison") };

  const matched = (arm: Arm) => learners.filter((l) => l.arm === arm && l.gain !== null);
  const tutored = matched("tutor");
  const compared = matched("comparison");
  const enough = tutored.length >= MIN_FOR_AVERAGE && (!pilot.comparison || compared.length >= MIN_FOR_AVERAGE);
  const strength: PilotReport["strength"] =
    pilot.status === "baseline"
      ? "not-finished"
      : !enough
        ? "too-few"
        : tutored.length >= MIN_FOR_RESULT && (!pilot.comparison || compared.length >= MIN_FOR_RESULT)
          ? "result"
          : "early";

  const gainOf = (rows: LearnerRow[]) => pairedGain(rows.map((l) => l.baseline!), rows.map((l) => l.endline!));
  const tutor = enough ? gainOf(tutored) : null;
  const comparison = enough && pilot.comparison ? gainOf(compared) : null;
  const difference =
    enough && pilot.comparison
      ? gainDifference(tutored.map((l) => l.gain!), compared.map((l) => l.gain!), [...tutored, ...compared].map((l) => l.baseline!))
      : null;

  // Per skill, over the tutored learners who sat both tests.
  const skills: PilotReport["skills"] = [];
  if (enough) {
    const tally = new Map<string, { b: number; bn: number; e: number; en: number }>();
    for (const l of tutored) {
      for (const phase of ["baseline", "endline"] as const) {
        const a = find(l.studentId, phase)!;
        for (const item of pilot.forms[a.form]) {
          const ans = a.answers[item.id];
          if (ans && ans.correct === null) continue;
          const row = tally.get(item.skillId) ?? { b: 0, bn: 0, e: 0, en: 0 };
          if (phase === "baseline") {
            row.bn += 1;
            if (ans?.correct) row.b += 1;
          } else {
            row.en += 1;
            if (ans?.correct) row.e += 1;
          }
          tally.set(item.skillId, row);
        }
      }
    }
    const order = [...new Set(pilot.forms.A.map((i) => i.skillId))];
    for (const skillId of order) {
      const r = tally.get(skillId);
      if (r && r.bn > 0 && r.en > 0) skills.push({ skillId, before: (100 * r.b) / r.bn, after: (100 * r.e) / r.en, answers: r.bn + r.en });
    }
  }

  let dosage: PilotReport["dosage"] = null;
  if (enough) {
    const med = median(tutored.map((l) => l.sessions));
    const more = tutored.filter((l) => l.sessions > med);
    const fewer = tutored.filter((l) => l.sessions <= med);
    const split = more.length >= 5 && fewer.length >= 5;
    dosage = {
      medianSessions: med,
      medianActiveDays: median(tutored.map((l) => l.activeDays)),
      moreSessions: split ? { n: more.length, gain: mean(more.map((l) => l.gain!)) } : null,
      fewerSessions: split ? { n: fewer.length, gain: mean(fewer.map((l) => l.gain!)) } : null,
    };
  }

  const reading: string[] = [];
  if (strength === "not-finished") {
    reading.push("The final test has not been opened yet, so there is no result to report. This page fills in as learners sit it.");
  } else if (strength === "too-few") {
    const need = pilot.comparison ? `${MIN_FOR_AVERAGE} in each group` : `${MIN_FOR_AVERAGE}`;
    reading.push(
      `Only ${tutored.length}${pilot.comparison ? ` tutored and ${compared.length} comparison` : ""} learner${tutored.length === 1 && !pilot.comparison ? "" : "s"} sat both tests. That is too few for an average to mean anything (at least ${need} are needed), so none is given. Each learner's own scores are in the table.`,
    );
  } else if (tutor) {
    const real = tutor.ci && tutor.ci[0] > 0;
    reading.push(
      `${tutor.n} tutored learners sat both tests. Their average score went from ${round1(tutor.preMean)}% to ${round1(tutor.postMean)}%, a change of ${pts(tutor.gain)}${tutor.ci ? ` (95% interval ${round1(tutor.ci[0])} to ${round1(tutor.ci[1])})` : ""}. ${Math.round(tutor.improved * 100)}% of them scored higher at the end than at the start.`,
    );
    if (difference && comparison) {
      const clear = difference.ci && difference.ci[0] > 0;
      const against = difference.ci && difference.ci[1] < 0;
      reading.push(
        `The comparison group, chosen by chance from the same class and not tutored, changed by ${pts(comparison.gain)} over the same weeks. The tutored group gained ${round1(difference.difference)} points more${difference.ci ? ` (95% interval ${round1(difference.ci[0])} to ${round1(difference.ci[1])})` : ""}${difference.effect !== null ? `, which is ${round1(difference.effect * 100) / 100} of a standard deviation` : ""}.`,
      );
      reading.push(
        clear
          ? "Because the groups were split by chance and the interval stays above zero, this difference is evidence that the tutoring caused the extra gain."
          : against
            ? "The interval stays below zero: in this pilot the tutored group did worse than the comparison group."
            : "The interval includes zero, so this pilot cannot tell the tutored group's extra gain apart from chance. A larger group or a longer run would be needed to say more.",
      );
    } else {
      if (tutor.effect !== null) reading.push(`Measured against how spread out the starting scores were, the change is ${round1(tutor.effect * 100) / 100} of a standard deviation.`);
      reading.push(
        real
          ? "The interval stays above zero, so the improvement is unlikely to be chance. This pilot had no comparison group, so it shows that these learners improved while using the tutor, not that the tutor alone caused it: ordinary lessons over the same weeks, and having sat a similar test once before, also raise scores."
          : "The interval includes zero, so this pilot cannot tell the change apart from chance. It also had no comparison group, so even a clear rise could not be credited to the tutor alone.",
      );
    }
    if (strength === "early") reading.push(`With fewer than ${MIN_FOR_RESULT} learners in a group, treat this as an early signal, not a settled result.`);
    if (dosage?.moreSessions && dosage.fewerSessions) {
      reading.push(
        `The ${dosage.moreSessions.n} learners who used the tutor most (more sessions than the middle of the group) changed by ${pts(dosage.moreSessions.gain)} on average; the other ${dosage.fewerSessions.n} changed by ${pts(dosage.fewerSessions.gain)}. Keener learners may also be the ones who use the tutor more, so this is a pattern to note, not proof.`,
      );
    }
  }
  const lost = flow.tutor.enrolled + flow.comparison.enrolled - flow.tutor.matched - flow.comparison.matched;
  if (strength !== "not-finished" && lost > 0) {
    reading.push(`${lost} enrolled learner${lost === 1 ? " is" : "s are"} not in the averages because they did not complete both tests. If those who left differ from those who stayed, the averages lean towards the ones who stayed.`);
  }
  if (comparisonSessions > 0) reading.push(`Learners in the comparison group had ${comparisonSessions} tutoring session${comparisonSessions === 1 ? "" : "s"} during the pilot, which narrows the difference between the groups.`);
  if (unmarkedAnswers > 0) reading.push(`${unmarkedAnswers} answer${unmarkedAnswers === 1 ? "" : "s"} could not be marked and ${unmarkedAnswers === 1 ? "is" : "are"} left out of the scores rather than counted right or wrong.`);

  if (exactMatchMarks > 0) reading.push(`${exactMatchMarks} answer${exactMatchMarks === 1 ? " was" : "s were"} marked by plain matching because the maths checker could not be reached. A right answer written in a different form may have been marked wrong; opening this report again once the checker is back re-marks them.`);

  return {
    pilot: {
      id: pilot.id,
      name: pilot.name,
      packId: pilot.packId,
      status: pilot.status,
      createdAt: pilot.createdAt.toISOString(),
      endlineOpenedAt: pilot.endlineOpenedAt?.toISOString() ?? null,
      closedAt: pilot.closedAt?.toISOString() ?? null,
    },
    design: pilot.comparison ? "randomised comparison" : "before-and-after",
    itemsPerForm: pilot.forms.A.length,
    flow,
    strength,
    tutor,
    comparison,
    difference,
    skills,
    dosage,
    integrity: {
      formOrders: { AB: members.filter((m) => m.formOrder === "AB").length, BA: members.filter((m) => m.formOrder === "BA").length },
      unmarkedAnswers,
      exactMatchMarks,
      startedNotFinished,
      comparisonSessions,
      medianDaysBetweenTests: daysBetween.length ? round1(median(daysBetween)) : null,
    },
    reading,
    learners,
  };
}

/**
 * One row per learner. Without names it can leave the school. Text goes
 * through the shared spreadsheet-safe cell (a name must never run as a
 * formula); numbers are written as numbers, so a fall of five points reads
 * as -5 and not as text.
 */
export function reportCsv(report: PilotReport, withNames: boolean): string {
  const num = (n: number | null) => (n === null ? "" : String(round1(n)));
  const head = ["learner", ...(withNames ? ["name"] : []), "group", "form_order", "baseline_pct", "endline_pct", "gain_points", "sessions_between_tests", "days_active_between_tests"];
  const rows = report.learners.map((l) =>
    [
      csvCell(l.code),
      ...(withNames ? [csvCell(l.displayName)] : []),
      csvCell(l.arm),
      csvCell(l.formOrder),
      num(l.baseline),
      num(l.endline),
      num(l.gain),
      String(l.sessions),
      String(l.activeDays),
    ].join(","),
  );
  // A byte order mark and CRLF, as the other exports use, so Excel reads Yorùbá and Igbo names correctly.
  return `\uFEFF${[head.join(","), ...rows].join("\r\n")}\r\n`;
}
