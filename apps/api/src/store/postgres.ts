import { createDb, schema, type Db } from "@tutor/db";
import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import {
  mergeProfile,
  scheduleAttempt,
  type AuditEntry,
  type BillingEventRecord,
  type BillingEventRow,
  type AuditRow,
  type CareContact,
  type LearnerProfile,
  type LearnerRoutine,
  type PlatformIncident,
  type PlatformMetrics,
  type SessionRecap,
  type StaffHr,
  type StaffMember,
  type Store,
  type UsageKind,
} from "./types.js";
import { loadPack } from "../tutor/prompt.js";

export class PostgresStore implements Store {
  readonly kind = "postgres";
  private db: Db;

  constructor(url: string) {
    this.db = createDb(url);
  }

  /** Upsert curriculum skills so mastery rows have valid foreign keys. */
  async seedSkills(packIds: string[]) {
    for (const packId of packIds) {
      const pack = loadPack(packId);
      for (const s of pack.skills) {
        await this.db
          .insert(schema.skills)
          .values({ id: s.id, packId: pack.id, title: s.title, prerequisites: s.prerequisites })
          .onConflictDoUpdate({
            target: schema.skills.id,
            set: { title: s.title, prerequisites: s.prerequisites },
          });
      }
    }
  }

  async ensureStudent(name: string, parentEmail?: string) {
    // Scope identity by parent so two families' "Ada"s never collide.
    // Real accounts/auth replace this lookup in the auth sprint.
    let parentUserId: string | undefined;
    if (parentEmail) {
      const [parent] = await this.db
        .insert(schema.users)
        .values({ email: parentEmail.toLowerCase(), role: "parent" })
        .onConflictDoUpdate({ target: schema.users.email, set: { role: "parent" } })
        .returning({ id: schema.users.id });
      parentUserId = parent.id;
    }

    const existing = await this.db
      .select({ id: schema.students.id })
      .from(schema.students)
      .where(
        and(
          eq(schema.students.displayName, name),
          parentUserId
            ? eq(schema.students.parentUserId, parentUserId)
            : isNull(schema.students.parentUserId),
        ),
      )
      .limit(1);
    if (existing.length) return { id: existing[0].id };

    const [user] = await this.db
      .insert(schema.users)
      .values({ email: `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}-${crypto.randomUUID().slice(0, 8)}@students.local` })
      .returning({ id: schema.users.id });

    const [student] = await this.db
      .insert(schema.students)
      .values({ userId: user.id, parentUserId, displayName: name })
      .returning({ id: schema.students.id });
    return { id: student.id };
  }

  async createSession(studentId: string, _personaId: string, packId: string) {
    const [row] = await this.db
      .insert(schema.sessions)
      .values({ studentId, packId })
      .returning({ id: schema.sessions.id });
    return row.id;
  }

  async saveMessage(sessionId: string, role: "user" | "assistant", content: string) {
    await this.db.insert(schema.messages).values({ sessionId, role, content });
  }

  async endSession(sessionId: string, recap: SessionRecap) {
    await this.db
      .update(schema.sessions)
      .set({
        endedAt: new Date(),
        recap: { summary: recap.summary, struggles: [], wins: [], nextFocusSkillIds: [recap.nextFocus] },
      })
      .where(eq(schema.sessions.id, sessionId));
  }

  async getMemories(studentId: string) {
    // Newest 12, oldest-first, so long-lived students don't bloat the prompt.
    const rows = await this.db
      .select({ content: schema.memories.content })
      .from(schema.memories)
      .where(and(eq(schema.memories.studentId, studentId), eq(schema.memories.active, true)))
      .orderBy(desc(schema.memories.createdAt))
      .limit(12);
    return rows.map((r) => r.content).reverse();
  }

  async getProfile(studentId: string): Promise<LearnerProfile | null> {
    const [row] = await this.db
      .select({ profile: schema.learnerProfiles.profile })
      .from(schema.learnerProfiles)
      .where(eq(schema.learnerProfiles.studentId, studentId))
      .limit(1);
    return row ? (mergeProfile(null, row.profile as Partial<LearnerProfile>)) : null;
  }

  async updateProfile(studentId: string, patch: Partial<LearnerProfile>) {
    const merged = { ...mergeProfile(await this.getProfile(studentId), patch) } as Record<string, string[]>;
    await this.db
      .insert(schema.learnerProfiles)
      .values({ studentId, profile: merged, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.learnerProfiles.studentId,
        set: { profile: merged, updatedAt: new Date() },
      });
  }

  async getCareContact(studentId: string): Promise<CareContact | null> {
    const [row] = await this.db
      .select({
        name: schema.careContacts.name,
        phone: schema.careContacts.phone,
        relationship: schema.careContacts.relationship,
      })
      .from(schema.careContacts)
      .where(eq(schema.careContacts.studentId, studentId))
      .limit(1);
    return row ? { name: row.name, phone: row.phone, relationship: row.relationship ?? undefined } : null;
  }

  async saveCareContact(studentId: string, contact: CareContact) {
    await this.db
      .insert(schema.careContacts)
      .values({
        studentId,
        name: contact.name,
        phone: contact.phone,
        relationship: contact.relationship ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.careContacts.studentId,
        set: {
          name: contact.name,
          phone: contact.phone,
          relationship: contact.relationship ?? null,
          updatedAt: new Date(),
        },
      });
  }

  async deleteCareContact(studentId: string) {
    await this.db.delete(schema.careContacts).where(eq(schema.careContacts.studentId, studentId));
  }

  async getRoutine(studentId: string): Promise<LearnerRoutine | null> {
    const [row] = await this.db
      .select({ routine: schema.routines.routine })
      .from(schema.routines)
      .where(eq(schema.routines.studentId, studentId))
      .limit(1);
    return row ? (row.routine as unknown as LearnerRoutine) : null;
  }

  async saveRoutine(studentId: string, routine: LearnerRoutine) {
    const value = { ...routine } as unknown as Record<string, unknown>;
    await this.db
      .insert(schema.routines)
      .values({ studentId, routine: value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.routines.studentId,
        set: { routine: value, updatedAt: new Date() },
      });
  }

  async addMemory(studentId: string, kind: "academic" | "personal" | "goal", content: string) {
    await this.db.insert(schema.memories).values({ studentId, kind, content });
  }

  async recordAttempt(studentId: string, skillId: string, correct: boolean) {
    const existing = await this.db
      .select()
      .from(schema.mastery)
      .where(and(eq(schema.mastery.studentId, studentId), eq(schema.mastery.skillId, skillId)))
      .limit(1);
    if (existing.length) {
      const cur = existing[0];
      const next = scheduleAttempt(
        {
          level: cur.level,
          attempts: cur.attempts,
          correct: cur.correct,
          stabilityDays: cur.stabilityDays,
          dueAt: cur.dueAt ?? new Date(),
        },
        correct,
      );
      await this.db
        .update(schema.mastery)
        .set({
          level: next.level,
          attempts: next.attempts,
          correct: next.correct,
          stabilityDays: next.stabilityDays,
          dueAt: next.dueAt,
          updatedAt: new Date(),
        })
        .where(eq(schema.mastery.id, cur.id));
    } else {
      const next = scheduleAttempt(null, correct);
      await this.db.insert(schema.mastery).values({
        studentId,
        skillId,
        level: next.level,
        attempts: next.attempts,
        correct: next.correct,
        stabilityDays: next.stabilityDays,
        dueAt: next.dueAt,
      });
    }
  }

  async getMasterySnapshot(studentId: string) {
    const rows = await this.db
      .select({
        skillId: schema.mastery.skillId,
        level: schema.mastery.level,
        attempts: schema.mastery.attempts,
        dueAt: schema.mastery.dueAt,
      })
      .from(schema.mastery)
      .where(eq(schema.mastery.studentId, studentId));
    return rows;
  }

  async getDueSkills(studentId: string, limit: number) {
    const rows = await this.db
      .select({ skillId: schema.mastery.skillId, level: schema.mastery.level, dueAt: schema.mastery.dueAt })
      .from(schema.mastery)
      .where(and(eq(schema.mastery.studentId, studentId), sql`${schema.mastery.dueAt} <= now()`))
      .orderBy(schema.mastery.dueAt)
      .limit(limit);
    return rows.filter((r): r is typeof r & { dueAt: Date } => r.dueAt != null);
  }

  // ---- Accounts & auth ----

  async createAccount(
    email: string,
    passwordHash: string,
    role: "parent" | "student",
    displayName: string,
  ) {
    let rows = await this.db
      .insert(schema.users)
      .values({ email: email.toLowerCase(), role, passwordHash, displayName })
      .onConflictDoNothing({ target: schema.users.email })
      .returning({ id: schema.users.id });

    if (!rows.length) {
      // The email may exist only as a passwordless placeholder (guest flow's
      // parent-email upsert). Claiming it upgrades the guest family to a real
      // account; an email with a password stays taken.
      rows = await this.db
        .update(schema.users)
        .set({ passwordHash, role, displayName })
        .where(and(eq(schema.users.email, email.toLowerCase()), isNull(schema.users.passwordHash)))
        .returning({ id: schema.users.id });
      if (!rows.length) return null; // genuinely taken
    }

    const userId = rows[0].id;
    let studentId: string | undefined;
    if (role === "student") {
      const [student] = await this.db
        .insert(schema.students)
        .values({ userId, displayName })
        .returning({ id: schema.students.id });
      studentId = student.id;
    }
    return { userId, studentId };
  }

  async getAccountByEmail(email: string) {
    const rows = await this.db
      .select({
        userId: schema.users.id,
        passwordHash: schema.users.passwordHash,
        role: schema.users.role,
      })
      .from(schema.users)
      .where(eq(schema.users.email, email.toLowerCase()))
      .limit(1);
    return rows[0] ?? null;
  }

  async saveToken(tokenHash: string, userId: string) {
    await this.db.insert(schema.authTokens).values({ tokenHash, userId });
  }

  async resolveToken(tokenHash: string) {
    const rows = await this.db
      .select({ userId: schema.users.id, email: schema.users.email, role: schema.users.role })
      .from(schema.authTokens)
      .innerJoin(schema.users, eq(schema.authTokens.userId, schema.users.id))
      .where(
        and(
          eq(schema.authTokens.tokenHash, tokenHash),
          // 30-day expiry: a stolen or forgotten token doesn't live forever.
          gte(schema.authTokens.createdAt, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
        ),
      )
      .limit(1);
    if (!rows.length) return null;
    await this.db
      .update(schema.authTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.authTokens.tokenHash, tokenHash));
    return rows[0];
  }

  async addStudentProfile(parentUserId: string, displayName: string) {
    // The child's placeholder user keeps the schema's user link intact
    // until kids get their own logins.
    const [child] = await this.db
      .insert(schema.users)
      .values({
        email: `${displayName.toLowerCase().replace(/[^a-z0-9]/g, "")}-${crypto.randomUUID().slice(0, 8)}@students.local`,
      })
      .returning({ id: schema.users.id });
    const [student] = await this.db
      .insert(schema.students)
      .values({ userId: child.id, parentUserId, displayName })
      .returning({ id: schema.students.id });
    return { id: student.id };
  }

  async listStudentProfiles(userId: string) {
    const own = await this.db
      .select({ id: schema.students.id, displayName: schema.students.displayName })
      .from(schema.students)
      .where(eq(schema.students.userId, userId));
    const children = await this.db
      .select({ id: schema.students.id, displayName: schema.students.displayName })
      .from(schema.students)
      .where(eq(schema.students.parentUserId, userId));
    return [...own, ...children];
  }

  async ownsStudent(userId: string, studentId: string) {
    const rows = await this.db
      .select({ id: schema.students.id })
      .from(schema.students)
      .where(
        and(
          eq(schema.students.id, studentId),
          or(eq(schema.students.userId, userId), eq(schema.students.parentUserId, userId)),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async getStudentName(studentId: string) {
    const rows = await this.db
      .select({ displayName: schema.students.displayName })
      .from(schema.students)
      .where(eq(schema.students.id, studentId))
      .limit(1);
    return rows[0]?.displayName ?? null;
  }

  async recordIncident(incident: {
    studentId: string;
    sessionId?: string;
    direction: "student" | "tutor";
    categories: string[];
    severity: "concern" | "danger";
    excerpt: string;
  }) {
    await this.db.insert(schema.safetyIncidents).values(incident);
  }

  async listIncidents(studentId: string, limit: number) {
    const rows = await this.db
      .select({
        direction: schema.safetyIncidents.direction,
        categories: schema.safetyIncidents.categories,
        severity: schema.safetyIncidents.severity,
        excerpt: schema.safetyIncidents.excerpt,
        createdAt: schema.safetyIncidents.createdAt,
      })
      .from(schema.safetyIncidents)
      .where(eq(schema.safetyIncidents.studentId, studentId))
      .orderBy(desc(schema.safetyIncidents.createdAt))
      .limit(limit);
    return rows;
  }

  async listSessionSummaries(studentId: string, limit: number) {
    const rows = await this.db
      .select({
        startedAt: schema.sessions.startedAt,
        endedAt: schema.sessions.endedAt,
        recap: schema.sessions.recap,
      })
      .from(schema.sessions)
      .where(eq(schema.sessions.studentId, studentId))
      .orderBy(desc(schema.sessions.startedAt))
      .limit(limit);
    return rows.map((r) => ({
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      summary: r.recap?.summary ?? null,
    }));
  }

  // ---- Business wiring ----

  async recordUsage(e: { userId?: string; studentId?: string; apiKeyId?: string; kind: UsageKind; quantity?: number }) {
    await this.db.insert(schema.usageEvents).values({ ...e, quantity: e.quantity ?? 1 });
  }

  async sumUsage(
    subject: { userId?: string; studentId?: string; apiKeyId?: string },
    kind: UsageKind | null,
    since: Date,
  ) {
    const subjectCond = subject.userId
      ? eq(schema.usageEvents.userId, subject.userId)
      : subject.studentId
        ? eq(schema.usageEvents.studentId, subject.studentId)
        : eq(schema.usageEvents.apiKeyId, subject.apiKeyId!);
    const conds = [subjectCond, gte(schema.usageEvents.createdAt, since)];
    if (kind !== null) conds.push(eq(schema.usageEvents.kind, kind));
    const rows = await this.db
      .select({ total: sql<number>`coalesce(sum(${schema.usageEvents.quantity}), 0)` })
      .from(schema.usageEvents)
      .where(and(...conds));
    return Number(rows[0]?.total ?? 0);
  }

  async getUserPlan(userId: string) {
    const rows = await this.db
      .select({ plan: schema.users.plan })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return rows[0]?.plan ?? "free";
  }

  async setUserPlan(email: string, plan: string) {
    const rows = await this.db
      .update(schema.users)
      .set({ plan })
      .where(eq(schema.users.email, email.toLowerCase()))
      .returning({ id: schema.users.id });
    return rows.length > 0;
  }

  async createOrg(ownerUserId: string, name: string, seats: number) {
    const [org] = await this.db
      .insert(schema.orgs)
      .values({ ownerUserId, name, seats })
      .returning({ id: schema.orgs.id });
    await this.db
      .update(schema.users)
      .set({ role: "teacher", orgId: org.id, plan: "premium" })
      .where(eq(schema.users.id, ownerUserId));
    return org;
  }

  async getOrgByOwner(ownerUserId: string) {
    const rows = await this.db
      .select({ id: schema.orgs.id, name: schema.orgs.name, seats: schema.orgs.seats, plan: schema.orgs.plan })
      .from(schema.orgs)
      .where(eq(schema.orgs.ownerUserId, ownerUserId))
      .limit(1);
    return rows[0] ?? null;
  }

  async addOrgStudents(orgId: string, ownerUserId: string, names: string[]) {
    const out: Array<{ id: string; displayName: string }> = [];
    for (const name of names) {
      const s = await this.addStudentProfile(ownerUserId, name);
      await this.db.update(schema.students).set({ orgId }).where(eq(schema.students.id, s.id));
      out.push({ id: s.id, displayName: name });
    }
    return out;
  }

  async listOrgStudents(orgId: string) {
    return this.db
      .select({ id: schema.students.id, displayName: schema.students.displayName })
      .from(schema.students)
      .where(eq(schema.students.orgId, orgId));
  }

  async countOrgStudents(orgId: string) {
    const rows = await this.db
      .select({ n: sql<number>`count(*)` })
      .from(schema.students)
      .where(eq(schema.students.orgId, orgId));
    return Number(rows[0]?.n ?? 0);
  }

  // ---- Trust & retention ----

  async savePushSubscription(userId: string, sub: { endpoint: string; p256dh: string; auth: string }) {
    await this.db
      .insert(schema.pushSubscriptions)
      .values({ userId, ...sub })
      .onConflictDoUpdate({ target: schema.pushSubscriptions.endpoint, set: { userId, p256dh: sub.p256dh, auth: sub.auth } });
  }

  async listPushSubscriptions(userId: string) {
    return this.db
      .select({
        endpoint: schema.pushSubscriptions.endpoint,
        p256dh: schema.pushSubscriptions.p256dh,
        auth: schema.pushSubscriptions.auth,
      })
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, userId));
  }

  async deletePushSubscription(endpoint: string) {
    await this.db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, endpoint));
  }

  async listAllPushSubscriptions() {
    return this.db
      .select({
        userId: schema.pushSubscriptions.userId,
        endpoint: schema.pushSubscriptions.endpoint,
        p256dh: schema.pushSubscriptions.p256dh,
        auth: schema.pushSubscriptions.auth,
      })
      .from(schema.pushSubscriptions);
  }

  async createPasswordReset(userId: string, tokenHash: string) {
    await this.db.insert(schema.passwordResets).values({ userId, tokenHash });
  }

  // ---- Billing & email verification ----

  async createEmailVerification(userId: string, tokenHash: string) {
    await this.db.insert(schema.emailVerifications).values({ userId, tokenHash });
  }

  async consumeEmailVerification(tokenHash: string, maxAgeMs: number) {
    const rows = await this.db
      .update(schema.emailVerifications)
      .set({ used: true })
      .where(
        and(
          eq(schema.emailVerifications.tokenHash, tokenHash),
          eq(schema.emailVerifications.used, false),
          gte(schema.emailVerifications.createdAt, new Date(Date.now() - maxAgeMs)),
        ),
      )
      .returning({ userId: schema.emailVerifications.userId });
    return rows[0]?.userId ?? null;
  }

  async markEmailVerified(userId: string) {
    await this.db.update(schema.users).set({ emailVerified: true }).where(eq(schema.users.id, userId));
  }

  async isEmailVerified(userId: string) {
    const rows = await this.db
      .select({ v: schema.users.emailVerified })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return rows[0]?.v ?? false;
  }

  async recordSubscription(sub: {
    userId: string;
    provider: string;
    customerRef: string;
    subscriptionRef: string;
    plan: string;
    status: "active" | "canceled";
  }) {
    const existing = await this.db
      .select({ id: schema.billingSubscriptions.id })
      .from(schema.billingSubscriptions)
      .where(
        and(
          eq(schema.billingSubscriptions.provider, sub.provider as "stripe" | "paystack" | "mock"),
          eq(schema.billingSubscriptions.subscriptionRef, sub.subscriptionRef),
        ),
      )
      .limit(1);
    if (existing[0]) {
      await this.db
        .update(schema.billingSubscriptions)
        .set({ plan: sub.plan, status: sub.status, customerRef: sub.customerRef, updatedAt: new Date() })
        .where(eq(schema.billingSubscriptions.id, existing[0].id));
    } else {
      await this.db.insert(schema.billingSubscriptions).values({
        userId: sub.userId,
        provider: sub.provider as "stripe" | "paystack" | "mock",
        customerRef: sub.customerRef,
        subscriptionRef: sub.subscriptionRef,
        plan: sub.plan,
        status: sub.status,
      });
    }
  }

  async getSubscription(userId: string) {
    const rows = await this.db
      .select({
        provider: schema.billingSubscriptions.provider,
        plan: schema.billingSubscriptions.plan,
        status: schema.billingSubscriptions.status,
        subscriptionRef: schema.billingSubscriptions.subscriptionRef,
        updatedAt: schema.billingSubscriptions.updatedAt,
      })
      .from(schema.billingSubscriptions)
      .where(eq(schema.billingSubscriptions.userId, userId));
    rows.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const s = rows[0];
    return s ? { provider: s.provider, plan: s.plan, status: s.status, subscriptionRef: s.subscriptionRef } : null;
  }

  async findSubscriptionByRef(provider: string, ref: { customerRef?: string; subscriptionRef?: string }) {
    const conds = [eq(schema.billingSubscriptions.provider, provider as "stripe" | "paystack" | "mock")];
    if (ref.subscriptionRef) conds.push(eq(schema.billingSubscriptions.subscriptionRef, ref.subscriptionRef));
    else if (ref.customerRef) conds.push(eq(schema.billingSubscriptions.customerRef, ref.customerRef));
    else return null;
    const rows = await this.db
      .select({ userId: schema.billingSubscriptions.userId, email: schema.users.email })
      .from(schema.billingSubscriptions)
      .innerJoin(schema.users, eq(schema.users.id, schema.billingSubscriptions.userId))
      .where(and(...conds))
      .limit(1);
    return rows[0] ?? null;
  }

  async consumePasswordReset(tokenHash: string, maxAgeMs: number) {
    const rows = await this.db
      .update(schema.passwordResets)
      .set({ used: true })
      .where(
        and(
          eq(schema.passwordResets.tokenHash, tokenHash),
          eq(schema.passwordResets.used, false),
          gte(schema.passwordResets.createdAt, new Date(Date.now() - maxAgeMs)),
        ),
      )
      .returning({ userId: schema.passwordResets.userId });
    return rows[0]?.userId ?? null;
  }

  async setPassword(userId: string, passwordHash: string) {
    await this.db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, userId));
  }

  async revokeUserTokens(userId: string) {
    await this.db.delete(schema.authTokens).where(eq(schema.authTokens.userId, userId));
  }

  async deleteAccount(userId: string) {
    const students = await this.listStudentProfiles(userId);
    for (const s of students) {
      const sessions = await this.db
        .select({ id: schema.sessions.id })
        .from(schema.sessions)
        .where(eq(schema.sessions.studentId, s.id));
      for (const sess of sessions) {
        await this.db.delete(schema.messages).where(eq(schema.messages.sessionId, sess.id));
      }
      await this.db.delete(schema.sessions).where(eq(schema.sessions.studentId, s.id));
      await this.db.delete(schema.memories).where(eq(schema.memories.studentId, s.id));
      await this.db.delete(schema.learnerProfiles).where(eq(schema.learnerProfiles.studentId, s.id));
      await this.db.delete(schema.routines).where(eq(schema.routines.studentId, s.id));
      await this.db.delete(schema.careContacts).where(eq(schema.careContacts.studentId, s.id));
      await this.db.delete(schema.mastery).where(eq(schema.mastery.studentId, s.id));
      await this.db.delete(schema.safetyIncidents).where(eq(schema.safetyIncidents.studentId, s.id));
      await this.db.delete(schema.usageEvents).where(eq(schema.usageEvents.studentId, s.id));
      await this.db.delete(schema.students).where(eq(schema.students.id, s.id));
    }
    await this.db.delete(schema.usageEvents).where(eq(schema.usageEvents.userId, userId));
    await this.db.delete(schema.apiKeys).where(eq(schema.apiKeys.ownerUserId, userId));
    await this.db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, userId));
    await this.db.delete(schema.passwordResets).where(eq(schema.passwordResets.userId, userId));
    await this.db.delete(schema.emailVerifications).where(eq(schema.emailVerifications.userId, userId));
    await this.db.delete(schema.billingSubscriptions).where(eq(schema.billingSubscriptions.userId, userId));
    await this.db.delete(schema.authTokens).where(eq(schema.authTokens.userId, userId));
    await this.db.delete(schema.orgs).where(eq(schema.orgs.ownerUserId, userId));
    await this.db.delete(schema.staffMembers).where(eq(schema.staffMembers.userId, userId));
    await this.db.delete(schema.users).where(eq(schema.users.id, userId));
  }

  async listRecentMessages(studentId: string, limit: number) {
    const rows = await this.db
      .select({
        role: schema.messages.role,
        content: schema.messages.content,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .innerJoin(schema.sessions, eq(schema.messages.sessionId, schema.sessions.id))
      .where(eq(schema.sessions.studentId, studentId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(limit);
    return rows.reverse();
  }

  async getStreakDays(studentId: string) {
    const rows = await this.db
      .select({ startedAt: schema.sessions.startedAt })
      .from(schema.sessions)
      .where(eq(schema.sessions.studentId, studentId));
    const days = new Set(rows.map((r) => r.startedAt.toISOString().slice(0, 10)));
    let streak = 0;
    const cursor = new Date();
    if (!days.has(cursor.toISOString().slice(0, 10))) cursor.setDate(cursor.getDate() - 1);
    while (days.has(cursor.toISOString().slice(0, 10))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  async createApiKey(ownerUserId: string, name: string, keyHash: string, scopes: string[], monthlyQuota = 10_000) {
    const [key] = await this.db
      .insert(schema.apiKeys)
      .values({ ownerUserId, name, keyHash, scopes, monthlyQuota })
      .returning({ id: schema.apiKeys.id });
    return key;
  }

  async resolveApiKey(keyHash: string) {
    const rows = await this.db
      .select({
        id: schema.apiKeys.id,
        ownerUserId: schema.apiKeys.ownerUserId,
        scopes: schema.apiKeys.scopes,
        monthlyQuota: schema.apiKeys.monthlyQuota,
        revoked: schema.apiKeys.revoked,
      })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.keyHash, keyHash))
      .limit(1);
    const k = rows[0];
    if (!k || k.revoked) return null;
    await this.db
      .update(schema.apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.apiKeys.id, k.id));
    return { id: k.id, ownerUserId: k.ownerUserId, scopes: k.scopes, monthlyQuota: k.monthlyQuota };
  }

  async listApiKeys(ownerUserId: string) {
    return this.db
      .select({
        id: schema.apiKeys.id,
        name: schema.apiKeys.name,
        scopes: schema.apiKeys.scopes,
        monthlyQuota: schema.apiKeys.monthlyQuota,
        revoked: schema.apiKeys.revoked,
      })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.ownerUserId, ownerUserId));
  }

  async revokeApiKey(ownerUserId: string, keyId: string) {
    const rows = await this.db
      .update(schema.apiKeys)
      .set({ revoked: true })
      .where(and(eq(schema.apiKeys.id, keyId), eq(schema.apiKeys.ownerUserId, ownerUserId)))
      .returning({ id: schema.apiKeys.id });
    return rows.length > 0;
  }

  // ---- Command Centre ----

  /** Staff rows carry no email of their own; the account is the source of truth. */
  private staffSelect() {
    return this.db
      .select({
        userId: schema.staffMembers.userId,
        email: schema.users.email,
        displayName: schema.users.displayName,
        role: schema.staffMembers.role,
        title: schema.staffMembers.title,
        status: schema.staffMembers.status,
        createdAt: schema.staffMembers.createdAt,
        lastSeenAt: schema.staffMembers.lastSeenAt,
        fullName: schema.staffMembers.fullName,
        employmentType: schema.staffMembers.employmentType,
        startDate: schema.staffMembers.startDate,
        endDate: schema.staffMembers.endDate,
        managerUserId: schema.staffMembers.managerUserId,
        location: schema.staffMembers.location,
        notes: schema.staffMembers.notes,
      })
      .from(schema.staffMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.staffMembers.userId));
  }

  async listStaff(): Promise<StaffMember[]> {
    return this.staffSelect().orderBy(schema.staffMembers.createdAt);
  }

  async getStaff(userId: string): Promise<StaffMember | null> {
    const rows = await this.staffSelect().where(eq(schema.staffMembers.userId, userId)).limit(1);
    return rows[0] ?? null;
  }

  async upsertStaff(member: {
    userId: string;
    role: string;
    title?: string;
    status?: "active" | "suspended";
    invitedBy?: string;
  }) {
    const role = member.role as "owner" | "admin" | "finance" | "support" | "staff" | "investor";
    const set: Record<string, unknown> = { role };
    if (member.title !== undefined) set.title = member.title;
    if (member.status !== undefined) set.status = member.status;
    await this.db
      .insert(schema.staffMembers)
      .values({
        userId: member.userId,
        role,
        title: member.title,
        status: member.status ?? "active",
        invitedBy: member.invitedBy,
      })
      .onConflictDoUpdate({ target: schema.staffMembers.userId, set });
  }

  async removeStaff(userId: string) {
    const rows = await this.db
      .delete(schema.staffMembers)
      .where(eq(schema.staffMembers.userId, userId))
      .returning({ userId: schema.staffMembers.userId });
    if (rows.length === 0) return false;
    // Nobody should be left reporting to someone who is no longer here.
    await this.db
      .update(schema.staffMembers)
      .set({ managerUserId: null })
      .where(eq(schema.staffMembers.managerUserId, userId));
    return true;
  }

  async updateStaffHr(userId: string, hr: StaffHr) {
    // Only the keys given are touched; the rest of the record stands.
    const set: Record<string, unknown> = {};
    for (const key of ["fullName", "employmentType", "startDate", "endDate", "managerUserId", "location", "notes"] as const) {
      if (hr[key] !== undefined) set[key] = hr[key];
    }
    if (Object.keys(set).length === 0) return (await this.getStaff(userId)) !== null;
    const rows = await this.db
      .update(schema.staffMembers)
      .set(set)
      .where(eq(schema.staffMembers.userId, userId))
      .returning({ userId: schema.staffMembers.userId });
    return rows.length > 0;
  }

  async touchStaffSeen(userId: string) {
    await this.db
      .update(schema.staffMembers)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.staffMembers.userId, userId));
  }

  async recordAudit(entry: AuditEntry) {
    await this.db.insert(schema.auditLog).values({
      actorUserId: entry.actorUserId,
      actorEmail: entry.actorEmail,
      actorRole: entry.actorRole,
      action: entry.action,
      target: entry.target,
      meta: entry.meta,
      ip: entry.ip,
    });
  }

  async listAudit(limit: number, opts: { action?: string } = {}): Promise<AuditRow[]> {
    const rows = await this.db
      .select()
      .from(schema.auditLog)
      .where(opts.action ? eq(schema.auditLog.action, opts.action) : undefined)
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      actorUserId: r.actorUserId,
      actorEmail: r.actorEmail,
      actorRole: r.actorRole,
      action: r.action,
      target: r.target ?? undefined,
      meta: r.meta,
      ip: r.ip ?? undefined,
      createdAt: r.createdAt,
    }));
  }

  async listPlatformIncidents(limit: number, opts: { severity?: "concern" | "danger" } = {}) {
    // A learner belongs either to a guardian (parent_user_id) or, for adult
    // self-learners, to their own account. Either one is who we would contact.
    const rows = (await this.db.execute(sql`
      select i.id, i.student_id, st.display_name as student_name,
             coalesce(g.email, u.email) as guardian_email,
             i.direction, i.categories, i.severity, i.excerpt, i.created_at
      from safety_incidents i
      join students st on st.id = i.student_id
      left join users g on g.id = st.parent_user_id
      left join users u on u.id = st.user_id
      ${opts.severity ? sql`where i.severity = ${opts.severity}` : sql``}
      order by i.created_at desc
      limit ${Math.max(1, Math.min(500, Math.floor(limit)))}
    `)) as unknown as Array<{
      id: string;
      student_id: string;
      student_name: string;
      guardian_email: string | null;
      direction: string;
      categories: string[];
      severity: string;
      excerpt: string;
      created_at: Date;
    }>;
    return rows.map((r): PlatformIncident => ({
      id: r.id,
      studentId: r.student_id,
      studentName: r.student_name,
      // A generated @students.local address is bookkeeping, not a contact.
      guardianEmail: r.guardian_email && !r.guardian_email.endsWith("@students.local") ? r.guardian_email : null,
      direction: r.direction,
      categories: r.categories,
      severity: r.severity,
      excerpt: r.excerpt,
      createdAt: new Date(r.created_at),
    }));
  }

  async countIncidentsSince(since: Date) {
    const rows = (await this.db.execute(sql`
      select
        count(*) filter (where severity = 'concern') as concern,
        count(*) filter (where severity = 'danger') as danger
      from safety_incidents
      where created_at >= ${since}
    `)) as unknown as Array<{ concern: string | number; danger: string | number }>;
    return { concern: Number(rows[0]?.concern ?? 0), danger: Number(rows[0]?.danger ?? 0) };
  }

  async recordBillingEvent(event: BillingEventRecord) {
    // The unique (provider, event_ref) index makes retried webhooks a no-op.
    const rows = await this.db
      .insert(schema.billingEvents)
      .values({
        provider: event.provider,
        eventRef: event.eventRef,
        type: event.type,
        email: event.email,
        customerRef: event.customerRef,
        subscriptionRef: event.subscriptionRef,
        plan: event.plan,
        amountMinor: event.amountMinor,
        currency: event.currency,
        matched: event.matched,
      })
      .onConflictDoNothing()
      .returning({ id: schema.billingEvents.id });
    return rows.length > 0;
  }

  async listBillingEvents(limit: number, opts: { type?: string } = {}): Promise<BillingEventRow[]> {
    const rows = await this.db
      .select()
      .from(schema.billingEvents)
      .where(opts.type ? eq(schema.billingEvents.type, opts.type as "activated") : undefined)
      .orderBy(desc(schema.billingEvents.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      eventRef: r.eventRef,
      type: r.type,
      email: r.email ?? undefined,
      customerRef: r.customerRef ?? undefined,
      subscriptionRef: r.subscriptionRef ?? undefined,
      plan: r.plan ?? undefined,
      amountMinor: r.amountMinor ?? undefined,
      currency: r.currency ?? undefined,
      matched: r.matched,
      createdAt: r.createdAt,
    }));
  }

  async countBillingTroubleSince(since: Date) {
    const rows = (await this.db.execute(sql`
      select
        count(*) filter (where type = 'payment_failed') as failed,
        count(*) filter (where type = 'refunded') as refunded
      from billing_events
      where created_at >= ${since}
    `)) as unknown as Array<{ failed: string | number; refunded: string | number }>;
    return { failed: Number(rows[0]?.failed ?? 0), refunded: Number(rows[0]?.refunded ?? 0) };
  }

  async getSetting(key: string) {
    const rows = await this.db
      .select({ value: schema.platformSettings.value })
      .from(schema.platformSettings)
      .where(eq(schema.platformSettings.key, key))
      .limit(1);
    return rows[0]?.value ?? null;
  }

  async setSetting(key: string, value: unknown, updatedBy: string) {
    await this.db
      .insert(schema.platformSettings)
      .values({ key, value, updatedBy, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.platformSettings.key,
        set: { value, updatedBy, updatedAt: new Date() },
      });
  }

  async platformMetrics(days: number): Promise<PlatformMetrics> {
    // Timestamps are stored in UTC, so every window is cut in UTC too.
    const window = Math.max(1, Math.min(365, Math.floor(days)));
    const totals = (await this.db.execute(sql`
      select
        (select count(*) from students) as learners,
        (select count(*) from users where role = 'parent') as guardians,
        (select count(*) from sessions) as sessions,
        (select count(*) from sessions
           where started_at >= date_trunc('day', now() at time zone 'utc')) as sessions_today,
        (select count(distinct student_id) from sessions
           where started_at >= date_trunc('day', now() at time zone 'utc')) as active_today,
        (select count(distinct student_id) from sessions
           where started_at >= (now() at time zone 'utc') - interval '7 days') as active_week,
        (select count(distinct student_id) from sessions
           where started_at >= (now() at time zone 'utc') - interval '30 days') as active_month,
        (select count(*) from messages) as messages,
        (select coalesce(sum(quantity), 0) from usage_events where kind = 'voice_turn') as voice_turns,
        (select coalesce(sum(quantity), 0) from usage_events where kind = 'practice') as practice_attempts,
        (select count(*) from safety_incidents) as safety_incidents,
        (select count(*) from safety_incidents where severity = 'danger') as safety_danger,
        (select count(*) from billing_subscriptions where status = 'active') as paid_subscriptions
    `)) as unknown as Array<Record<string, string | number>>;
    const t = totals[0] ?? {};
    const n = (key: string) => Number(t[key] ?? 0);

    const planRows = (await this.db.execute(sql`
      select plan, count(*) as count from users group by plan order by count desc, plan
    `)) as unknown as Array<{ plan: string; count: string | number }>;

    const sessionsSeries = (await this.db.execute(sql`
      select to_char(d, 'YYYY-MM-DD') as day,
             (select count(*) from sessions s where s.started_at::date = d)::int as count
      from generate_series(
        (now() at time zone 'utc')::date - ${window - 1},
        (now() at time zone 'utc')::date,
        interval '1 day'
      ) as g(d)
    `)) as unknown as Array<{ day: string; count: number }>;

    const signupsSeries = (await this.db.execute(sql`
      select to_char(d, 'YYYY-MM-DD') as day,
             (select count(*) from users u where u.created_at::date = d)::int as count
      from generate_series(
        (now() at time zone 'utc')::date - ${window - 1},
        (now() at time zone 'utc')::date,
        interval '1 day'
      ) as g(d)
    `)) as unknown as Array<{ day: string; count: number }>;

    return {
      learners: n("learners"),
      guardians: n("guardians"),
      sessions: n("sessions"),
      sessionsToday: n("sessions_today"),
      activeToday: n("active_today"),
      activeThisWeek: n("active_week"),
      activeThisMonth: n("active_month"),
      messages: n("messages"),
      voiceTurns: n("voice_turns"),
      practiceAttempts: n("practice_attempts"),
      safetyIncidents: n("safety_incidents"),
      safetyDanger: n("safety_danger"),
      paidSubscriptions: n("paid_subscriptions"),
      planMix: planRows.map((r) => ({ plan: r.plan, count: Number(r.count) })),
      sessionsSeries: sessionsSeries.map((r) => ({ day: r.day, count: Number(r.count) })),
      signupsSeries: signupsSeries.map((r) => ({ day: r.day, count: Number(r.count) })),
    };
  }

  async getAccountById(userId: string) {
    const rows = await this.db
      .select({
        userId: schema.users.id,
        email: schema.users.email,
        displayName: schema.users.displayName,
        role: schema.users.role,
        plan: schema.users.plan,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  async listSubscriptions(limit: number) {
    return this.db
      .select({
        userId: schema.billingSubscriptions.userId,
        email: schema.users.email,
        provider: schema.billingSubscriptions.provider,
        plan: schema.billingSubscriptions.plan,
        status: schema.billingSubscriptions.status,
        subscriptionRef: schema.billingSubscriptions.subscriptionRef,
        updatedAt: schema.billingSubscriptions.updatedAt,
      })
      .from(schema.billingSubscriptions)
      .innerJoin(schema.users, eq(schema.users.id, schema.billingSubscriptions.userId))
      .orderBy(desc(schema.billingSubscriptions.updatedAt))
      .limit(limit);
  }

  async searchAccounts(query: string, limit: number) {
    const q = query.trim();
    if (!q) return [];
    const like = `%${q.toLowerCase()}%`;
    const rows = (await this.db.execute(sql`
      select u.id as user_id, u.email, u.display_name, u.role, u.plan, u.created_at,
             (select count(*) from students s where s.user_id = u.id or s.parent_user_id = u.id) as students
      from users u
      where lower(u.email) like ${like} or lower(coalesce(u.display_name, '')) like ${like}
      order by u.created_at desc
      limit ${Math.max(1, Math.min(100, Math.floor(limit)))}
    `)) as unknown as Array<{
      user_id: string;
      email: string;
      display_name: string | null;
      role: string;
      plan: string;
      students: string | number;
      created_at: Date;
    }>;
    return rows.map((r) => ({
      userId: r.user_id,
      email: r.email,
      displayName: r.display_name,
      role: r.role,
      plan: r.plan,
      students: Number(r.students),
      createdAt: new Date(r.created_at),
    }));
  }
}
