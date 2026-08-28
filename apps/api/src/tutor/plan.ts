import type { LearnerRoutine } from "../store/types.js";

/**
 * The study planner: turns what the platform already knows about a learner
 * into a week they can actually follow.
 *
 * Everything here is deterministic. Given the same mastery state, routine and
 * exam dates, the same week comes out, so the planner is testable to the day
 * and never invents work it cannot justify. The inputs:
 *
 *   due skills   the spaced-repetition scheduler's queue, most overdue first
 *   weak skills  low mastery but not yet due — practice, not review
 *   exams        dates parsed from the uploaded routine
 *   busy blocks  the learner's real timetable, so heavy school days get
 *                lighter plans instead of impossible ones
 */

export interface PlanInputs {
  dueSkills: Array<{ skillId: string; title: string; level: number }>;
  mastery: Array<{ skillId: string; title: string; level: number; attempts: number }>;
  routine: LearnerRoutine | null;
  streakDays: number;
  now: Date;
}

export interface PlanItem {
  kind: "review" | "practice" | "exam-prep" | "rest";
  skillId?: string;
  title: string;
  /** One line saying why this earned its place today. */
  why: string;
}

export interface PlanDay {
  /** ISO date, e.g. 2026-08-28. */
  date: string;
  /** Monday, Tuesday... in the learner's terms. */
  weekday: string;
  /** How loaded their real timetable is that day. */
  load: "free" | "light" | "busy";
  items: PlanItem[];
  examLabel?: string;
}

export interface StudyPlan {
  builtAt: string;
  days: PlanDay[];
  /** The one-line summary shown above the week. */
  headline: string;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_MS = 86_400_000;

/** Practice targets: weakest first, skipping anything already in review. */
function practiceQueue(inputs: PlanInputs): Array<{ skillId: string; title: string; level: number }> {
  const inReview = new Set(inputs.dueSkills.map((d) => d.skillId));
  return inputs.mastery
    .filter((m) => !inReview.has(m.skillId) && m.level < 0.7 && m.attempts > 0)
    .sort((a, b) => a.level - b.level);
}

/** Blocks on the learner's timetable for a weekday, best-effort matched. */
function blocksOn(routine: LearnerRoutine | null, weekday: string): number {
  if (!routine) return 0;
  const day = routine.weekly.find((w) => w.day.toLowerCase().startsWith(weekday.slice(0, 3).toLowerCase()));
  return day?.blocks.length ?? 0;
}

/** A timestamp's calendar day as UTC midnight, so day math is exact. */
function calendarDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Exams within the coming fortnight, soonest first, dates normalized. */
function upcomingExams(routine: LearnerRoutine | null, now: Date): Array<{ date: Date; label: string }> {
  if (!routine) return [];
  const today = calendarDay(now);
  return routine.examDates
    .map((e) => ({ date: new Date(`${e.date}T00:00:00Z`), label: e.label }))
    .filter((e) => {
      if (Number.isNaN(e.date.getTime())) return false;
      const gap = (calendarDay(e.date) - today) / DAY_MS;
      return gap >= 0 && gap <= 14;
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function buildStudyPlan(inputs: PlanInputs): StudyPlan {
  const { now } = inputs;
  const practice = practiceQueue(inputs);
  const review = [...inputs.dueSkills];
  const exams = upcomingExams(inputs.routine, now);

  const days: PlanDay[] = [];
  for (let i = 0; i < 7; i += 1) {
    const date = new Date(now.getTime() + i * DAY_MS);
    const weekday = WEEKDAYS[date.getUTCDay()];
    const iso = date.toISOString().slice(0, 10);
    const blocks = blocksOn(inputs.routine, weekday);
    const load: PlanDay["load"] = blocks >= 5 ? "busy" : blocks >= 1 ? "light" : "free";

    // A busy school day carries one item; a free day carries up to three.
    const capacity = load === "busy" ? 1 : load === "light" ? 2 : 3;
    const items: PlanItem[] = [];

    // An exam that day or the day after owns the slot entirely. Whole
    // calendar days, not timestamps: an afternoon clock must not turn the
    // exam day itself into "yesterday".
    const examSoon = exams.find((e) => {
      const gap = (calendarDay(e.date) - calendarDay(date)) / DAY_MS;
      return gap >= 0 && gap <= 1;
    });
    const examDay = exams.find((e) => e.date.toISOString().slice(0, 10) === iso);

    if (examSoon) {
      // Prep from the weakest relevant skills; the night before is revision,
      // never new material.
      const source = review.length ? review : practice;
      const target = source.shift();
      items.push({
        kind: "exam-prep",
        skillId: target?.skillId,
        title: target ? `Revise ${target.title}` : `Revise for ${examSoon.label}`,
        why: examDay ? `${examSoon.label} is today` : `${examSoon.label} is tomorrow`,
      });
    } else {
      while (items.length < capacity && (review.length || practice.length)) {
        // Overdue review beats new practice: forgetting compounds daily.
        const fromReview = review.length > 0;
        const target = fromReview ? review.shift()! : practice.shift()!;
        items.push({
          kind: fromReview ? "review" : "practice",
          skillId: target.skillId,
          title: fromReview ? `Review ${target.title}` : `Practise ${target.title}`,
          why: fromReview
            ? "due for review before it fades"
            : `mastery is at ${Math.round(target.level * 100)}%, worth a push`,
        });
      }
    }

    if (items.length === 0) {
      items.push({
        kind: "rest",
        title: "Nothing scheduled, ask your tutor anything",
        why: "everything is reviewed and nothing is due",
      });
    }

    days.push({ date: iso, weekday, load, items, examLabel: examDay?.label });
  }

  const reviewCount = days.flatMap((d) => d.items).filter((i) => i.kind === "review").length;
  const examCount = exams.length;
  const headline =
    examCount > 0
      ? `${examCount} exam${examCount === 1 ? "" : "s"} coming up, the week works back from ${exams[0].label}`
      : reviewCount > 0
        ? `${reviewCount} skill${reviewCount === 1 ? "" : "s"} due for review this week, spaced so nothing fades`
        : inputs.streakDays > 0
          ? `Nothing overdue. The ${inputs.streakDays} day streak is doing its job`
          : "A fresh start, the first session will set the pace";

  return { builtAt: now.toISOString(), days, headline };
}
