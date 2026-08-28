/**
 * Persistence behind the API. Same philosophy as the AI gateway: the server
 * talks to this interface only. `memory` runs anywhere with zero setup;
 * `postgres` is production. Selected by DATABASE_URL presence.
 */
/** What a session needs to be picked back up by any process. */
export interface SessionMeta {
  studentId: string;
  personaId: string;
  packId: string;
  language: string;
  plan: string;
  ownerUserId?: string;
  parentEmail?: string;
  apiKeyId?: string;
}

export interface SessionRecap {
  summary: string;
  nextFocus: string;
}

/**
 * The Dingba Brain: the distilled "who am I teaching". Short capped lists,
 * merged after every session — never transcripts.
 */
export interface LearnerProfile {
  goals: string[];
  strengths: string[];
  strugglingWith: string[];
  interests: string[];
  preferences: string[];
}

export const EMPTY_PROFILE: LearnerProfile = {
  goals: [],
  strengths: [],
  strugglingWith: [],
  interests: [],
  preferences: [],
};

/**
 * Adaptive engine v1: an SM-2-family scheduler (not full FSRS yet — the
 * fields are ready for it). Correct recall stretches the interval, and
 * stretches it further the stronger the mastery; a miss resets the skill
 * to due-now so it resurfaces in the next session's warm-up.
 */
export interface MasteryState {
  level: number; // 0..1 estimated mastery (EMA)
  attempts: number;
  correct: number;
  stabilityDays: number;
  dueAt: Date;
}

const MAX_STABILITY_DAYS = 120;
const DAY_MS = 86_400_000;

export function scheduleAttempt(cur: MasteryState | null, isCorrect: boolean, now = new Date()): MasteryState {
  const level = 0.7 * (cur?.level ?? 0) + 0.3 * (isCorrect ? 1 : 0);
  if (!isCorrect) {
    // Missed: back to the front of the queue.
    return {
      level,
      attempts: (cur?.attempts ?? 0) + 1,
      correct: cur?.correct ?? 0,
      stabilityDays: 1,
      dueAt: now,
    };
  }
  const growth = 1.6 + level; // stronger mastery earns longer gaps (1.6x..2.6x)
  const stabilityDays = cur ? Math.min(MAX_STABILITY_DAYS, cur.stabilityDays * growth) : 2;
  return {
    level,
    attempts: (cur?.attempts ?? 0) + 1,
    correct: (cur?.correct ?? 0) + 1,
    stabilityDays,
    dueAt: new Date(now.getTime() + stabilityDays * DAY_MS),
  };
}

export type MasteryStage =
  | "introduced"
  | "developing"
  | "practising"
  | "proficient"
  | "mastered"
  | "needs reinforcement";

/** The vision's mastery ladder, computed from state — never stored. */
export function masteryStage(s: { level: number; attempts: number; dueAt?: Date | null }, now = new Date()): MasteryStage {
  const overdue = s.dueAt != null && s.dueAt.getTime() <= now.getTime();
  if (s.level >= 0.7 && overdue) return "needs reinforcement";
  if (s.level >= 0.85 && s.attempts >= 4) return "mastered";
  if (s.level >= 0.7) return "proficient";
  if (s.level >= 0.45) return "practising";
  if (s.level >= 0.2) return "developing";
  return "introduced";
}

/**
 * A student's real-world learning routine, parsed from an uploaded
 * timetable/curriculum (image or text). Structure is best-effort from the
 * model; `notes` always carries the raw transcription so nothing is lost
 * when the model can't produce clean structure.
 */
export interface LearnerRoutine {
  subjects: string[];
  weekly: Array<{ day: string; blocks: Array<{ time?: string; subject: string }> }>;
  examDates: Array<{ date: string; label: string }>;
  notes: string;
}

/** One trusted person, named in advance, offered when distress is detected. */
export interface CareContact {
  name: string;
  phone: string;
  relationship?: string;
}

const PROFILE_LIST_CAP = 8;
const PROFILE_ITEM_MAX_LEN = 160;

/**
 * Merge new observations into a profile: newest wins, case-insensitive
 * dedupe, each list capped (oldest dropped). Pure — both stores share it.
 */
export function mergeProfile(
  current: LearnerProfile | null,
  patch: Partial<LearnerProfile>,
): LearnerProfile {
  const base = current ?? EMPTY_PROFILE;
  const out = { ...EMPTY_PROFILE };
  for (const key of Object.keys(EMPTY_PROFILE) as Array<keyof LearnerProfile>) {
    const additions = (patch[key] ?? [])
      .map((s) => String(s).trim())
      .filter((s) => s.length > 0 && s.length <= PROFILE_ITEM_MAX_LEN);
    const merged = [...(base[key] ?? [])];
    for (const item of additions) {
      const i = merged.findIndex((m) => m.toLowerCase() === item.toLowerCase());
      if (i >= 0) merged.splice(i, 1); // re-mention refreshes recency
      merged.push(item);
    }
    out[key] = merged.slice(-PROFILE_LIST_CAP);
  }
  return out;
}

export interface Store {
  readonly kind: string;

  /** Find-or-create a student by display name (auth comes later). */
  ensureStudent(name: string, parentEmail?: string): Promise<{ id: string }>;

  createSession(meta: SessionMeta): Promise<string>;
  /** Everything needed to rehydrate a live session on a fresh process. */
  getSessionMeta(sessionId: string): Promise<(SessionMeta & { endedAt: Date | null }) | null>;
  /** The session's saved turns, oldest first, for rebuilding history. */
  listSessionMessages(sessionId: string): Promise<Array<{ role: "user" | "assistant"; content: string }>>;
  saveMessage(sessionId: string, role: "user" | "assistant", content: string): Promise<void>;
  endSession(sessionId: string, recap: SessionRecap): Promise<void>;

  /** Compressed learner model — short lines injected into the system prompt. */
  getMemories(studentId: string): Promise<string[]>;
  addMemory(studentId: string, kind: "academic" | "personal" | "goal", content: string): Promise<void>;

  /** The Dingba Brain: structured learning profile, merged after sessions. */
  getProfile(studentId: string): Promise<LearnerProfile | null>;
  updateProfile(studentId: string, patch: Partial<LearnerProfile>): Promise<void>;

  /** Uploaded timetable/curriculum, parsed. A new upload replaces the old. */
  getRoutine(studentId: string): Promise<LearnerRoutine | null>;
  saveRoutine(studentId: string, routine: LearnerRoutine): Promise<void>;

  /** The trusted person offered on a one-tap call when distress is detected. */
  getCareContact(studentId: string): Promise<CareContact | null>;
  saveCareContact(studentId: string, contact: CareContact): Promise<void>;
  deleteCareContact(studentId: string): Promise<void>;

  /** Mastery bookkeeping for spaced repetition & adaptive difficulty. */
  recordAttempt(studentId: string, skillId: string, correct: boolean): Promise<void>;
  getMasterySnapshot(
    studentId: string,
  ): Promise<Array<{ skillId: string; level: number; attempts: number; dueAt: Date | null }>>;
  /** Skills due (or overdue) for spaced review, most overdue first. */
  getDueSkills(
    studentId: string,
    limit: number,
  ): Promise<Array<{ skillId: string; level: number; dueAt: Date }>>;

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

  // ---- Trust & retention (blind-spot sprint) ----

  savePushSubscription(userId: string, sub: { endpoint: string; p256dh: string; auth: string }): Promise<void>;
  listPushSubscriptions(userId: string): Promise<Array<{ endpoint: string; p256dh: string; auth: string }>>;
  /** Every real account, for the weekly digest run. Generated learner
   *  bookkeeping accounts are not included. */
  listAccounts(): Promise<Array<{ userId: string; email: string }>>;

  /** Every device on the platform that asked for reminders, with its owner. */
  listAllPushSubscriptions(): Promise<Array<{ userId: string; endpoint: string; p256dh: string; auth: string }>>;
  deletePushSubscription(endpoint: string): Promise<void>;

  /** Store sha256(raw); raw goes to the user by email. 1h validity, single use. */
  createPasswordReset(userId: string, tokenHash: string): Promise<void>;
  consumePasswordReset(tokenHash: string, maxAgeMs: number): Promise<string | null>;
  setPassword(userId: string, passwordHash: string): Promise<void>;
  revokeUserTokens(userId: string): Promise<void>;

  /** GDPR/COPPA erasure: the account and every trace of its students. */
  deleteAccount(userId: string): Promise<void>;

  /** Recent conversation lines for the guardian transcript view. */
  listRecentMessages(
    studentId: string,
    limit: number,
  ): Promise<Array<{ role: string; content: string; createdAt: Date }>>;

  /** Consecutive days (ending today or yesterday) with at least one session. */
  getStreakDays(studentId: string): Promise<number>;

  // ---- Billing & email verification (Sprint 6b) ----

  /** Same sha256/single-use pattern as password resets, 24h validity. */
  createEmailVerification(userId: string, tokenHash: string): Promise<void>;
  consumeEmailVerification(tokenHash: string, maxAgeMs: number): Promise<string | null>;
  markEmailVerified(userId: string): Promise<void>;
  isEmailVerified(userId: string): Promise<boolean>;

  /** Upsert by (provider, subscriptionRef); webhooks are retried, so idempotent. */
  recordSubscription(sub: {
    userId: string;
    provider: string;
    customerRef: string;
    subscriptionRef: string;
    plan: string;
    status: "active" | "canceled";
  }): Promise<void>;
  /** Latest subscription for the account page. */
  getSubscription(
    userId: string,
  ): Promise<{ provider: string; plan: string; status: string; subscriptionRef: string } | null>;
  /** Cancellation events carry only provider refs — map them back to the user. */
  findSubscriptionByRef(
    provider: string,
    ref: { customerRef?: string; subscriptionRef?: string },
  ): Promise<{ userId: string; email: string } | null>;

  // ---- Command Centre ----

  /** Staff roster, investors included. */
  listStaff(): Promise<StaffMember[]>;
  getStaff(userId: string): Promise<StaffMember | null>;
  upsertStaff(member: {
    userId: string;
    role: string;
    title?: string;
    status?: "active" | "suspended";
    invitedBy?: string;
  }): Promise<void>;
  removeStaff(userId: string): Promise<boolean>;
  /** Writes the employment half of a record. Only the keys given are touched. */
  updateStaffHr(userId: string, hr: StaffHr): Promise<boolean>;
  touchStaffSeen(userId: string): Promise<void>;

  /** Append-only audit trail. */
  recordAudit(entry: AuditEntry): Promise<void>;
  listAudit(limit: number, opts?: { action?: string }): Promise<AuditRow[]>;

  /**
   * Every safety flag across the platform, newest first. Names the learner and
   * the account behind them, so it is gated on safety:read and nothing less.
   */
  listPlatformIncidents(
    limit: number,
    opts?: { severity?: "concern" | "danger" },
  ): Promise<PlatformIncident[]>;
  /** Flags raised since a moment, split by severity. For the desk's headline. */
  countIncidentsSince(since: Date): Promise<{ concern: number; danger: number }>;

  /**
   * The money ledger. record returns false when the event was already seen
   * (processors retry webhooks), so the caller can skip re-applying it.
   */
  recordBillingEvent(event: BillingEventRecord): Promise<boolean>;
  listBillingEvents(limit: number, opts?: { type?: string }): Promise<BillingEventRow[]>;
  /** Failures and refunds since a moment, for the Money tab's warning tiles. */
  countBillingTroubleSince(since: Date): Promise<{ failed: number; refunded: number }>;

  /** Operational switches, flipped from the Command Centre without a deploy. */
  getSetting(key: string): Promise<unknown | null>;
  setSetting(key: string, value: unknown, updatedBy: string): Promise<void>;

  /** Aggregate metrics for the Command Centre. No PII. */
  platformMetrics(days: number): Promise<PlatformMetrics>;

  /** One account by id, for the support view. Returns PII, so it is gated. */
  getAccountById(userId: string): Promise<{
    userId: string;
    email: string;
    displayName: string | null;
    role: string;
    plan: string;
    createdAt: Date;
  } | null>;

  /** Recent subscriptions, newest first. Names payers, so finance:detail only. */
  listSubscriptions(limit: number): Promise<Array<{
    userId: string;
    email: string;
    provider: string;
    plan: string;
    status: string;
    subscriptionRef: string;
    updatedAt: Date;
  }>>;

  /** Account search for support. Returns PII, so it is capability-gated. */
  searchAccounts(query: string, limit: number): Promise<Array<{
    userId: string;
    email: string;
    displayName: string | null;
    role: string;
    plan: string;
    students: number;
    createdAt: Date;
  }>>;

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

/** A Command Centre staff member (investors included, on their own role). */
export interface StaffMember {
  userId: string;
  email: string;
  displayName: string | null;
  role: string;
  title: string | null;
  status: "active" | "suspended";
  createdAt: Date;
  lastSeenAt: Date | null;
  /** The employment record. Null throughout until someone fills it in. */
  fullName: string | null;
  employmentType: EmploymentType | null;
  startDate: string | null;
  endDate: string | null;
  managerUserId: string | null;
  location: string | null;
  notes: string | null;
}

export const EMPLOYMENT_TYPES = ["employee", "contractor", "advisor", "investor"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

/** The employment half of a staff record, all of it optional. */
export interface StaffHr {
  fullName?: string | null;
  employmentType?: EmploymentType | null;
  startDate?: string | null;
  endDate?: string | null;
  managerUserId?: string | null;
  location?: string | null;
  notes?: string | null;
}

export interface AuditEntry {
  actorUserId: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  target?: string;
  meta: Record<string, unknown>;
  ip?: string;
}

export interface AuditRow extends AuditEntry {
  id: string;
  createdAt: Date;
}

/** One verified processor webhook, as recorded. */
export interface BillingEventRecord {
  provider: string;
  eventRef: string;
  type: "activated" | "canceled" | "payment_failed" | "refunded";
  email?: string;
  customerRef?: string;
  subscriptionRef?: string;
  plan?: string;
  amountMinor?: number;
  currency?: string;
  matched: boolean;
}

export interface BillingEventRow extends BillingEventRecord {
  id: string;
  createdAt: Date;
}

/** A safety flag with enough context to act on it. Contains PII by design. */
export interface PlatformIncident {
  id: string;
  studentId: string;
  studentName: string;
  /** The account that owns this learner, for reaching a guardian. */
  guardianEmail: string | null;
  direction: string;
  categories: string[];
  severity: string;
  excerpt: string;
  createdAt: Date;
}

/** Aggregate platform metrics. Contains no personally identifying data. */
export interface PlatformMetrics {
  learners: number;
  guardians: number;
  sessions: number;
  sessionsToday: number;
  activeToday: number;
  activeThisWeek: number;
  activeThisMonth: number;
  messages: number;
  voiceTurns: number;
  practiceAttempts: number;
  safetyIncidents: number;
  safetyDanger: number;
  paidSubscriptions: number;
  planMix: Array<{ plan: string; count: number }>;
  /** Daily counts, oldest first, for the trend charts. */
  sessionsSeries: Array<{ day: string; count: number }>;
  signupsSeries: Array<{ day: string; count: number }>;
}

export type UsageKind = "message" | "voice_turn" | "tts_chars" | "practice" | "exam" | "api_call" | "camera_solve";
