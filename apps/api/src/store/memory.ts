import {
  mergeProfile,
  scheduleAttempt,
  type CareContact,
  type LearnerProfile,
  type LearnerRoutine,
  type MasteryState,
  type SessionRecap,
  type Store,
  type UsageKind,
} from "./types.js";

export class MemoryStore implements Store {
  readonly kind = "memory";
  private students = new Map<string, { id: string; parentEmail?: string }>();
  private memories = new Map<string, Array<{ kind: string; content: string }>>();
  private learnerProfiles = new Map<string, LearnerProfile>();
  private routines = new Map<string, LearnerRoutine>();
  private careContacts = new Map<string, CareContact>();
  private mastery = new Map<string, Map<string, MasteryState>>();
  private sessions = new Map<
    string,
    { studentId: string; startedAt: Date; endedAt: Date | null; recap?: SessionRecap }
  >();
  private accounts = new Map<
    string,
    { userId: string; passwordHash: string; role: "parent" | "student"; displayName: string }
  >();
  private tokens = new Map<string, { userId: string; createdAt: Date }>(); // tokenHash -> record
  private pushSubs = new Map<string, { userId: string; endpoint: string; p256dh: string; auth: string }>();
  private resets = new Map<string, { userId: string; used: boolean; createdAt: Date }>();
  private verifications = new Map<string, { userId: string; used: boolean; createdAt: Date }>();
  private verifiedUsers = new Set<string>();
  private subscriptions = new Map<
    string, // `${provider}::${subscriptionRef}`
    { userId: string; provider: string; customerRef: string; subscriptionRef: string; plan: string; status: "active" | "canceled"; updatedAt: Date }
  >();
  private sessionMessages = new Map<string, Array<{ role: string; content: string; createdAt: Date }>>();
  private profiles = new Map<string, { id: string; ownerUserId: string; displayName: string }>();

  async ensureStudent(name: string, parentEmail?: string) {
    // Scope identity by parent email so two families' "Ada"s never collide.
    // Real accounts/auth replace this in the auth sprint.
    const key = `${name.toLowerCase()}::${(parentEmail ?? "").toLowerCase()}`;
    let s = this.students.get(key);
    if (!s) {
      s = { id: crypto.randomUUID(), parentEmail };
      this.students.set(key, s);
    }
    return { id: s.id };
  }

  async createSession(studentId: string, _personaId: string, _packId: string) {
    const id = crypto.randomUUID();
    this.sessions.set(id, { studentId, startedAt: new Date(), endedAt: null });
    return id;
  }

  async saveMessage(sessionId: string, role: "user" | "assistant", content: string) {
    const list = this.sessionMessages.get(sessionId) ?? [];
    list.push({ role, content, createdAt: new Date() });
    this.sessionMessages.set(sessionId, list);
  }

  async endSession(sessionId: string, recap: SessionRecap) {
    const s = this.sessions.get(sessionId);
    if (s) {
      s.recap = recap;
      s.endedAt = new Date();
    }
  }

  async getMemories(studentId: string) {
    // Newest 12, oldest-first, so long-lived students don't bloat the prompt.
    return (this.memories.get(studentId) ?? []).slice(-12).map((m) => m.content);
  }

  async addMemory(studentId: string, kind: "academic" | "personal" | "goal", content: string) {
    const list = this.memories.get(studentId) ?? [];
    list.push({ kind, content });
    this.memories.set(studentId, list);
  }

  async getProfile(studentId: string) {
    return this.learnerProfiles.get(studentId) ?? null;
  }

  async updateProfile(studentId: string, patch: Partial<LearnerProfile>) {
    this.learnerProfiles.set(studentId, mergeProfile(this.learnerProfiles.get(studentId) ?? null, patch));
  }

  async getCareContact(studentId: string) {
    return this.careContacts.get(studentId) ?? null;
  }

  async saveCareContact(studentId: string, contact: CareContact) {
    this.careContacts.set(studentId, contact);
  }

  async deleteCareContact(studentId: string) {
    this.careContacts.delete(studentId);
  }

  async getRoutine(studentId: string) {
    return this.routines.get(studentId) ?? null;
  }

  async saveRoutine(studentId: string, routine: LearnerRoutine) {
    this.routines.set(studentId, routine);
  }

  async recordAttempt(studentId: string, skillId: string, correct: boolean) {
    const bySkill = this.mastery.get(studentId) ?? new Map<string, MasteryState>();
    bySkill.set(skillId, scheduleAttempt(bySkill.get(skillId) ?? null, correct));
    this.mastery.set(studentId, bySkill);
  }

  async getMasterySnapshot(studentId: string) {
    const bySkill = this.mastery.get(studentId) ?? new Map<string, MasteryState>();
    return [...bySkill.entries()].map(([skillId, v]) => ({
      skillId,
      level: v.level,
      attempts: v.attempts,
      dueAt: v.dueAt,
    }));
  }

  async getDueSkills(studentId: string, limit: number) {
    const now = Date.now();
    const bySkill = this.mastery.get(studentId) ?? new Map<string, MasteryState>();
    return [...bySkill.entries()]
      .filter(([, v]) => v.dueAt.getTime() <= now)
      .sort((a, b) => a[1].dueAt.getTime() - b[1].dueAt.getTime())
      .slice(0, limit)
      .map(([skillId, v]) => ({ skillId, level: v.level, dueAt: v.dueAt }));
  }

  // ---- Accounts & auth ----

  async createAccount(
    email: string,
    passwordHash: string,
    role: "parent" | "student",
    displayName: string,
  ) {
    const key = email.toLowerCase();
    if (this.accounts.has(key)) return null;
    const userId = crypto.randomUUID();
    this.accounts.set(key, { userId, passwordHash, role, displayName });
    let studentId: string | undefined;
    if (role === "student") {
      studentId = crypto.randomUUID();
      this.profiles.set(studentId, { id: studentId, ownerUserId: userId, displayName });
    }
    return { userId, studentId };
  }

  async getAccountByEmail(email: string) {
    const a = this.accounts.get(email.toLowerCase());
    return a ? { userId: a.userId, passwordHash: a.passwordHash, role: a.role } : null;
  }

  async saveToken(tokenHash: string, userId: string) {
    this.tokens.set(tokenHash, { userId, createdAt: new Date() });
  }

  async resolveToken(tokenHash: string) {
    const rec = this.tokens.get(tokenHash);
    if (!rec) return null;
    // 30-day expiry: a stolen or forgotten token doesn't live forever.
    if (Date.now() - rec.createdAt.getTime() > 30 * 24 * 60 * 60 * 1000) {
      this.tokens.delete(tokenHash);
      return null;
    }
    for (const [email, a] of this.accounts) {
      if (a.userId === rec.userId) return { userId: rec.userId, email, role: a.role };
    }
    return null;
  }

  // ---- Trust & retention ----

  async savePushSubscription(userId: string, sub: { endpoint: string; p256dh: string; auth: string }) {
    this.pushSubs.set(sub.endpoint, { userId, ...sub });
  }

  async listPushSubscriptions(userId: string) {
    return [...this.pushSubs.values()]
      .filter((s) => s.userId === userId)
      .map(({ endpoint, p256dh, auth }) => ({ endpoint, p256dh, auth }));
  }

  async deletePushSubscription(endpoint: string) {
    this.pushSubs.delete(endpoint);
  }

  async createPasswordReset(userId: string, tokenHash: string) {
    this.resets.set(tokenHash, { userId, used: false, createdAt: new Date() });
  }

  // ---- Billing & email verification ----

  async createEmailVerification(userId: string, tokenHash: string) {
    this.verifications.set(tokenHash, { userId, used: false, createdAt: new Date() });
  }

  async consumeEmailVerification(tokenHash: string, maxAgeMs: number) {
    const v = this.verifications.get(tokenHash);
    if (!v || v.used || Date.now() - v.createdAt.getTime() > maxAgeMs) return null;
    v.used = true;
    return v.userId;
  }

  async markEmailVerified(userId: string) {
    this.verifiedUsers.add(userId);
  }

  async isEmailVerified(userId: string) {
    return this.verifiedUsers.has(userId);
  }

  async recordSubscription(sub: {
    userId: string;
    provider: string;
    customerRef: string;
    subscriptionRef: string;
    plan: string;
    status: "active" | "canceled";
  }) {
    this.subscriptions.set(`${sub.provider}::${sub.subscriptionRef}`, { ...sub, updatedAt: new Date() });
  }

  async getSubscription(userId: string) {
    const mine = [...this.subscriptions.values()]
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const s = mine[0];
    return s ? { provider: s.provider, plan: s.plan, status: s.status, subscriptionRef: s.subscriptionRef } : null;
  }

  async findSubscriptionByRef(provider: string, ref: { customerRef?: string; subscriptionRef?: string }) {
    for (const s of this.subscriptions.values()) {
      if (s.provider !== provider) continue;
      if (
        (ref.subscriptionRef && s.subscriptionRef === ref.subscriptionRef) ||
        (ref.customerRef && s.customerRef === ref.customerRef)
      ) {
        for (const [email, a] of this.accounts) {
          if (a.userId === s.userId) return { userId: s.userId, email };
        }
      }
    }
    return null;
  }

  async consumePasswordReset(tokenHash: string, maxAgeMs: number) {
    const r = this.resets.get(tokenHash);
    if (!r || r.used || Date.now() - r.createdAt.getTime() > maxAgeMs) return null;
    r.used = true;
    return r.userId;
  }

  async setPassword(userId: string, passwordHash: string) {
    for (const a of this.accounts.values()) if (a.userId === userId) a.passwordHash = passwordHash;
  }

  async revokeUserTokens(userId: string) {
    for (const [hash, rec] of this.tokens) if (rec.userId === userId) this.tokens.delete(hash);
  }

  async deleteAccount(userId: string) {
    const studentIds = [...this.profiles.values()].filter((p) => p.ownerUserId === userId).map((p) => p.id);
    for (const sid of studentIds) {
      this.profiles.delete(sid);
      this.learnerProfiles.delete(sid);
      this.routines.delete(sid);
      this.careContacts.delete(sid);
      this.memories.delete(sid);
      this.mastery.delete(sid);
      this.orgStudents.delete(sid);
      for (const [id, s] of this.sessions) {
        if (s.studentId === sid) {
          this.sessions.delete(id);
          this.sessionMessages.delete(id);
        }
      }
      this.incidents = this.incidents.filter((i) => i.studentId !== sid);
      this.usage = this.usage.filter((u) => u.studentId !== sid);
    }
    this.usage = this.usage.filter((u) => u.userId !== userId);
    for (const [hash, k] of this.apiKeys) if (k.ownerUserId === userId) this.apiKeys.delete(hash);
    for (const [endpoint, s] of this.pushSubs) if (s.userId === userId) this.pushSubs.delete(endpoint);
    for (const [hash, r] of this.resets) if (r.userId === userId) this.resets.delete(hash);
    for (const [hash, v] of this.verifications) if (v.userId === userId) this.verifications.delete(hash);
    for (const [key, s] of this.subscriptions) if (s.userId === userId) this.subscriptions.delete(key);
    this.verifiedUsers.delete(userId);
    await this.revokeUserTokens(userId);
    this.plans.delete(userId);
    for (const [id, o] of this.orgs) if (o.ownerUserId === userId) this.orgs.delete(id);
    for (const [email, a] of this.accounts) if (a.userId === userId) this.accounts.delete(email);
  }

  async listRecentMessages(studentId: string, limit: number) {
    const out: Array<{ role: string; content: string; createdAt: Date }> = [];
    for (const [sessionId, s] of this.sessions) {
      if (s.studentId === studentId) out.push(...(this.sessionMessages.get(sessionId) ?? []));
    }
    return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit).reverse();
  }

  async getStreakDays(studentId: string) {
    const days = new Set(
      [...this.sessions.values()]
        .filter((s) => s.studentId === studentId)
        .map((s) => s.startedAt.toISOString().slice(0, 10)),
    );
    let streak = 0;
    const cursor = new Date();
    if (!days.has(cursor.toISOString().slice(0, 10))) cursor.setDate(cursor.getDate() - 1);
    while (days.has(cursor.toISOString().slice(0, 10))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  async addStudentProfile(parentUserId: string, displayName: string) {
    const id = crypto.randomUUID();
    this.profiles.set(id, { id, ownerUserId: parentUserId, displayName });
    return { id };
  }

  async listStudentProfiles(userId: string) {
    return [...this.profiles.values()]
      .filter((p) => p.ownerUserId === userId)
      .map((p) => ({ id: p.id, displayName: p.displayName }));
  }

  async ownsStudent(userId: string, studentId: string) {
    return this.profiles.get(studentId)?.ownerUserId === userId;
  }

  async getStudentName(studentId: string) {
    return this.profiles.get(studentId)?.displayName ?? null;
  }

  private incidents: Array<{
    studentId: string;
    sessionId?: string;
    direction: "student" | "tutor";
    categories: string[];
    severity: "concern" | "danger";
    excerpt: string;
    createdAt: Date;
  }> = [];

  async recordIncident(incident: {
    studentId: string;
    sessionId?: string;
    direction: "student" | "tutor";
    categories: string[];
    severity: "concern" | "danger";
    excerpt: string;
  }) {
    this.incidents.push({ ...incident, createdAt: new Date() });
  }

  async listIncidents(studentId: string, limit: number) {
    return this.incidents
      .filter((i) => i.studentId === studentId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async listSessionSummaries(studentId: string, limit: number) {
    return [...this.sessions.values()]
      .filter((s) => s.studentId === studentId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit)
      .map((s) => ({
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        summary: s.recap?.summary ?? null,
      }));
  }

  // ---- Business wiring ----

  private usage: Array<{
    userId?: string;
    studentId?: string;
    apiKeyId?: string;
    kind: UsageKind;
    quantity: number;
    createdAt: Date;
  }> = [];
  private plans = new Map<string, string>(); // userId -> plan
  private orgs = new Map<string, { id: string; name: string; ownerUserId: string; seats: number; plan: string }>();
  private orgStudents = new Map<string, string>(); // studentId -> orgId
  private apiKeys = new Map<
    string,
    { id: string; ownerUserId: string; name: string; scopes: string[]; monthlyQuota: number; revoked: boolean }
  >(); // keyHash -> record

  async recordUsage(e: { userId?: string; studentId?: string; apiKeyId?: string; kind: UsageKind; quantity?: number }) {
    this.usage.push({ ...e, quantity: e.quantity ?? 1, createdAt: new Date() });
  }

  async sumUsage(
    subject: { userId?: string; studentId?: string; apiKeyId?: string },
    kind: UsageKind | null,
    since: Date,
  ) {
    return this.usage
      .filter(
        (u) =>
          u.createdAt >= since &&
          (kind === null || u.kind === kind) &&
          ((subject.userId && u.userId === subject.userId) ||
            (subject.studentId && u.studentId === subject.studentId) ||
            (subject.apiKeyId && u.apiKeyId === subject.apiKeyId)),
      )
      .reduce((n, u) => n + u.quantity, 0);
  }

  async getUserPlan(userId: string) {
    return this.plans.get(userId) ?? "free";
  }

  async setUserPlan(email: string, plan: string) {
    const a = this.accounts.get(email.toLowerCase());
    if (!a) return false;
    this.plans.set(a.userId, plan);
    return true;
  }

  async createOrg(ownerUserId: string, name: string, seats: number) {
    const id = crypto.randomUUID();
    this.orgs.set(id, { id, name, ownerUserId, seats, plan: "premium" });
    // Keep parity with PostgresStore: org owners run on the premium plan.
    this.plans.set(ownerUserId, "premium");
    return { id };
  }

  async getOrgByOwner(ownerUserId: string) {
    for (const o of this.orgs.values()) if (o.ownerUserId === ownerUserId) return o;
    return null;
  }

  async addOrgStudents(orgId: string, ownerUserId: string, names: string[]) {
    const out: Array<{ id: string; displayName: string }> = [];
    for (const name of names) {
      const s = await this.addStudentProfile(ownerUserId, name);
      this.orgStudents.set(s.id, orgId);
      out.push({ id: s.id, displayName: name });
    }
    return out;
  }

  async listOrgStudents(orgId: string) {
    const out: Array<{ id: string; displayName: string }> = [];
    for (const [studentId, oid] of this.orgStudents) {
      if (oid === orgId) {
        const p = this.profiles.get(studentId);
        if (p) out.push({ id: p.id, displayName: p.displayName });
      }
    }
    return out;
  }

  async countOrgStudents(orgId: string) {
    return (await this.listOrgStudents(orgId)).length;
  }

  async createApiKey(ownerUserId: string, name: string, keyHash: string, scopes: string[], monthlyQuota = 10_000) {
    const id = crypto.randomUUID();
    this.apiKeys.set(keyHash, { id, ownerUserId, name, scopes, monthlyQuota, revoked: false });
    return { id };
  }

  async resolveApiKey(keyHash: string) {
    const k = this.apiKeys.get(keyHash);
    if (!k || k.revoked) return null;
    return { id: k.id, ownerUserId: k.ownerUserId, scopes: k.scopes, monthlyQuota: k.monthlyQuota };
  }

  async listApiKeys(ownerUserId: string) {
    return [...this.apiKeys.values()]
      .filter((k) => k.ownerUserId === ownerUserId)
      .map(({ id, name, scopes, monthlyQuota, revoked }) => ({ id, name, scopes, monthlyQuota, revoked }));
  }

  async revokeApiKey(ownerUserId: string, keyId: string) {
    for (const k of this.apiKeys.values()) {
      if (k.id === keyId && k.ownerUserId === ownerUserId) {
        k.revoked = true;
        return true;
      }
    }
    return false;
  }
}
