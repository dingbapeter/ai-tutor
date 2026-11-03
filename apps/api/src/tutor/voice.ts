/**
 * Voice familiarity: the tutor gets to know how this learner usually
 * sounds, and notices when they sound unlike themselves.
 *
 * A good tutor who has sat with a child a few times knows their normal:
 * this one always speaks softly, that one races when excited. A fixed rule
 * ("a quiet voice means something is wrong") gets the quiet child wrong
 * every single lesson. So once the tutor knows a learner, the comparison is
 * with that learner, not with everyone.
 *
 * What is measured, per spoken turn, on the learner's own device: typical
 * pitch, how much the pitch moves, loudness, and seconds of speech. The
 * server adds speaking pace from the transcript. What is kept is a running
 * average and spread of each, a few numbers per learner. No audio and no
 * voiceprint: nothing here could pick a voice out of a crowd, and it is
 * never used to decide who is speaking.
 *
 * Learning: every usable turn in the first two sessions (and at least six
 * turns) shapes the picture evenly. After that the picture keeps adapting
 * slowly, so a gradual change, such as a voice breaking over months,
 * becomes the new normal without remark, while a sudden difference today
 * is noticed. A turn that sounded unlike them does not reshape the picture.
 *
 * What the tutor is told: only what is audibly different ("quieter and
 * slower than usual"), at most once a session, as a private note for that
 * one reply. Never an emotion, and the tutor is told to ask, not to guess.
 * Same line as face hints (see tutor/face.ts): describing what is plain to
 * hear is not inferring feelings, and school rosters are left out entirely.
 */

/** One spoken turn, as measured on the learner's device. */
export interface VoiceSample {
  /** Median pitch of the voiced moments, in Hz. Absent when it could not be read. */
  pitchHz?: number;
  /** How much the pitch moved, in semitones (the spread of the middle half). */
  rangeSt?: number;
  /** Mean loudness of the voiced moments, 0..1. */
  level: number;
  /** Seconds in which they were actually speaking. */
  voicedSec: number;
}

/** A running average and spread. `n` counts the turns it has seen. */
export interface Stat {
  n: number;
  mean: number;
  var: number;
}

export interface VoiceProfile {
  v: 1;
  /** Distinct sessions heard from, and the last one, to count them. */
  sessions: number;
  lastSession: string | null;
  /** Usable turns heard. */
  turns: number;
  /** Pitch in semitones above 100 Hz, so a change means the same at any pitch. */
  pitch: Stat | null;
  /** How much the pitch moves, on a relative scale (see measure). */
  range: Stat | null;
  level: Stat | null;
  /** Words per second of speech. */
  pace: Stat | null;
  /** The session in which the tutor was last told, so it is told once. */
  noticedIn: string | null;
}

export type Feature = "pitch" | "range" | "level" | "pace";

/** Two sessions and six turns: "the first two encounters". */
export const LEARN_SESSIONS = 2;
export const LEARN_TURNS = 6;
/** How fast the picture adapts once learned: about the last dozen turns. */
export const ADAPT = 0.08;
/** Too short to say anything about a voice. */
export const MIN_VOICED_SEC = 1.5;
/** The smallest spread we believe in, per feature: below this, a steady
 *  voice would make every tiny wobble look like a change. */
export const FLOOR: Record<Feature, number> = { pitch: 1.5, range: 0.35, level: 0.025, pace: 0.35 };
/** How far from usual counts as different, in spreads. */
export const MARKED = 2;
export const VERY_MARKED = 3;

export function emptyProfile(): VoiceProfile {
  return { v: 1, sessions: 0, lastSession: null, turns: 0, pitch: null, range: null, level: null, pace: null, noticedIn: null };
}

/** Accepts only a profile this code wrote; anything else starts afresh. */
export function readProfile(raw: unknown): VoiceProfile {
  const p = raw as Partial<VoiceProfile> | null;
  if (!p || p.v !== 1 || typeof p.turns !== "number" || typeof p.sessions !== "number") return emptyProfile();
  return { ...emptyProfile(), ...p } as VoiceProfile;
}

export function familiar(p: VoiceProfile): boolean {
  return p.sessions >= LEARN_SESSIONS && p.turns >= LEARN_TURNS;
}

const clean = (x: unknown, lo: number, hi: number): number | undefined =>
  typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi ? x : undefined;

/**
 * Reads the device's measurements from the x-voice-features header:
 * "pitch=212.5;range=3.1;level=0.142;voiced=3.4". Anything malformed or out
 * of a human range is dropped; without loudness and speech time there is no
 * sample at all.
 */
export function parseVoiceFeatures(header: unknown): VoiceSample | null {
  if (typeof header !== "string" || header.length > 200) return null;
  const kv: Record<string, number> = {};
  for (const part of header.split(";")) {
    const [k, v] = part.split("=");
    if (k && v !== undefined && v.trim() !== "") kv[k.trim()] = Number(v);
  }
  const level = clean(kv.level, 0, 1);
  const voicedSec = clean(kv.voiced, 0, 300);
  if (level === undefined || voicedSec === undefined) return null;
  return { level, voicedSec, pitchHz: clean(kv.pitch, 60, 700), rangeSt: clean(kv.range, 0, 24) };
}

const semitones = (hz: number) => 12 * Math.log2(hz / 100);

/** Speaking pace from the transcript: words per second of actual speech. */
export function paceOf(transcript: string, voicedSec: number): number | undefined {
  const words = transcript.trim().split(/\s+/).filter(Boolean).length;
  if (words < 3 || voicedSec < MIN_VOICED_SEC) return undefined;
  return clean(words / voicedSec, 0.3, 8);
}

/**
 * The turn's numbers on the profile's scales. Pitch movement is compared
 * relatively: going from one semitone of movement to a third of one is as
 * flat a change for a calm speaker as six to two is for a lively one.
 *
 * Loudness is kept, but browsers level a microphone's volume on their own
 * (automatic gain control), so in practice it rarely moves; pitch, its
 * movement and pace carry the comparison.
 */
export function measure(sample: VoiceSample, transcript: string): Partial<Record<Feature, number>> {
  return {
    level: sample.level,
    ...(sample.pitchHz !== undefined ? { pitch: semitones(sample.pitchHz) } : {}),
    ...(sample.rangeSt !== undefined ? { range: Math.log2(sample.rangeSt + 0.5) } : {}),
    ...(paceOf(transcript, sample.voicedSec) !== undefined ? { pace: paceOf(transcript, sample.voicedSec) } : {}),
  };
}

/** Evenly while learning, then slowly, so gradual change becomes the normal. */
export function learnStat(s: Stat | null, x: number, learning: boolean): Stat {
  if (!s) return { n: 1, mean: x, var: 0 };
  const n = s.n + 1;
  if (learning) {
    const mean = s.mean + (x - s.mean) / n;
    return { n, mean, var: s.var + ((x - s.mean) * (x - mean) - s.var) / n };
  }
  const d = x - s.mean;
  return { n, mean: s.mean + ADAPT * d, var: (1 - ADAPT) * (s.var + ADAPT * d * d) };
}

/** How many spreads from their usual; null until there is a usual. */
export function distance(s: Stat | null, x: number | undefined, f: Feature): number | null {
  if (!s || x === undefined || s.n < 4) return null;
  return (x - s.mean) / Math.max(Math.sqrt(s.var), FLOOR[f]);
}

const WORDS: Record<Feature, [lower: string, higher: string]> = {
  level: ["quieter", "louder"],
  pace: ["slower", "faster"],
  pitch: ["lower", "higher"],
  range: ["flatter", "more up and down"],
};

/** What is audibly different, in plain words, strongest first. */
export function differences(p: VoiceProfile, m: Partial<Record<Feature, number>>): { words: string[]; unusual: boolean } {
  const found: Array<{ f: Feature; z: number }> = [];
  for (const f of ["level", "pace", "pitch", "range"] as Feature[]) {
    const z = distance(p[f], m[f], f);
    if (z !== null && Math.abs(z) >= MARKED) found.push({ f, z });
  }
  found.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  // One thing a little off is an ordinary turn; two things, or one thing far
  // off, is a voice that does not sound like them today.
  const unusual = found.length >= 2 || found.some((d) => Math.abs(d.z) >= VERY_MARKED);
  return { words: found.map(({ f, z }) => WORDS[f][z < 0 ? 0 : 1]), unusual };
}

const joinWords = (w: string[]) => (w.length <= 1 ? w.join("") : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`);

export function voiceNote(words: string[]): string {
  return `[Private note, not from the student: you have heard them in enough lessons to know how they usually sound, and just now their voice was ${joinWords(words)} than it usually is. If it fits the moment, gently and briefly ask how they are doing, the way someone who knows them would, then carry on. Do not describe their voice, do not guess or name how they feel, and do not mention this note.]`;
}

export interface Heard {
  profile: VoiceProfile;
  /** The private note for this one reply, or null. */
  note: string | null;
  /** The tutor knows this voice, so the one-size quiet-voice nudge steps aside. */
  known: boolean;
}

/**
 * One spoken turn: compare it with their usual, then (unless it sounded
 * unlike them) let it shape the picture.
 */
export function hear(before: VoiceProfile, sample: VoiceSample | null, transcript: string, sessionId: string): Heard {
  const knownBefore = familiar(before);
  if (!sample || sample.voicedSec < MIN_VOICED_SEC) return { profile: before, note: null, known: knownBefore };

  const m = measure(sample, transcript);
  const diff = knownBefore ? differences(before, m) : { words: [], unusual: false };
  const note = diff.unusual && before.noticedIn !== sessionId ? voiceNote(diff.words) : null;

  const newSession = before.lastSession !== sessionId;
  let profile: VoiceProfile = {
    ...before,
    sessions: before.sessions + (newSession ? 1 : 0),
    lastSession: sessionId,
    noticedIn: note ? sessionId : before.noticedIn,
  };
  if (!diff.unusual) {
    const learning = !knownBefore;
    profile = {
      ...profile,
      turns: before.turns + 1,
      level: m.level !== undefined ? learnStat(before.level, m.level, learning) : before.level,
      pitch: m.pitch !== undefined ? learnStat(before.pitch, m.pitch, learning) : before.pitch,
      range: m.range !== undefined ? learnStat(before.range, m.range, learning) : before.range,
      pace: m.pace !== undefined ? learnStat(before.pace, m.pace, learning) : before.pace,
    };
  }
  return { profile, note, known: knownBefore };
}

/** Where the account holder can see it: learning, or knows how they sound. */
export function familiarityStatus(p: VoiceProfile): { stage: "listening" | "knows"; sessionsHeard: number } {
  return { stage: familiar(p) ? "knows" : "listening", sessionsHeard: Math.min(p.sessions, LEARN_SESSIONS) };
}

/** Same line as face hints: a family's own choice, never a school's. */
export function voiceFamiliarityAllowed(opts: {
  enabledByAccountHolder: boolean;
  signedIn: boolean;
  onSchoolRoster: boolean;
  viaApiKey: boolean;
}): boolean {
  return opts.enabledByAccountHolder && opts.signedIn && !opts.onSchoolRoster && !opts.viaApiKey;
}
