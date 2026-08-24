import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

export interface Persona {
  id: string;
  name: string;
  style: string;
  voiceId: string;
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

/**
 * The Socratic contract lives here, layered under the persona's voice.
 * Memory lines come from the memories table — the compressed learner model,
 * never full transcripts.
 */
export function buildSystemPrompt(opts: {
  persona: Persona;
  pack: CurriculumPack;
  studentName: string;
  memoryLines: string[];
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
    ``,
    memoryLines.length
      ? `What you remember about ${studentName}:\n${memoryLines.map((l) => `- ${l}`).join("\n")}`
      : `This is your FIRST session with ${studentName}. Two jobs before teaching anything: (1) one warm sentence to get to know them and what they want to work on; (2) a quick placement check — ask 2-3 short diagnostic questions of increasing difficulty in the subject, one at a time, to find their level. React encouragingly whatever they answer, then start teaching from where they actually are, not where the curriculum assumes.`,
  ].join("\n");
}
