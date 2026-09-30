/**
 * From what the face should be doing to what the model can do.
 *
 * A rigged character carries named sliders (morph targets) for its face.
 * The common vocabulary is Apple's ARKit set of 52, and many characters
 * also carry the fifteen Oculus visemes. This module speaks both: it turns
 * a mouth shape, a mood, a blink and a gaze into slider weights, and finds
 * the right slider even when an artist's tool has prefixed or renamed it.
 *
 * Nothing here touches the 3D library; it is arithmetic on names and
 * numbers, and tested as such.
 */
import type { Mood } from "../face-logic";
import type { Viseme } from "./visemes";

export type Weights = Record<string, number>;

/** The fifteen Oculus viseme slider names as they usually appear. */
export const OCULUS_VISEMES: Viseme[] = [
  "sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "ih", "oh", "ou",
];

/**
 * Each viseme as a blend of ARKit shapes, for characters without viseme
 * sliders of their own. Values are the fully-hit shape; intensity scales them.
 */
export const VISEME_TO_ARKIT: Record<Viseme, Weights> = {
  sil: {},
  PP: { mouthClose: 0.9, mouthPressLeft: 0.5, mouthPressRight: 0.5, jawOpen: 0.05 },
  FF: { mouthFunnel: 0.15, mouthLowerDownLeft: 0.3, mouthLowerDownRight: 0.3, jawOpen: 0.12, mouthRollLower: 0.6 },
  TH: { jawOpen: 0.2, mouthUpperUpLeft: 0.2, mouthUpperUpRight: 0.2, tongueOut: 0.4 },
  DD: { jawOpen: 0.22, mouthStretchLeft: 0.15, mouthStretchRight: 0.15 },
  kk: { jawOpen: 0.28, mouthStretchLeft: 0.1, mouthStretchRight: 0.1 },
  CH: { jawOpen: 0.18, mouthFunnel: 0.45, mouthPucker: 0.2 },
  SS: { jawOpen: 0.1, mouthStretchLeft: 0.35, mouthStretchRight: 0.35, mouthClose: 0.2 },
  nn: { jawOpen: 0.15, mouthClose: 0.3, mouthStretchLeft: 0.1, mouthStretchRight: 0.1 },
  RR: { jawOpen: 0.2, mouthFunnel: 0.35, mouthPucker: 0.15 },
  aa: { jawOpen: 0.75, mouthLowerDownLeft: 0.2, mouthLowerDownRight: 0.2 },
  E: { jawOpen: 0.35, mouthStretchLeft: 0.45, mouthStretchRight: 0.45, mouthSmileLeft: 0.15, mouthSmileRight: 0.15 },
  ih: { jawOpen: 0.25, mouthStretchLeft: 0.35, mouthStretchRight: 0.35 },
  oh: { jawOpen: 0.55, mouthFunnel: 0.6, mouthPucker: 0.25 },
  ou: { jawOpen: 0.3, mouthPucker: 0.75, mouthFunnel: 0.5 },
};

/** A mood as a face. Intensity 0..1 scales the whole expression. */
export function moodToArkit(mood: Mood, intensity = 1): Weights {
  const k = Math.min(1, Math.max(0, intensity));
  const scale = (w: Weights): Weights => Object.fromEntries(Object.entries(w).map(([n, v]) => [n, v * k]));
  switch (mood) {
    case "joy":
      return scale({ mouthSmileLeft: 0.75, mouthSmileRight: 0.75, cheekSquintLeft: 0.35, cheekSquintRight: 0.35, eyeSquintLeft: 0.2, eyeSquintRight: 0.2, browInnerUp: 0.1 });
    case "warm":
      return scale({ mouthSmileLeft: 0.38, mouthSmileRight: 0.38, cheekSquintLeft: 0.12, cheekSquintRight: 0.12, browInnerUp: 0.08 });
    case "concern":
      return scale({ browInnerUp: 0.65, browDownLeft: 0.15, browDownRight: 0.15, mouthFrownLeft: 0.22, mouthFrownRight: 0.22, mouthPressLeft: 0.15, mouthPressRight: 0.15 });
    case "focus":
      return scale({ browDownLeft: 0.35, browDownRight: 0.35, eyeSquintLeft: 0.18, eyeSquintRight: 0.18, mouthPressLeft: 0.1, mouthPressRight: 0.1 });
    default:
      return {};
  }
}

/** Eyelids: 0 open, 1 shut. */
export function blinkToArkit(lid: number): Weights {
  const v = Math.min(1, Math.max(0, lid));
  return { eyeBlinkLeft: v, eyeBlinkRight: v };
}

/**
 * Where the eyes look, as ARKit sliders. x: -1 (their left) .. 1 (their
 * right), y: -1 down .. 1 up. Looking right means the left eye looks "in"
 * and the right eye looks "out".
 */
export function gazeToArkit(x: number, y: number): Weights {
  const cx = Math.min(1, Math.max(-1, x));
  const cy = Math.min(1, Math.max(-1, y));
  const w: Weights = {};
  if (cx > 0) { w.eyeLookInLeft = cx; w.eyeLookOutRight = cx; }
  if (cx < 0) { w.eyeLookOutLeft = -cx; w.eyeLookInRight = -cx; }
  if (cy > 0) { w.eyeLookUpLeft = cy; w.eyeLookUpRight = cy; }
  if (cy < 0) { w.eyeLookDownLeft = -cy; w.eyeLookDownRight = -cy; }
  return w;
}

/** The mouth for this instant, as sliders, whichever kind the model has. */
export function mouthWeights(
  from: Viseme,
  to: Viseme,
  blend: number,
  intensity: number,
  hasVisemeSliders: boolean,
): Weights {
  const k = Math.min(1, Math.max(0, intensity));
  const b = Math.min(1, Math.max(0, blend));
  if (hasVisemeSliders) {
    const w: Weights = {};
    if (from !== "sil") w[`viseme_${from}`] = (1 - b) * k;
    if (to !== "sil") w[`viseme_${to}`] = (w[`viseme_${to}`] ?? 0) + b * k;
    return w;
  }
  const a = VISEME_TO_ARKIT[from];
  const c = VISEME_TO_ARKIT[to];
  const w: Weights = {};
  for (const [n, v] of Object.entries(a)) w[n] = (w[n] ?? 0) + v * (1 - b) * k;
  for (const [n, v] of Object.entries(c)) w[n] = (w[n] ?? 0) + v * b * k;
  return w;
}

/** Merge layers; later layers add, and everything is held to 0..1. */
export function compose(...layers: Weights[]): Weights {
  const out: Weights = {};
  for (const layer of layers) {
    for (const [n, v] of Object.entries(layer)) out[n] = Math.min(1, Math.max(0, (out[n] ?? 0) + v));
  }
  return out;
}

/**
 * Find a slider by meaning, not by exact spelling. Artists' tools export
 * "jawOpen" as "JawOpen", "blendShape1.jawOpen", "CC_Base_Body.Jaw_Open",
 * "viseme_aa" as "v_aa" or "vrc.v_aa". We match the tail, ignoring case,
 * dots, underscores and hyphens.
 */
export function resolveSlider(names: readonly string[], wanted: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[._\-\s]/g, "");
  const want = norm(wanted);
  const wantTail = want.replace(/^viseme/, "").replace(/^v(?=[a-z]{1,3}$)/, "");
  // "mouthSmileLeft" is often exported as "MouthSmile_L"; "...Right" as "_R".
  const wantSide = want.replace(/left$/, "l").replace(/right$/, "r");
  let best = -1;
  let bestScore = 0;
  names.forEach((n, i) => {
    const full = norm(n);
    const tail = full.split(".").pop() ?? full;
    let score = 0;
    if (full === want) score = 4;
    else if (full.endsWith(want)) score = 3;
    else if (wanted.startsWith("viseme_") && (tail === `v${wantTail}` || tail === `viseme${wantTail}` || full.endsWith(`v${wantTail}`))) score = 3;
    else if (wantSide !== want && (full === wantSide || full.endsWith(wantSide))) score = 3;
    else if (tail === want) score = 2;
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}

/** Does this model carry its own viseme sliders? */
export function hasVisemeSliders(names: readonly string[]): boolean {
  return ["aa", "oh", "PP"].every((v) => resolveSlider(names, `viseme_${v}`) >= 0);
}
