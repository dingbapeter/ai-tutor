/**
 * Lip sync from the words themselves.
 *
 * Loudness alone can only open and close a mouth. Real speech has shapes:
 * the lips close for "m" and "b", round for "oo", spread for "ee", the teeth
 * touch the lip for "f". We know the sentence before the voice plays, so we
 * can lay those shapes out in time and then let the real loudness decide
 * how hard each one is hit. That is what makes a face look like it is
 * saying THESE words rather than chewing.
 *
 * The shape set is the fifteen Oculus visemes, which every rigged character
 * either carries directly or can be blended from ARKit shapes (see
 * blendshapes.ts). The letter-to-shape rules are English-first but degrade
 * gracefully: any Latin-script language gets sensible mouths, and a script
 * we cannot read still gets a natural open-close rhythm by syllable count
 * rather than nothing.
 *
 * Pure, and tested without a browser.
 */

export type Viseme =
  | "sil" | "PP" | "FF" | "TH" | "DD" | "kk" | "CH" | "SS" | "nn" | "RR"
  | "aa" | "E" | "ih" | "oh" | "ou";

export interface VisemeCue {
  viseme: Viseme;
  /** Start and end, in seconds from the beginning of the audio. */
  start: number;
  end: number;
}

/** How long each shape wants, relative to the others. Vowels carry a word. */
const WEIGHT: Record<Viseme, number> = {
  sil: 1.0, PP: 0.55, FF: 0.6, TH: 0.55, DD: 0.5, kk: 0.5, CH: 0.65, SS: 0.7, nn: 0.55, RR: 0.55,
  aa: 1.2, E: 1.0, ih: 0.85, oh: 1.15, ou: 1.1,
};

const VOWELS: Record<string, Viseme> = {
  a: "aa", e: "E", i: "ih", o: "oh", u: "ou", y: "ih",
  á: "aa", à: "aa", â: "aa", ä: "aa", ã: "aa", å: "aa",
  é: "E", è: "E", ê: "E", ë: "E",
  í: "ih", ì: "ih", î: "ih", ï: "ih",
  ó: "oh", ò: "oh", ô: "oh", ö: "oh", õ: "oh",
  ú: "ou", ù: "ou", û: "ou", ü: "ou",
};

const CONSONANTS: Record<string, Viseme> = {
  p: "PP", b: "PP", m: "PP",
  f: "FF", v: "FF",
  t: "DD", d: "DD",
  k: "kk", g: "kk", q: "kk", c: "kk", x: "kk",
  j: "CH",
  s: "SS", z: "SS",
  n: "nn", l: "nn",
  r: "RR",
  w: "ou",
};

/** Two-letter sounds that are one mouth shape, checked before single letters. */
const PAIRS: Record<string, Viseme> = {
  th: "TH", sh: "CH", ch: "CH", ph: "FF", ng: "nn", oo: "ou", ee: "ih", ou: "ou", ow: "oh", ay: "E", ai: "E", ea: "ih",
};

/** Roughly, is this a script we have letter rules for? */
function latinLike(word: string): boolean {
  return /^[a-zA-ZÀ-ɏ'’-]+$/.test(word);
}

/** One word into shapes. Empty for a word we cannot read at all. */
export function wordToVisemes(raw: string): Viseme[] {
  const word = raw.toLowerCase();
  if (!word) return [];
  if (!latinLike(word)) {
    // A script we cannot spell out: give it a syllable's worth of open and
    // close per two characters, which reads as talking rather than silence.
    const beats = Math.max(1, Math.round(Array.from(word).length / 2));
    const out: Viseme[] = [];
    for (let i = 0; i < beats; i++) out.push(i % 2 === 0 ? "aa" : "nn");
    return out;
  }
  const out: Viseme[] = [];
  let i = 0;
  while (i < word.length) {
    const pair = word.slice(i, i + 2);
    if (PAIRS[pair]) {
      out.push(PAIRS[pair]);
      i += 2;
      continue;
    }
    const ch = word[i];
    const v = VOWELS[ch] ?? CONSONANTS[ch];
    if (v) {
      // Doubled letters are one sound ("letter", "book").
      if (out[out.length - 1] !== v || VOWELS[ch]) out.push(v);
    }
    i += 1;
  }
  // A word with no readable vowel ("hmm", "shh") still moves the mouth once.
  if (!out.some((v) => v === "aa" || v === "E" || v === "ih" || v === "oh" || v === "ou")) out.push("ih");
  return out;
}

/**
 * Lay the whole sentence out across the audio's real duration.
 *
 * Words get a small silence between them and punctuation gets a longer one,
 * then everything is scaled so the last shape ends when the audio does. The
 * result is a timeline the face can read at any moment of playback.
 */
export function buildTimeline(text: string, durationSec: number): VisemeCue[] {
  const dur = Math.max(0.05, durationSec || 0);
  const tokens = text.split(/(\s+|[.,!?;:…]+)/).filter((t) => t.length > 0);
  const shapes: Array<{ viseme: Viseme; weight: number }> = [];
  // A breath before the first word, like a person.
  shapes.push({ viseme: "sil", weight: 0.6 });
  for (const tok of tokens) {
    if (/^\s+$/.test(tok)) {
      shapes.push({ viseme: "sil", weight: 0.35 });
      continue;
    }
    if (/^[.,!?;:…]+$/.test(tok)) {
      shapes.push({ viseme: "sil", weight: /[.!?…]/.test(tok) ? 1.6 : 1.0 });
      continue;
    }
    for (const v of wordToVisemes(tok)) shapes.push({ viseme: v, weight: WEIGHT[v] });
  }
  shapes.push({ viseme: "sil", weight: 0.8 });

  const total = shapes.reduce((a, s) => a + s.weight, 0) || 1;
  const cues: VisemeCue[] = [];
  let t = 0;
  for (const s of shapes) {
    const len = (s.weight / total) * dur;
    cues.push({ viseme: s.viseme, start: t, end: t + len });
    t += len;
  }
  if (cues.length) cues[cues.length - 1].end = dur;
  return cues;
}

/**
 * What the mouth is doing at this instant: the current shape, the one it is
 * moving towards, and how far along that move is (0..1). Lips do not snap
 * between shapes; blending across the join is what stops the chatter.
 */
export function shapeAt(
  timeline: VisemeCue[],
  timeSec: number,
): { from: Viseme; to: Viseme; blend: number } {
  if (timeline.length === 0) return { from: "sil", to: "sil", blend: 0 };
  const t = Math.max(0, timeSec);
  let idx = timeline.findIndex((c) => t < c.end);
  if (idx === -1) idx = timeline.length - 1;
  const cue = timeline[idx];
  const next = timeline[Math.min(idx + 1, timeline.length - 1)];
  const len = Math.max(1e-6, cue.end - cue.start);
  // The last 35% of every cue is the journey to the next shape.
  const into = (t - cue.start) / len;
  const blend = into < 0.65 ? 0 : (into - 0.65) / 0.35;
  return { from: cue.viseme, to: next.viseme, blend: Math.min(1, Math.max(0, blend)) };
}

/**
 * How hard to hit the shape, from the real loudness right now. A pause in
 * the audio closes the mouth even if the timeline says vowel, because the
 * voice is the truth and the timeline is the plan.
 */
export function intensityFromLevel(level: number): number {
  const v = (Math.max(0, level) - 0.03) / 0.22;
  return Math.min(1, Math.max(0, v));
}
