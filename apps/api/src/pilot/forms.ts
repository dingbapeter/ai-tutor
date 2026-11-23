/**
 * The two tests of a pilot, built once and frozen.
 *
 * A fair before-and-after needs two things from its questions. They must
 * be equivalent, so a higher score at the end means more was learned and
 * not that the second test was easier: both forms draw the same number of
 * questions from the same skills, and which question of a pair lands on
 * which form is a coin toss. And they must be unseen, so nobody is tested
 * on a question they practised: the questions come from the end of each
 * skill's bank (lessons and level checks draw from the front), and are
 * held out of practice for the pilot's learners while it runs.
 *
 * The questions are copied into the pilot when it is made. A later edit to
 * the curriculum cannot change a test that has already been sat.
 */
import { createHash } from "node:crypto";
import type { CurriculumPack, CurriculumProblem } from "../tutor/prompt.js";

export interface PilotItem {
  /** Stable within the pilot: "a-01", "b-07". */
  id: string;
  skillId: string;
  prompt: string;
  check: Record<string, unknown>;
  answer?: string;
}
export interface PilotForms {
  A: PilotItem[];
  B: PilotItem[];
}

export const MAX_ITEMS = 20;
/** Questions a skill keeps for practice after the tests take theirs. */
const LEFT_FOR_PRACTICE = 2;

/** A question a machine can mark without a model's opinion. */
export const markable = (p: CurriculumProblem): boolean =>
  Boolean(p.skillId) &&
  (["solve", "compare", "equivalent"].includes(String((p.check as { type?: string })?.type)) || p.answer !== undefined);

/** A small deterministic generator, so the same pilot always gets the same tests. */
export function seeded(seed: string): () => number {
  let a = createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A skill's markable questions, each wording once. A bank can hold the
 * same question twice; counted twice, one copy could be "held back" for a
 * test while the other was practised in a lesson.
 */
function bankOf(pack: CurriculumPack, skillId: string): CurriculumProblem[] {
  const seen = new Set<string>();
  return pack.problems.filter((p) => {
    if (p.skillId !== skillId || !markable(p) || seen.has(p.prompt)) return false;
    seen.add(p.prompt);
    return true;
  });
}

/** How many questions per form each skill of a pack could supply. */
export function testableSkills(pack: CurriculumPack): Array<{ id: string; title: string; available: number }> {
  return pack.skills
    .map((s) => ({ id: s.id, title: s.title, available: Math.floor((bankOf(pack, s.id).length - LEFT_FOR_PRACTICE) / 2) }))
    .filter((s) => s.available >= 1);
}

/**
 * Two matched forms over the chosen skills (or every testable skill).
 * Ten skills or fewer get two questions each per form; more get one each;
 * more than twenty are sampled evenly across the curriculum ladder.
 */
export function buildForms(pack: CurriculumPack, skillIds: string[] | undefined, seed: string): { forms: PilotForms; skillIds: string[] } {
  const testable = testableSkills(pack);
  let chosen = skillIds?.length ? testable.filter((s) => skillIds.includes(s.id)) : testable;
  if (chosen.length > MAX_ITEMS) {
    const all = chosen;
    chosen = Array.from({ length: MAX_ITEMS }, (_, k) => all[Math.floor((k * all.length) / MAX_ITEMS)]);
  }
  const perSkill = chosen.length <= MAX_ITEMS / 2 ? 2 : 1;
  const rand = seeded(seed);
  const A: PilotItem[] = [];
  const B: PilotItem[] = [];
  for (const skill of chosen) {
    const bank = bankOf(pack, skill.id);
    const k = Math.min(perSkill, skill.available);
    // The last 2k questions of the bank, in pairs; a coin decides the form.
    const tail = bank.slice(bank.length - 2 * k);
    for (let i = 0; i < k; i++) {
      const pair = [tail[2 * i], tail[2 * i + 1]];
      if (rand() < 0.5) pair.reverse();
      for (const [form, p] of [[A, pair[0]], [B, pair[1]]] as const) {
        form.push({
          id: `${form === A ? "a" : "b"}-${String(form.length + 1).padStart(2, "0")}`,
          skillId: skill.id,
          prompt: p.prompt,
          check: p.check,
          ...(p.answer !== undefined ? { answer: p.answer } : {}),
        });
      }
    }
  }
  return { forms: { A, B }, skillIds: chosen.map((s) => s.id) };
}

/**
 * Positions in the pack of every question either form uses, for holding
 * them out of practice. By wording, so a repeated question is held out
 * wherever it sits.
 */
export function heldOutIndexes(pack: CurriculumPack, forms: PilotForms): Set<number> {
  const prompts = new Set([...forms.A, ...forms.B].map((i) => i.prompt));
  const out = new Set<number>();
  pack.problems.forEach((p, i) => {
    if (prompts.has(p.prompt)) out.add(i);
  });
  return out;
}

export type Arm = "tutor" | "comparison";
export type FormOrder = "AB" | "BA";

/**
 * Who is tutored, and who sits which form first. Learners are shuffled;
 * with a comparison group they alternate into the two groups, so the
 * split is by chance and as even as it can be. Within each group half sit
 * form A first and half form B, which cancels any difference in difficulty
 * between the forms out of the result.
 */
export function assign(studentIds: string[], comparison: boolean, rand: () => number): Array<{ studentId: string; arm: Arm; formOrder: FormOrder }> {
  const order = [...studentIds];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const seen: Record<Arm, number> = { tutor: 0, comparison: 0 };
  return order.map((studentId, i) => {
    const arm: Arm = comparison && i % 2 === 1 ? "comparison" : "tutor";
    const formOrder: FormOrder = seen[arm]++ % 2 === 0 ? "AB" : "BA";
    return { studentId, arm, formOrder };
  });
}
