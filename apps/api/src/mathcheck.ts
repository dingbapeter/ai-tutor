/**
 * Client for services/mathcheck (FastAPI + SymPy). The tutor LLM never gets
 * final say on numeric correctness — checkable answers are verified here.
 * If the service is unreachable we return null and the tutor falls back to
 * its own judgement (logged, so it's visible how often that happens).
 */

export type Check =
  | { type: "solve"; equation: string; variable: string }
  | { type: "compare"; left: string; right: string; expected: string }
  | { type: "equivalent"; expression: string; noParentheses?: boolean }
  | { type: "rubric"; criteria: string[] };

const BASE = process.env.MATHCHECK_URL ?? "http://localhost:8090";

export async function verifyAnswer(check: Check, studentAnswer: string): Promise<boolean | null> {
  try {
    if (check.type === "solve") {
      const res = await fetch(`${BASE}/check/solve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          equation: check.equation,
          variable: check.variable,
          student_answer: studentAnswer,
        }),
      });
      if (!res.ok) return null;
      return ((await res.json()) as { correct: boolean }).correct;
    }
    if (check.type === "compare") {
      // The student answers with a value; correct means naming the larger/smaller side.
      const bigger = check.expected === "<" ? check.right : check.left;
      return studentAnswer.replace(/\s/g, "") === bigger;
    }
    if (check.type === "equivalent") {
      // Simplify/expand tasks: symbolic equivalence, with an optional
      // no-brackets rule so typing the question back never scores.
      const res = await fetch(`${BASE}/check/equivalent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expression: check.expression,
          student_expression: studentAnswer,
          no_parentheses: check.noParentheses ?? false,
        }),
      });
      if (!res.ok) return null;
      return ((await res.json()) as { correct: boolean }).correct;
    }
    return null; // rubric checks are graded conversationally by the tutor
  } catch {
    return null;
  }
}
