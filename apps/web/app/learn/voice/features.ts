/**
 * How a learner sounds, measured on their own device while they talk, for
 * voice familiarity (apps/api/src/tutor/voice.ts has the whole story).
 *
 * Ten times a second the recorder hands us a slice of their voice; we keep
 * two numbers from it, how loud it was and its pitch, and throw the slice
 * away. When they finish, those become four numbers for the whole turn:
 * typical pitch, how much it moved, loudness, and seconds of speech. That
 * is all that leaves the device about their voice, beside the recording the
 * tutor already transcribes.
 */

export interface Frame {
  /** Loudness of this slice, 0..1 (root mean square). */
  level: number;
  /** Pitch in Hz, or null when the slice was silence, noise or a whisper. */
  pitch: number | null;
}

export interface TurnVoice {
  pitchHz?: number;
  rangeSt?: number;
  level: number;
  voicedSec: number;
}

/** Quieter than this is the room, not the learner. */
export const VOICED = 0.02;
/** Human speaking pitch, a deep adult voice to a small child's. */
const LOW_HZ = 70;
const HIGH_HZ = 600;
/** How clearly a slice must repeat itself to count as a pitch at all. */
const CLARITY = 0.6;

export function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / Math.max(1, buf.length));
}

/**
 * The pitch of one slice, by asking at which delay the wave best matches
 * itself (normalised autocorrelation), with a small refinement between
 * samples. Null for silence, noise, or anything outside human speech.
 */
export function pitchOf(buf: Float32Array, sampleRate: number): number | null {
  if (rms(buf) < VOICED) return null;
  const minLag = Math.floor(sampleRate / HIGH_HZ);
  const maxLag = Math.min(Math.floor(sampleRate / LOW_HZ), buf.length - 1);
  if (maxLag <= minLag + 2) return null;

  const corr = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1 && lag < buf.length; lag++) {
    let xy = 0;
    let xx = 0;
    let yy = 0;
    for (let i = 0; i + lag < buf.length; i++) {
      xy += buf[i] * buf[i + lag];
      xx += buf[i] * buf[i];
      yy += buf[i + lag] * buf[i + lag];
    }
    corr[lag] = xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0;
  }

  // A wave always resembles itself at the smallest delays; walk down out of
  // that hill first, or a slow hum reads as the highest pitch allowed.
  let start = minLag + 1;
  while (start < maxLag && corr[start] <= corr[start - 1]) start++;
  if (start >= maxLag) return null;

  // The first strong peak, not merely the highest: the highest is often a
  // whole number of periods further on, which would read an octave low.
  let best = -1;
  let bestLag = -1;
  for (let lag = start; lag < maxLag; lag++) {
    if (corr[lag] > best) {
      best = corr[lag];
      bestLag = lag;
    }
  }
  if (best < CLARITY) return null;
  for (let lag = start; lag < maxLag; lag++) {
    const peak = corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1];
    if (peak && corr[lag] >= best * 0.9) {
      bestLag = lag;
      break;
    }
  }
  const a = corr[bestLag - 1];
  const b = corr[bestLag];
  const c = corr[bestLag + 1];
  const shift = a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  const hz = sampleRate / (bestLag + Math.max(-0.5, Math.min(0.5, shift)));
  return hz >= LOW_HZ && hz <= HIGH_HZ ? hz : null;
}

const quantile = (sorted: number[], q: number) => {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

/** A turn's frames into four numbers. Null when they hardly spoke. */
export function summarise(frames: Frame[], everyMs = 100): TurnVoice | null {
  const voiced = frames.filter((f) => f.level > VOICED);
  if (voiced.length < 5) return null;
  const level = voiced.reduce((a, f) => a + f.level, 0) / voiced.length;
  const out: TurnVoice = { level, voicedSec: (voiced.length * everyMs) / 1000 };
  const pitches = voiced.map((f) => f.pitch).filter((p): p is number => p !== null).sort((a, b) => a - b);
  if (pitches.length >= 5) {
    out.pitchHz = quantile(pitches, 0.5);
    out.rangeSt = 12 * Math.log2(quantile(pitches, 0.75) / quantile(pitches, 0.25));
  }
  return out;
}

/** The header the voice turn carries: "pitch=212.5;range=3.1;level=0.142;voiced=3.4". */
export function encodeVoice(v: TurnVoice): string {
  return [
    v.pitchHz !== undefined ? `pitch=${v.pitchHz.toFixed(1)}` : null,
    v.rangeSt !== undefined ? `range=${v.rangeSt.toFixed(2)}` : null,
    `level=${v.level.toFixed(3)}`,
    `voiced=${v.voicedSec.toFixed(1)}`,
  ]
    .filter(Boolean)
    .join(";");
}
