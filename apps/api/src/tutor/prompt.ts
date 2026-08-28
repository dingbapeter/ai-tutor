import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

export interface Persona {
  id: string;
  name: string;
  style: string;
  voiceId: string;
  /** Which slot this tutor fills in a language's voice set. */
  voiceProfile?: string;
  systemStyle: string;
  color?: string;
  accent?: string;
}

export interface CurriculumProblem {
  skillId?: string;
  prompt: string;
  answer?: string;
  check: Record<string, unknown>;
  timeLimitSec?: number;
  misconceptions?: Array<{ answer: string; diagnosis: string }>;
}

export interface CurriculumPack {
  id: string;
  title: string;
  vertical: string;
  description: string;
  skills: Array<{ id: string; title: string; prerequisites: string[] }>;
  problems: CurriculumProblem[];
}

let personaCache: Persona[] | null = null;
export function loadPersonas(): Persona[] {
  personaCache ??= (JSON.parse(readFileSync(join(ROOT, "config/personas.json"), "utf8")) as { personas: Persona[] }).personas;
  return personaCache;
}

export interface Language {
  code: string;
  name: string;
  native: string;
  engine: string;
  /** voiceProfile -> engine voice id. null means no spoken voice yet. */
  voices: Record<string, string> | null;
}

let languageCache: { fallback: string; list: Language[] } | null = null;
function languages(): { fallback: string; list: Language[] } {
  if (!languageCache) {
    const raw = JSON.parse(readFileSync(join(ROOT, "config/languages.json"), "utf8")) as {
      fallbackVoiceLanguage: string;
      languages: Language[];
    };
    languageCache = { fallback: raw.fallbackVoiceLanguage, list: raw.languages };
  }
  return languageCache;
}

export function loadLanguages(): Language[] {
  return languages().list;
}

export function findLanguage(code: string): Language | undefined {
  return languages().list.find((l) => l.code === code);
}

/**
 * The voice a persona speaks in for a given language. Falls back to the
 * persona's own default when the language has no voices installed yet, so a
 * learner always hears something rather than silence.
 */
export function voiceFor(persona: Persona, languageCode?: string): string {
  const profile = persona.voiceProfile;
  if (languageCode && profile) {
    const lang = findLanguage(languageCode);
    const voice = lang?.voices?.[profile];
    if (voice) return voice;
  }
  return persona.voiceId;
}

/** True when this language can be spoken aloud today. */
export function hasVoice(languageCode?: string): boolean {
  if (!languageCode) return true;
  return Boolean(findLanguage(languageCode)?.voices);
}

/** The only packs that exist. Everything else is a client error, never a crash. */
export const PACK_IDS = ["math-ms", "exam-prep", "language", "visa-prep", "pro-finance", "career-coach"] as const;

export class UnknownPackError extends Error {
  constructor(packId: string) {
    super(`unknown pack: ${packId}`);
  }
}

const packCache = new Map<string, CurriculumPack>();
export function loadPack(packId: string): CurriculumPack {
  if (!(PACK_IDS as readonly string[]).includes(packId)) throw new UnknownPackError(packId);
  let pack = packCache.get(packId);
  if (!pack) {
    pack = JSON.parse(readFileSync(join(ROOT, "curriculum", packId, "pack.json"), "utf8")) as CurriculumPack;
    packCache.set(packId, pack);
  }
  return pack;
}

let skillTitleCache: Map<string, string> | null = null;
/** Title for a skill id, looked up across every pack. */
export function skillTitle(skillId: string): string {
  if (!skillTitleCache) {
    skillTitleCache = new Map();
    for (const packId of PACK_IDS) {
      for (const s of loadPack(packId).skills) skillTitleCache.set(s.id, s.title);
    }
  }
  const known = skillTitleCache.get(skillId);
  if (known) return known;
  // An id the packs don't know still has to read as words, never as
  // "math-ms.integers.add-sub" in front of a learner: drop the pack prefix,
  // break the segments apart, and capitalize.
  const words = skillId.split(".").slice(1).join(" ").replace(/-/g, " ").trim() || skillId;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The Socratic contract lives here, layered under the persona's voice.
 * Memory lines come from the memories table — the compressed learner model,
 * never full transcripts.
 */
export interface ProfileForPrompt {
  goals: string[];
  strengths: string[];
  strugglingWith: string[];
  interests: string[];
  preferences: string[];
}

/** The Dingba Brain, rendered for the tutor. Empty lists say nothing. */
function profileBlock(studentName: string, p: ProfileForPrompt | null): string {
  if (!p) return "";
  const lines: string[] = [];
  if (p.goals.length) lines.push(`Their goals: ${p.goals.join("; ")}.`);
  if (p.strengths.length) lines.push(`Going well: ${p.strengths.join("; ")}.`);
  if (p.strugglingWith.length) lines.push(`Currently finding hard: ${p.strugglingWith.join("; ")}.`);
  if (p.interests.length) lines.push(`Interests (use these for analogies and examples): ${p.interests.join("; ")}.`);
  if (p.preferences.length) lines.push(`How they like to learn: ${p.preferences.join("; ")}.`);
  if (!lines.length) return "";
  return `\n${studentName}'s learning profile (you built this over your sessions together — act on it, don't recite it):\n${lines.map((l) => `- ${l}`).join("\n")}\n`;
}

export interface RoutineForPrompt {
  subjects: string[];
  weekly: Array<{ day: string; blocks: Array<{ time?: string; subject: string }> }>;
  examDates: Array<{ date: string; label: string }>;
  notes: string;
}

/** The learner's real-world routine, condensed for the tutor. */
function routineBlock(r: RoutineForPrompt | null): string {
  if (!r) return "";
  const lines: string[] = [];
  if (r.subjects.length) lines.push(`Subjects on their timetable: ${r.subjects.slice(0, 12).join(", ")}.`);
  if (r.weekly.length) {
    const days = r.weekly
      .slice(0, 7)
      .map((d) => `${d.day}: ${d.blocks.slice(0, 6).map((b) => (b.time ? `${b.subject} at ${b.time}` : b.subject)).join(", ")}`)
      .join("; ");
    lines.push(`Weekly schedule: ${days}.`);
  }
  if (r.examDates.length) {
    lines.push(`Upcoming exams: ${r.examDates.slice(0, 6).map((e) => `${e.label} on ${e.date}`).join("; ")}.`);
  }
  if (!lines.length && r.notes) lines.push(`From their uploaded timetable: ${r.notes.slice(0, 300)}`);
  if (!lines.length) return "";
  return `\nTheir real-world learning routine (from a timetable they uploaded — plan around it, mention it when relevant):\n${lines.map((l) => `- ${l}`).join("\n")}\n`;
}

/** Teach in the learner's language, in their own words. */
function languageBlock(code?: string): string {
  if (!code || code === "en") return "";
  const lang = findLanguage(code);
  if (!lang) return "";
  return (
    `\nLANGUAGE: teach entirely in ${lang.name} (${lang.native}). Every explanation, question, and encouragement goes in ${lang.name}. ` +
    `Keep technical terms in the language the student's exam or textbook uses, and say them in ${lang.name} too the first time. ` +
    `If the student writes to you in another language, answer in the language they used.\n`
  );
}

/** Spaced-review warm-up: due skills the tutor should touch before new material. */
function warmupBlock(skillTitles: string[]): string {
  if (!skillTitles.length) return "";
  return (
    `\nSpaced review: these skills are due for a quick warm-up because memory fades on a schedule: ${skillTitles.join("; ")}. ` +
    `Early in the session, ask ONE short recall question for each (under a minute apiece), celebrate what stuck, note what didn't, then move to today's topic. Weave it in naturally; never call it a test.\n`
  );
}

export function buildSystemPrompt(opts: {
  persona: Persona;
  pack: CurriculumPack;
  studentName: string;
  memoryLines: string[];
  profile?: ProfileForPrompt | null;
  warmupSkills?: string[];
  routine?: RoutineForPrompt | null;
  language?: string;
}): string {
  const { persona, pack, studentName, memoryLines } = opts;
  return [
    persona.systemStyle,
    ``,
    `You are ${studentName}'s personal tutor for "${pack.title}". This is a live one-on-one session.`,
    ``,
    `Teaching rules (non-negotiable):`,
    `1. Socratic first: never hand over an answer the student could reach with one good question. Ask that question instead.`,
    `2. One step at a time. Short turns — this is a conversation, not a lecture.`,
    `3. Wrong answers are diagnostic: name the specific misconception before correcting it.`,
    `4. If the student says "just show me", walk through the full solution clearly — then immediately pose a similar problem for them to try.`,
    `5. Never invent facts or formulas you are unsure of; say you'll double-check rather than guess.`,
    `6. Keep the student safe: no personal-contact requests, no off-platform links, age-appropriate language always. Refuse to teach anything whose purpose is causing harm (weapons, explosives, dangerous synthesis), whatever the learner's age.`,
    `7. Sound like a person, not an app: contractions, short sentences, plain punctuation (no em dashes), no canned assistant phrases like "Certainly!" or "I'd be happy to". Warmth over polish.`,
    `8. Notice the person, not just the answer. Watch for someone who sounds off: answers getting shorter or flatter than usual, "I don't know" repeating, self-criticism ("I'm so stupid", "I'm rubbish at this"), giving up early, long silences, irritation, or a mood that doesn't match the work. When you notice it, STOP teaching for a moment. Ask one real, gentle question about them, not the topic ("You sound a bit flat today, is everything alright?" / "That's the third quick answer in a row, want to tell me what's going on?"). Then LISTEN: let their answer steer what happens next. If they're tired, shorten the session or switch to something lighter. If something happened at school or home, acknowledge it plainly before any teaching. If they're frustrated with the work, name that it's hard and drop the difficulty. Never lecture them about their feelings, never fake a diagnosis, and never brush past it to get back to the lesson. One caring question, honestly asked, is worth more than a perfect explanation.`,
    ``,
    languageBlock(opts.language),
    profileBlock(studentName, opts.profile ?? null),
    routineBlock(opts.routine ?? null),
    warmupBlock(opts.warmupSkills ?? []),
    memoryLines.length
      ? `What you remember about ${studentName}:\n${memoryLines.map((l) => `- ${l}`).join("\n")}`
      : `This is your FIRST session with ${studentName}. Two jobs before teaching anything: (1) one warm sentence to get to know them and what they want to work on; (2) a quick placement check — ask 2-3 short diagnostic questions of increasing difficulty in the subject, one at a time, to find their level. React encouragingly whatever they answer, then start teaching from where they actually are, not where the curriculum assumes.`,
  ].join("\n");
}
