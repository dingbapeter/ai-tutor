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

  // ---- Safety (Sprint 5) ----

  recordIncident(incident: {
    studentId: string;
    sessionId?: string;
    direction: "student" | "tutor";
    categories: string[];
    severity: "concern" | "danger";
    excerpt: string;
  }): Promise<void>;
  listIncidents(
    studentId: string,
    limit: number,
  ): Promise<
    Array<{ direction: string; categories: string[]; severity: string; excerpt: string; createdAt: Date }>
  >;

  // ---- Business wiring (Sprint 6a) ----

  /** Metering: attribute a billable action to whoever should pay for it. */
  recordUsage(event: {
    userId?: string;
    studentId?: string;
    apiKeyId?: string;
    kind: UsageKind;
    quantity?: number;
  }): Promise<void>;
  /** Sum of a kind since `since`, keyed by user OR student OR api key. */
  sumUsage(
    subject: { userId?: string; studentId?: string; apiKeyId?: string },
    kind: UsageKind | null,
    since: Date,
  ): Promise<number>;

  getUserPlan(userId: string): Promise<string>;
  setUserPlan(email: string, plan: string): Promise<boolean>;

  createOrg(ownerUserId: string, name: string, seats: number): Promise<{ id: string }>;
  getOrgByOwner(ownerUserId: string): Promise<{ id: string; name: string; seats: number; plan: string } | null>;
  addOrgStudents(orgId: string, ownerUserId: string, names: string[]): Promise<Array<{ id: string; displayName: string }>>;
  listOrgStudents(orgId: string): Promise<Array<{ id: string; displayName: string }>>;
  countOrgStudents(orgId: string): Promise<number>;

  createApiKey(
    ownerUserId: string,
    name: string,
    keyHash: string,
    scopes: string[],
    monthlyQuota?: number,
  ): Promise<{ id: string }>;
  resolveApiKey(
    keyHash: string,
  ): Promise<{ id: string; ownerUserId: string; scopes: string[]; monthlyQuota: number } | null>;
  listApiKeys(
    ownerUserId: string,
  ): Promise<Array<{ id: string; name: string; scopes: string[]; monthlyQuota: number; revoked: boolean }>>;
  revokeApiKey(ownerUserId: string, keyId: string): Promise<boolean>;
}

export type UsageKind = "message" | "voice_turn" | "tts_chars" | "practice" | "exam" | "api_call";
