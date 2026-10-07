import type { ChatMessage, ChatProvider } from "@tutor/ai-gateway";

/**
 * Rubric judging: how visa answers, coaching reflections, and language
 * production get scored in a timed mock.
 *
 * The model is the judge, but never freehand: it grades against the
 * problem's own criteria and must answer in a fixed JSON shape that is
 * parsed deterministically. Anything that fails to parse or validate is a
 * null verdict, and the exam layer already treats null as UNSCORED, never
 * as wrong. A learner's mark can be "the judge couldn't grade this one",
 * but it can never be a coin flip.
 */

export interface RubricVerdict {
  pass: boolean;
  met: number;
  of: number;
  /** One short sentence for the learner, in the judge's words. */
  note: string;
}

/**
 * Whether rubric problems can appear in scored surfaces at all. The mock
 * provider exists for plumbing tests and demos; letting it grade a child's
 * exam would be a lie, so rubric mocks stay closed until a real model sits
 * behind the gateway.
 */
export function canJudgeRubrics(provider: ChatProvider): boolean {
  return provider.name !== "mock";
}

export async function judgeRubricAnswer(
  provider: ChatProvider,
  question: string,
  criteria: string[],
  answer: string,
  opts?: { signal?: AbortSignal },
): Promise<RubricVerdict | null> {
  const messages: ChatMessage[] = [
    {
      role: "user",
      content:
        `You are grading one exam answer against a fixed rubric. Grade only what is written, without inventing requirements.\n\n` +
        `Question: "${question}"\n\n` +
        `Criteria (count how many are genuinely met):\n${criteria.map((c) => `- ${c}`).join("\n")}\n\n` +
        `Student's answer:\n"""\n${answer}\n"""\n\n` +
        `The answer passes when it meets at least ${Math.max(1, Math.ceil(criteria.length * 0.75))} of the ${criteria.length} criteria.\n` +
        `Reply with ONLY this JSON, nothing else:\n` +
        `{"pass": true, "met": 0, "of": ${criteria.length}, "note": "one short, kind sentence telling the student the main thing to keep or fix"}`,
    },
  ];
  try {
    let out = "";
    for await (const delta of provider.chat(messages, { signal: opts?.signal, temperature: 0 })) out += delta;
    const start = out.indexOf("{");
    const end = out.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(out.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof parsed.pass !== "boolean") return null;
    const met = Number(parsed.met);
    const of = Number(parsed.of);
    return {
      pass: parsed.pass,
      met: Number.isFinite(met) ? Math.max(0, Math.min(criteria.length, Math.round(met))) : parsed.pass ? criteria.length : 0,
      of: Number.isFinite(of) && of > 0 ? Math.round(of) : criteria.length,
      note: typeof parsed.note === "string" ? parsed.note.slice(0, 300) : "",
    };
  } catch {
    return null;
  }
}
