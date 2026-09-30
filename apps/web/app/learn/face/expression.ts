/**
 * Reading a face, on the phone, into one plain word.
 *
 * The face model gives 52 muscle-movement scores per frame (the same ARKit
 * names our 3D tutors use) and 478 landmark points. These rules turn a
 * stream of those into something a tutor can use: "smiling", "frowning",
 * "furrowed", "drowsy", "away", or nothing at all. They describe what is
 * visible, never a feeling (see apps/api/src/tutor/face.ts for why), and
 * they only ever speak about something that has lasted, never a flicker:
 * a blink is not drowsiness, a grin at a joke is not a mood, a glance at
 * the window is not "away".
 *
 * Pure and tested. Nothing here sees a picture; it sees numbers.
 */

export type Hint = "smiling" | "frowning" | "furrowed" | "drowsy" | "away";
export type Label = Hint | "none";

export interface FrameReading {
  /** Was a face found at all? */
  present: boolean;
  /** Blendshape scores by ARKit name, 0..1. */
  scores: Record<string, number>;
  /** Head turn from the landmarks: 0 faces the screen, 1 is side on. */
  turn: number;
}

const avg = (s: Record<string, number>, a: string, b: string) => ((s[a] ?? 0) + (s[b] ?? 0)) / 2;

/**
 * How far the head is turned, from three landmark points: the nose tip and
 * the two cheek edges. Facing the screen, the nose sits halfway between the
 * cheeks; turned, it slides towards one of them. Works whatever the camera
 * resolution or the distance from it. Returns 0 (facing) to 1 (side on).
 */
export function headTurn(nose: { x: number }, leftCheek: { x: number }, rightCheek: { x: number }): number {
  const span = rightCheek.x - leftCheek.x;
  if (Math.abs(span) < 1e-6) return 1;
  const pos = (nose.x - leftCheek.x) / span; // 0.5 when facing
  return Math.min(1, Math.abs(pos - 0.5) * 2);
}

/** One frame's single best description, or none. Order matters. */
export function labelFrame(f: FrameReading): Label {
  if (!f.present || f.turn > 0.55) return "away";
  const s = f.scores;
  // Eyes half shut for a whole frame. A blink passes in one frame at the
  // rate we sample, so only the window can turn this into "drowsy".
  if (avg(s, "eyeBlinkLeft", "eyeBlinkRight") > 0.5) return "drowsy";
  if (avg(s, "mouthSmileLeft", "mouthSmileRight") > 0.5) return "smiling";
  if (avg(s, "mouthFrownLeft", "mouthFrownRight") > 0.3) return "frowning";
  if (avg(s, "browDownLeft", "browDownRight") > 0.45) return "furrowed";
  return "none";
}

export interface Sample {
  at: number;
  label: Label;
}

/** How long a look must last before it counts, per kind of look. */
export const HOLD_MS: Record<Hint, number> = {
  smiling: 4_000,
  frowning: 6_000,
  furrowed: 8_000,
  drowsy: 12_000,
  away: 20_000,
};

/** Share of the samples in the window that must agree. */
export const AGREEMENT = 0.7;

/** Keep only what any window could still need. */
export function prune(samples: Sample[], now: number): Sample[] {
  const longest = Math.max(...Object.values(HOLD_MS));
  return samples.filter((s) => now - s.at <= longest);
}

/**
 * What has the face been doing, steadily? Each kind of look is judged over
 * its own window (a smile needs 4 seconds, looking away needs 20), and wins
 * only if at least 70% of the frames in that window agree and the window
 * is actually full of samples. When two could be claimed, the one that
 * matters most to a tutor wins: away, then drowsy, then frowning, furrowed,
 * smiling.
 */
export function steadyLabel(samples: Sample[], now: number, sampleEveryMs = 250): Label {
  const order: Hint[] = ["away", "drowsy", "frowning", "furrowed", "smiling"];
  for (const hint of order) {
    const windowMs = HOLD_MS[hint];
    const inWindow = samples.filter((s) => now - s.at <= windowMs);
    // The window must be genuinely covered, not two lucky frames.
    const needed = Math.floor((windowMs / sampleEveryMs) * 0.6);
    if (inWindow.length < needed) continue;
    const oldest = Math.min(...inWindow.map((s) => s.at));
    if (now - oldest < windowMs * 0.8) continue;
    const agree = inWindow.filter((s) => s.label === hint).length;
    if (agree / inWindow.length >= AGREEMENT) return hint;
  }
  return "none";
}

/** Minimum gap before the same hint is offered to the tutor again. */
export const REPEAT_AFTER_MS = 3 * 60_000;

/**
 * Should this message carry a hint? Only when there is one, and only when
 * it is news: a change since the last one sent, or the same one after a
 * long while. A tutor told "smiling" with every sentence would say so with
 * every sentence, which is not how a person behaves.
 */
export function hintToSend(
  steady: Label,
  last: { hint: Hint | null; at: number },
  now: number,
): Hint | null {
  if (steady === "none") return null;
  if (steady !== last.hint) return steady;
  return now - last.at >= REPEAT_AFTER_MS ? steady : null;
}
