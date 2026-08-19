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

  // ---- Accounts & auth (Sprint 4) ----

  /**
   * Create an account. role "parent" gets an empty family to add students to;
   * role "student" (adult self-learner) also gets their own student profile.
   * Returns null if the email is already registered.
   */
  createAccount(
    email: string,
    passwordHash: string,
    role: "parent" | "student",
    displayName: string,
  ): Promise<{ userId: string; studentId?: string } | null>;
  getAccountByEmail(
    email: string,
  ): Promise<{ userId: string; passwordHash: string | null; role: string } | null>;

  /** Store sha256(rawToken) → user. Raw token never touches the database. */
  saveToken(tokenHash: string, userId: string): Promise<void>;
  resolveToken(
    tokenHash: string,
  ): Promise<{ userId: string; email: string; role: string } | null>;

  addStudentProfile(parentUserId: string, displayName: string): Promise<{ id: string }>;
  /** Profiles this account may act for: own profile plus children. */
  listStudentProfiles(userId: string): Promise<Array<{ id: string; displayName: string }>>;
  ownsStudent(userId: string, studentId: string): Promise<boolean>;
  getStudentName(studentId: string): Promise<string | null>;
  listSessionSummaries(
    studentId: string,
    limit: number,
  ): Promise<Array<{ startedAt: Date; endedAt: Date | null; summary: string | null }>>;
}
