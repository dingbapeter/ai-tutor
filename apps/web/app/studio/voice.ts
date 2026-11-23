/**
 * A stand-in voice for the Studio: the sound of someone saying the sample
 * line, without any words. The length follows the text, and each syllable
 * is a short voiced burst, so the engine's lip sync has a real loudness to
 * follow and real pauses to close on, exactly as it does with a tutor's
 * recorded voice. No speech engine, no network, no licence.
 *
 * Pure, and tested without a browser.
 */

export interface StandIn {
  samples: Float32Array<ArrayBuffer>;
  sampleRate: number;
  /** Seconds. */
  duration: number;
}

/** Roughly how many syllables a word has: its vowel groups, at least one. */
export function syllables(word: string): number {
  const groups = word.toLowerCase().match(/[aeiouyàáâäãåèéêëìíîïòóôöõùúûüæø]+/g);
  return Math.max(1, groups?.length ?? 0);
}

/** The syllables of a line, with a pause wherever punctuation would make one. */
export function plan(text: string): Array<"syllable" | "pause"> {
  const out: Array<"syllable" | "pause"> = [];
  for (const token of text.split(/\s+/).filter(Boolean)) {
    const n = syllables(token.replace(/[^\p{L}\p{N}']/gu, "") || "a");
    for (let i = 0; i < n; i++) out.push("syllable");
    if (/[.,;:!?…]$/.test(token)) out.push("pause");
  }
  return out;
}

const SYLLABLE_SEC = 0.17;
const GAP_SEC = 0.05;
const PAUSE_SEC = 0.28;
const TAIL_SEC = 0.25;

export function standInVoice(text: string, sampleRate = 48_000, pitchHz = 185): StandIn {
  const steps = plan(text);
  const totalSec =
    steps.reduce((s, k) => s + (k === "pause" ? PAUSE_SEC : SYLLABLE_SEC + GAP_SEC), 0) + TAIL_SEC;
  const samples = new Float32Array(new ArrayBuffer(Math.ceil(totalSec * sampleRate) * 4));
  let t = 0;
  let phase = 0;
  let k = 0;
  for (const step of steps) {
    if (step === "pause") {
      t += PAUSE_SEC;
      continue;
    }
    // A small, deterministic lilt so the line does not drone.
    const lilt = [0, 2, -1, 1, -2, 3][k++ % 6];
    const hz = pitchHz * 2 ** (lilt / 12);
    const n = Math.round(SYLLABLE_SEC * sampleRate);
    const start = Math.round(t * sampleRate);
    for (let i = 0; i < n && start + i < samples.length; i++) {
      phase += (2 * Math.PI * hz) / sampleRate;
      let v = 0;
      for (let h = 1; h <= 6; h++) v += Math.sin(h * phase) / h;
      const env = Math.sin((Math.PI * i) / n) ** 0.7;
      samples[start + i] = (0.35 * v * env) / 2.45;
    }
    t += SYLLABLE_SEC + GAP_SEC;
  }
  return { samples, sampleRate, duration: totalSec };
}
