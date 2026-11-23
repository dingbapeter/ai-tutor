/**
 * The small signs of life that make a face a person and not a puppet.
 *
 * A real head is never still. It breathes, it blinks on its own irregular
 * clock, its eyes make tiny darts and settle, it nods along to its own
 * sentences. None of this is triggered by anything; it just happens, and
 * its absence is what the eye reads as "dead". These rules produce it from
 * time alone, so they can be tested, and so every tutor moves like a person
 * rather than like a loop.
 */

export interface BlinkState {
  /** When the next blink starts, ms. */
  next: number;
  /** When the current blink ends, ms. 0 when not blinking. */
  until: number;
}

/** Start the clock: first blink within the first three seconds. */
export function initialBlink(nowMs: number, rand: () => number = Math.random): BlinkState {
  return { next: nowMs + 800 + rand() * 2200, until: 0 };
}

/**
 * Advance the blink clock. People blink every 2 to 6 seconds, faster when
 * a blink was just a flicker, and about one in seven is a double.
 */
export function stepBlink(state: BlinkState, nowMs: number, rand: () => number = Math.random): BlinkState {
  if (nowMs >= state.next) {
    const double = rand() < 0.15;
    return {
      until: nowMs + 130,
      next: nowMs + (double ? 320 : 2200 + rand() * 3800),
    };
  }
  return state;
}

/** Eyelid closure 0..1 for this instant: a quick shut and a slower open. */
export function lidTarget(state: BlinkState, nowMs: number): number {
  return nowMs < state.until ? 1 : 0;
}

/**
 * Breathing: a slow rise and fall, about fifteen breaths a minute, as a
 * fraction 0..1. Drive the chest or a hair of head lift with it.
 */
export function breath(nowMs: number, ratePerMin = 15): number {
  const period = 60_000 / ratePerMin;
  return 0.5 + 0.5 * Math.sin((nowMs / period) * Math.PI * 2);
}

/**
 * Slow, wandering head motion. Two sines at unrelated rates never repeat
 * visibly, which is what stops it reading as a loop. Radians, small.
 */
export function headSway(nowMs: number): { yaw: number; pitch: number; roll: number } {
  const t = nowMs / 1000;
  return {
    yaw: 0.035 * Math.sin(t * 0.37) + 0.015 * Math.sin(t * 1.31),
    pitch: 0.02 * Math.sin(t * 0.53 + 1.0) + 0.01 * Math.sin(t * 1.7),
    roll: 0.012 * Math.sin(t * 0.29 + 2.0),
  };
}

/**
 * A nod that follows the voice: when the loudness rises the head dips a
 * touch, the way people stress a word with their chin. Returns extra pitch.
 */
export function speechNod(level: number, prevLevel: number): number {
  const rise = Math.max(0, level - prevLevel);
  return Math.min(0.05, rise * 0.25);
}

export type Attention = "idle" | "thinking" | "listening" | "speaking" | "attentive";

/**
 * Where the eyes want to be. Thinking looks up and away, listening looks at
 * you, speaking looks at you with the odd glance off, idle wanders.
 */
export function gazeTarget(
  attention: Attention,
  nowMs: number,
  rand: () => number = Math.random,
): { x: number; y: number } {
  const t = nowMs / 1000;
  switch (attention) {
    case "thinking":
      return { x: 0.45 * Math.sin(t * 0.2) , y: 0.55 };
    case "listening":
    case "attentive":
      return { x: 0.06 * Math.sin(t * 0.7), y: 0.05 };
    case "speaking":
      // Mostly on you; every few seconds a short glance aside, as people do.
      return { x: Math.sin(t * 0.9) > 0.92 ? (rand() < 0.5 ? -0.5 : 0.5) : 0.05 * Math.sin(t), y: 0.02 };
    default:
      return { x: 0.35 * Math.sin(t * 0.23), y: 0.15 * Math.sin(t * 0.17) };
  }
}

/** Ease a value towards a target with a time constant, frame-rate independent. */
export function approach(current: number, target: number, dtMs: number, tauMs: number): number {
  const k = 1 - Math.exp(-Math.max(0, dtMs) / Math.max(1, tauMs));
  return current + (target - current) * k;
}
