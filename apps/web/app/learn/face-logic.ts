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

/**
 * The tutor grows up alongside the child. Maturity runs 0..1 over the life
 * of the friendship — a gentle curve that moves fast in the first months
 * (when a young learner changes most) and settles as the years pass. Days,
 * not sessions, so it tracks real time together the way a real friendship
 * would. Capped at 1 so an old friend never keeps morphing.
 */
export function maturityFromDays(days: number): number {
  if (days <= 0) return 0;
  // ~630 days (about two school years) to reach ~0.9; asymptotes at 1.
  return Math.min(1, 1 - Math.exp(-days / 400));
}

/**
 * The student's voice, not just their words. Given a short series of
 * loudness samples (0..1) captured while they spoke, decide the tone:
 * "low" when they were quiet and flat (tired, discouraged, withdrawn),
 * "bright" when lively and varied (engaged, excited), "neutral" otherwise.
 * Flatness = how little the loudness varied; a monotone mumble reads low
 * even if not especially quiet. Too little audio to judge stays neutral.
 */
export function voiceToneFromEnergy(samples: number[]): "low" | "bright" | "neutral" {
  const voiced = samples.filter((s) => s > 0.02);
  if (voiced.length < 5) return "neutral";
  const mean = voiced.reduce((a, b) => a + b, 0) / voiced.length;
  const variance = voiced.reduce((a, b) => a + (b - mean) ** 2, 0) / voiced.length;
  const spread = Math.sqrt(variance);
  if (mean < 0.12 && spread < 0.06) return "low";
  if (mean > 0.28 || spread > 0.14) return "bright";
  return "neutral";
}
