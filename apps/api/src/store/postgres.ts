import { createDb, schema, type Db } from "@tutor/db";
import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { SessionRecap, Store, UsageKind } from "./types.js";
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
      await this.db
        .update(schema.mastery)
        .set({
          level: 0.7 * cur.level + 0.3 * (correct ? 1 : 0),
          attempts: cur.attempts + 1,
          correct: cur.correct + (correct ? 1 : 0),
          // Simple spacing placeholder until FSRS lands: double on success, reset on miss.
          stabilityDays: correct ? cur.stabilityDays * 2 : 1,
          dueAt: new Date(Date.now() + (correct ? cur.stabilityDays * 2 : 1) * 86_400_000),
          updatedAt: new Date(),
        })
        .where(eq(schema.mastery.id, cur.id));
    } else {
      await this.db.insert(schema.mastery).values({
        studentId,
        skillId,
        level: correct ? 0.3 : 0,
        attempts: 1,
        correct: correct ? 1 : 0,
        stabilityDays: 1,
        dueAt: new Date(Date.now() + 86_400_000),
      });
    }
  }

  async getMasterySnapshot(studentId: string) {
    const rows = await this.db
      .select({ skillId: schema.mastery.skillId, level: schema.mastery.level })
      .from(schema.mastery)
      .where(eq(schema.mastery.studentId, studentId));
    return rows;
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
      .where(eq(schema.authTokens.tokenHash, tokenHash))
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

  async createApiKey(ownerUserId: string, name: string, keyHash: string, scopes: string[]) {
    const [key] = await this.db
      .insert(schema.apiKeys)
      .values({ ownerUserId, name, keyHash, scopes })
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
}
