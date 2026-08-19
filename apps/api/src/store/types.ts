/**
 * Persistence behind the API. Same philosophy as the AI gateway: the server
 * talks to this interface only. `memory` runs anywhere with zero setup;
 * `postgres` is production. Selected by DATABASE_URL presence.
 */
export interface SessionRecap {
  summary: string;
  nextFocus: string;
}

export interface Store {
  readonly kind: string;

  /** Find-or-create a student by display name (auth comes later). */
  ensureStudent(name: string, parentEmail?: string): Promise<{ id: string }>;

  createSession(studentId: string, personaId: string, packId: string): Promise<string>;
  saveMessage(sessionId: string, role: "user" | "assistant", content: string): Promise<void>;
  endSession(sessionId: string, recap: SessionRecap): Promise<void>;

  /** Compressed learner model — short lines injected into the system prompt. */
  getMemories(studentId: string): Promise<string[]>;
  addMemory(studentId: string, kind: "academic" | "personal" | "goal", content: string): Promise<void>;

  /** Mastery bookkeeping for spaced repetition & adaptive difficulty. */
  recordAttempt(studentId: string, skillId: string, correct: boolean): Promise<void>;
  getMasterySnapshot(studentId: string): Promise<Array<{ skillId: string; level: number }>>;
}
