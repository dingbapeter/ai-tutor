import { createDb, schema, type Db } from "@tutor/db";
import { and, eq } from "drizzle-orm";
import type { SessionRecap, Store } from "./types.js";
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
    const existing = await this.db
      .select({ id: schema.students.id })
      .from(schema.students)
      .where(eq(schema.students.displayName, name))
      .limit(1);
    if (existing.length) return { id: existing[0].id };

    const [user] = await this.db
      .insert(schema.users)
      .values({ email: `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}-${crypto.randomUUID().slice(0, 8)}@students.local` })
      .returning({ id: schema.users.id });

    let parentUserId: string | undefined;
    if (parentEmail) {
      const [parent] = await this.db
        .insert(schema.users)
        .values({ email: parentEmail, role: "parent" })
        .onConflictDoUpdate({ target: schema.users.email, set: { role: "parent" } })
        .returning({ id: schema.users.id });
      parentUserId = parent.id;
    }

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
    const rows = await this.db
      .select({ content: schema.memories.content })
      .from(schema.memories)
      .where(and(eq(schema.memories.studentId, studentId), eq(schema.memories.active, true)));
    return rows.map((r) => r.content);
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
}
