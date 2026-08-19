import type { SessionRecap, Store } from "./types.js";

export class MemoryStore implements Store {
  readonly kind = "memory";
  private students = new Map<string, { id: string; parentEmail?: string }>();
  private memories = new Map<string, Array<{ kind: string; content: string }>>();
  private mastery = new Map<string, Map<string, { level: number; attempts: number }>>();
  private sessions = new Map<
    string,
    { studentId: string; startedAt: Date; endedAt: Date | null; recap?: SessionRecap }
  >();
  private accounts = new Map<
    string,
    { userId: string; passwordHash: string; role: "parent" | "student"; displayName: string }
  >();
  private tokens = new Map<string, string>(); // tokenHash -> userId
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

  async saveMessage() {
    // Live history is held by the session loop; nothing to persist in-memory.
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

  async recordAttempt(studentId: string, skillId: string, correct: boolean) {
    const bySkill = this.mastery.get(studentId) ?? new Map();
    const cur = bySkill.get(skillId) ?? { level: 0, attempts: 0 };
    bySkill.set(skillId, {
      level: 0.7 * cur.level + 0.3 * (correct ? 1 : 0),
      attempts: cur.attempts + 1,
    });
    this.mastery.set(studentId, bySkill);
  }

  async getMasterySnapshot(studentId: string) {
    const bySkill = this.mastery.get(studentId) ?? new Map<string, { level: number }>();
    return [...bySkill.entries()].map(([skillId, v]) => ({ skillId, level: v.level }));
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
    this.tokens.set(tokenHash, userId);
  }

  async resolveToken(tokenHash: string) {
    const userId = this.tokens.get(tokenHash);
    if (!userId) return null;
    for (const [email, a] of this.accounts) {
      if (a.userId === userId) return { userId, email, role: a.role };
    }
    return null;
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
}
