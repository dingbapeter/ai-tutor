/**
 * The living persona's inner weather, as pure logic. The Face component
 * renders it; this module decides it, so every rule is testable without
 * a browser.
 *
 * Honesty rule carried through the whole feature: the persona is a beloved
 * CHARACTER, openly an AI tutor. It feels alive; it never claims to be a
 * live human.
 */

export type Mood = "joy" | "warm" | "concern" | "focus" | "neutral";

/**
 * Reads the tutor's own last words and decides the face's emotional target.
 * Order matters: care for the student outranks celebration outranks warmth.
 */
export function moodFromText(text: string | null | undefined): Mood {
  if (!text) return "neutral";
  const t = text.toLowerCase();
  if (
    /(are you (ok|okay|alright)|everything alright|sounds (hard|tough|rough)|i'?m sorry|that'?s a lot|take a breath|no rush|we can slow down|want to tell me)/.test(
      t,
    )
  ) {
    return "concern";
  }
  if (
    /(well done|brilliant|excellent|exactly right|you got it|you'?ve got it|nailed it|perfect|great (job|work)|proud of you|that'?s (right|it)\b|correct!|🎉|⭐)/.test(
      t,
    )
  ) {
    return "joy";
  }
  if (/^(hi|hey|hello|welcome back|good to see you|glad you'?re here)/.test(t.trim())) return "warm";
  if (/\?\s*$/.test(t) || /(try this|your turn|what do you think|give it a go|next step|have a go)/.test(t)) {
    return "focus";
  }
  return "neutral";
}

export interface BondStage {
  stage: 0 | 1 | 2 | 3;
  label: string;
}

/**
 * The friendship grows with real time spent together, and the persona
 * visibly grows with it. Session counts, not calendar age: a child who
 * shows up every day earns an old friend faster.
 */
export function bondStage(sessions: number): BondStage {
  if (sessions >= 40) return { stage: 3, label: "Old friend" };
  if (sessions >= 15) return { stage: 2, label: "Trusted guide" };
  if (sessions >= 3) return { stage: 1, label: "Study buddy" };
  return { stage: 0, label: "New friend" };
}

/** Expression targets per mood: brow lift (-1 furrow .. 1 raised), mouth curve (-1 frown .. 1 grin). */
export function expressionFor(mood: Mood): { brow: number; curve: number } {
  switch (mood) {
    case "joy":
      return { brow: 0.9, curve: 1 };
    case "warm":
      return { brow: 0.4, curve: 0.6 };
    case "concern":
      return { brow: -0.5, curve: -0.35 };
    case "focus":
      return { brow: -0.15, curve: 0.15 };
    default:
      return { brow: 0, curve: 0.3 };
  }
}

/** Frame-rate-independent smoothing toward a target (exponential approach). */
export function approach(current: number, target: number, dtMs: number, tauMs = 180): number {
  const k = 1 - Math.exp(-dtMs / tauMs);
  return current + (target - current) * k;
}
