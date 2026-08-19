import type { SessionRecap, Store } from "./types.js";

export class MemoryStore implements Store {
  readonly kind = "memory";
  private students = new Map<string, { id: string; parentEmail?: string }>();
  private memories = new Map<string, Array<{ kind: string; content: string }>>();
  private mastery = new Map<string, Map<string, { level: number; attempts: number }>>();
  private sessions = new Map<string, { studentId: string; recap?: SessionRecap }>();

  async ensureStudent(name: string, parentEmail?: string) {
    const key = name.toLowerCase();
    let s = this.students.get(key);
    if (!s) {
      s = { id: crypto.randomUUID(), parentEmail };
      this.students.set(key, s);
    } else if (parentEmail) {
      s.parentEmail = parentEmail;
    }
    return { id: s.id };
  }

  async createSession(studentId: string, _personaId: string, _packId: string) {
    const id = crypto.randomUUID();
    this.sessions.set(id, { studentId });
    return id;
  }

  async saveMessage() {
    // Live history is held by the session loop; nothing to persist in-memory.
  }

  async endSession(sessionId: string, recap: SessionRecap) {
    const s = this.sessions.get(sessionId);
    if (s) s.recap = recap;
  }

  async getMemories(studentId: string) {
    return (this.memories.get(studentId) ?? []).map((m) => m.content);
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
}
