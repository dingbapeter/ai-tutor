import type { CurriculumPack } from "./prompt.js";

/**
 * The lesson generator. A lesson here is not a wall of generated text: it is
 * a structured brief handed to the tutor persona, who then teaches it in
 * their own voice, conversationally, the way everything else on the platform
 * works.
 *
 * The honest division of labour:
 *   the structure     deterministic, from the curriculum graph (this file)
 *   the problems      from the SymPy-verified bank, never invented by a model
 *   the narration     the persona's, live in the session
 *
 * So a lesson can be tested to the word here, and the only part that rides
 * model quality is the part a model is actually good at.
 */

export interface LessonBrief {
  skillId: string;
  title: string;
  objective: string;
  /** Titles of prerequisite skills, for the recall warm-up. */
  recallTitles: string[];
  workedExample: { prompt: string; answer: string } | null;
  practice: Array<{ prompt: string; answer: string }>;
  /** The block injected into the system prompt. */
  briefText: string;
}

export class UnknownSkillError extends Error {
  constructor(skillId: string, packId: string) {
    super(`the ${packId} pack has no skill ${skillId}`);
  }
}

const PRACTICE_COUNT = 3;

export function buildLessonBrief(pack: CurriculumPack, skillId: string): LessonBrief {
  const skill = pack.skills.find((s) => s.id === skillId);
  if (!skill) throw new UnknownSkillError(skillId, pack.id);

  const recallTitles = skill.prerequisites
    .map((p) => pack.skills.find((s) => s.id === p)?.title)
    .filter((t): t is string => Boolean(t))
    .slice(0, 2);

  // Bank problems for this skill, in bank order so the lesson is stable.
  const bank = pack.problems.filter((p) => p.skillId === skillId && p.answer);
  const workedExample = bank[0] ? { prompt: bank[0].prompt, answer: bank[0].answer! } : null;
  const practice = bank.slice(1, 1 + PRACTICE_COUNT).map((p) => ({ prompt: p.prompt, answer: p.answer! }));

  const objective = `By the end, ${skill.title.toLowerCase()} should feel doable without help.`;

  const lines: string[] = [
    `\nTHIS SESSION IS A LESSON ON: ${skill.title}.`,
    `Objective: ${objective}`,
    `Run it in this order, conversationally, one step at a time, never as a lecture:`,
  ];
  let step = 1;
  if (recallTitles.length) {
    lines.push(`${step}. Recall: one quick question touching ${recallTitles.join(" and ")}, to warm up what this builds on.`);
    step += 1;
  }
  lines.push(`${step}. Explain the idea in your own voice, short, with one concrete everyday example.`);
  step += 1;
  if (workedExample) {
    lines.push(
      `${step}. Work this exact problem together, thinking aloud step by step: "${workedExample.prompt}" (the verified answer is ${workedExample.answer}; guide them to it, never just state it).`,
    );
    step += 1;
  }
  if (practice.length) {
    lines.push(
      `${step}. Guided practice, one at a time, easiest first. Ask, wait for their answer, respond to what they actually did:`,
    );
    for (const [i, p] of practice.entries()) {
      lines.push(`   ${step}.${i + 1} "${p.prompt}" (verified answer: ${p.answer})`);
    }
    step += 1;
  }
  lines.push(`${step}. Wrap up: ask them to say the idea back in one sentence of their own.`);
  lines.push(
    `Pace by their answers. If they struggle on recall, stay there; rushing a shaky foundation is how learners get lost. If they fly, skip ahead.`,
  );

  return {
    skillId,
    title: skill.title,
    objective,
    recallTitles,
    workedExample,
    practice,
    briefText: lines.join("\n") + "\n",
  };
}
