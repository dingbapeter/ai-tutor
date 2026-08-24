import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  real,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";

/** Accounts. A parent account may own several student profiles (family plan). */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["student", "parent", "teacher", "admin"] }).notNull().default("student"),
  /** bcrypt hash; null for auto-created guest/placeholder users. */
  passwordHash: text("password_hash"),
  displayName: text("display_name"),
  /** Entitlement plan (see config/plans.json). Billing sets this later. */
  plan: text("plan").notNull().default("free"),
  orgId: uuid("org_id"),
  emailVerified: boolean("email_verified").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Institutions: a school/company owning seats and a roster of students. */
export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id),
  seats: integer("seats").notNull().default(30),
  plan: text("plan").notNull().default("premium"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Scoped, quota'd keys for the B2B API (Tutor-as-a-Service etc.). */
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  keyHash: text("key_hash").notNull().unique(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  monthlyQuota: integer("monthly_quota").notNull().default(10_000),
  revoked: boolean("revoked").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at"),
});

/** Web-push subscriptions: one row per device that granted permission. */
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Password-reset tokens (sha256-stored, 1-hour validity, single-use). */
export const passwordResets = pgTable("password_resets", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Email-verification tokens (same sha256/single-use pattern, 24h validity). */
export const emailVerifications = pgTable("email_verifications", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Billing subscriptions (Sprint 6b). One row per provider subscription;
 * webhooks upsert here and flip users.plan. customer/subscription refs let
 * cancellation events (which carry no email) find their way back to the user.
 */
export const billingSubscriptions = pgTable("billing_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  provider: text("provider", { enum: ["stripe", "paystack", "mock"] }).notNull(),
  customerRef: text("customer_ref").notNull(),
  subscriptionRef: text("subscription_ref").notNull(),
  plan: text("plan").notNull(),
  status: text("status", { enum: ["active", "canceled"] }).notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Metering: every billable action, attributable to a user/student/API key. */
export const usageEvents = pgTable("usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  studentId: uuid("student_id"),
  apiKeyId: uuid("api_key_id"),
  kind: text("kind", {
    enum: ["message", "voice_turn", "tts_chars", "practice", "exam", "api_call", "camera_solve"],
  }).notNull(),
  quantity: integer("quantity").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Opaque API tokens, stored as sha256 so a DB leak doesn't leak sessions. */
export const authTokens = pgTable("auth_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at").notNull().defaultNow(),
});

export const students = pgTable("students", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  parentUserId: uuid("parent_user_id").references(() => users.id),
  displayName: text("display_name").notNull(),
  birthYear: integer("birth_year"),
  locale: text("locale").notNull().default("en"),
  /** Chosen tutor persona (see config/personas.json). Persistent — same tutor every session. */
  personaId: text("persona_id").notNull().default("amara"),
  /** Set when the student belongs to a school/org roster. */
  orgId: uuid("org_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Knowledge graph nodes, loaded from curriculum packs. `prerequisites` holds
 * skill ids that must be mastered first — how the tutor walks back to the
 * shaky fraction skill underneath an algebra failure.
 */
export const skills = pgTable("skills", {
  id: text("id").primaryKey(), // e.g. "math-ms.linear-eq.one-step"
  packId: text("pack_id").notNull(), // e.g. "math-ms"
  title: text("title").notNull(),
  description: text("description"),
  prerequisites: jsonb("prerequisites").$type<string[]>().notNull().default([]),
});

/** Per-student mastery state per skill; FSRS-style scheduling fields. */
export const mastery = pgTable("mastery", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id").notNull().references(() => students.id),
  skillId: text("skill_id").notNull().references(() => skills.id),
  /** 0..1 estimated mastery. */
  level: real("level").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  correct: integer("correct").notNull().default(0),
  /** Spaced-repetition state: when this skill should resurface in warm-up. */
  dueAt: timestamp("due_at"),
  stabilityDays: real("stability_days").notNull().default(1),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id").notNull().references(() => students.id),
  packId: text("pack_id").notNull(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
  /** Auto-generated after the session: recap, mistakes, plan for next time. */
  recap: jsonb("recap").$type<{
    summary: string;
    struggles: string[];
    wins: string[];
    nextFocusSkillIds: string[];
  }>(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => sessions.id),
  role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
  content: text("content").notNull(),
  /** Set when the turn came from voice; links to stored audio object. */
  audioKey: text("audio_key"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Safety incidents: every flagged message, reviewable by guardians.
 * `danger` severity also triggers an immediate guardian email.
 */
export const safetyIncidents = pgTable("safety_incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id").notNull().references(() => students.id),
  sessionId: uuid("session_id"),
  direction: text("direction", { enum: ["student", "tutor"] }).notNull(),
  categories: jsonb("categories").$type<string[]>().notNull().default([]),
  severity: text("severity", { enum: ["concern", "danger"] }).notNull(),
  excerpt: text("excerpt").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Compressed long-term memory: rolling facts the tutor should always know
 * ("struggles with negative signs", "has a dog called Biscuit", "SAT on Dec 6").
 * Loaded into every system prompt instead of full transcripts.
 */
/**
 * The Dingba Brain: a structured learning profile per student, built from
 * sessions over time. Lists are short and capped — this is the distilled
 * "who am I teaching", not a transcript archive.
 */
export const learnerProfiles = pgTable("learner_profiles", {
  studentId: uuid("student_id").primaryKey().references(() => students.id),
  profile: jsonb("profile").$type<Record<string, string[]>>().notNull().default({}),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * The learner's real-world routine, parsed from an uploaded timetable,
 * curriculum, or syllabus (screenshot, photo, or pasted text). One row per
 * student; a new upload replaces the old routine.
 */
export const routines = pgTable("routines", {
  studentId: uuid("student_id").primaryKey().references(() => students.id),
  routine: jsonb("routine").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const memories = pgTable("memories", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: uuid("student_id").notNull().references(() => students.id),
  kind: text("kind", { enum: ["academic", "personal", "goal"] }).notNull(),
  content: text("content").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
