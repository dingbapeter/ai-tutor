import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { AiGateway, ChatMessage } from "@tutor/ai-gateway";
import {
  buildSystemPrompt,
  loadPack,
  loadPersonas,
  PACK_IDS,
  skillTitle,
  UnknownPackError,
} from "./tutor/prompt.js";
import { masteryStage, type LearnerProfile, type Store } from "./store/types.js";
import { verifyAnswer, type Check } from "./mathcheck.js";
import { sendParentRecap, sendSafetyAlert, sendVerifyEmail } from "./email.js";
import { hashPassword, mintToken, userFromRequest, verifyPassword } from "./auth.js";
import { registerBilling } from "./billing.js";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Live conversational state; durable state goes through the Store. */
interface LiveSession {
  id: string;
  studentId: string;
  studentName: string;
  parentEmail?: string;
  personaId: string;
  packId: string;
  history: ChatMessage[];
  /** Serializes generations: two concurrent turns would corrupt history. */
  busy: boolean;
  practiceTotal: number;
  practiceCorrect: number;
  /** Per-skill outcomes this session — feeds the deterministic profile update. */
  skillOutcomes: Map<string, { correct: number; total: number }>;
  /** Whose entitlements govern this session + which key gets metered. */
  ownerUserId?: string;
  apiKeyId?: string;
  plan: string;
  exam?: {
    problemIndexes: number[];
    answers: Map<number, { answer: string; correct: boolean | null }>;
    startedAt: number;
  };
  /** Live-class state: friends sitting in, each paying their own way. */
  inviteCode?: string;
  participants: Map<string, Participant>;
  createdAt: number;
  /** Copied from the API key at session start so quota holds mid-session. */
  apiKeyQuota?: number;
}

export interface PlanLimits {
  dailyMessages: number;
  dailyVoiceTurns: number;
  familySeats: number;
  examMode: boolean;
  premiumBrain: boolean;
  /** How many friends this plan may invite into a live class (0 = none). */
  classInvites: number;
}

/** A friend sitting in on someone's live class. */
interface Participant {
  id: string;
  name: string;
  /** Set when the friend is a signed-in member — their own allowance pays. */
  userId?: string;
  plan: string;
  /** Guests get a taste, not a seat: messages remaining on the class pass. */
  guestMessagesLeft: number;
}

/** Guest class pass: enough to feel the magic, short enough to want more. */
const GUEST_CLASS_MESSAGES = 8;

export interface AppDeps {
  gateway: AiGateway;
  store: Store;
  env?: Record<string, string | undefined>;
  /** Override plan limits (tests); defaults to config/plans.json. */
  plans?: Record<string, PlanLimits>;
}

const MAX_TEXT = 4000;

/**
 * Learning formats — the text-first slice of IDEAS.md #001. The tutor can
 * re-shape an explanation for the student's age and taste with zero extra
 * infrastructure; image/animation formats arrive with the GPU phase.
 */
const FORMATS: Record<string, string> = {
  plain: "",
  story:
    "Explain this as a SHORT STORY with characters and a tiny plot, matched to my age. Keep the math/content correct inside the story.",
  comic:
    "Explain this as a COMIC-STRIP SCRIPT: numbered panels, each with a scene description and dialogue. Keep it fun and the content correct.",
  song: "Explain this as a short catchy SONG or RAP with rhymes I can memorize. Keep the content correct.",
};

/** What the tutor says instead of an LLM reply when input is blocked. */
function safeReply(categories: string[], studentName: string): string {
  if (categories.includes("self-harm") || categories.includes("abuse-disclosure")) {
    return (
      `${studentName}, thank you for trusting me with that — it matters, and YOU matter. ` +
      `I'm a tutor, so the best thing I can do is ask you to share this with a trusted adult — a parent, a teacher, or a counselor — today. ` +
      `You deserve real support from people who care about you. I'm always happy to learn together whenever you're ready.`
    );
  }
  return (
    `Let's keep our session a safe place for learning, ${studentName}. ` +
    `I can't help with that — but I'd love to get back to what we were working on. Ready?`
  );
}

function loadPlans(): Record<string, PlanLimits> {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  return (JSON.parse(readFileSync(join(root, "config/plans.json"), "utf8")) as { plans: Record<string, PlanLimits> }).plans;
}

export async function buildApp({ gateway, store, env = process.env, plans }: AppDeps): Promise<FastifyInstance> {
  const live = new Map<string, LiveSession>();
  const app = Fastify({ logger: env.NODE_ENV !== "test", bodyLimit: 1 << 20 });
  const PLANS = plans ?? loadPlans();
  const limitsFor = (plan: string): PlanLimits => PLANS[plan] ?? PLANS.free;
  // "Daily" allowances use a rolling 24h window: fair in every timezone,
  // instead of resetting at the server's midnight.
  const startOfToday = () => new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Optional error reporting: any webhook-compatible sink (GlitchTip, Slack,
  // Discord). Fire-and-forget; absence of the env var disables it.
  app.addHook("onError", async (req, _reply, error) => {
    if (!env.ERROR_WEBHOOK_URL) return;
    fetch(env.ERROR_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: `API error: ${req.method} ${req.url} — ${error.message}`,
        content: `API error: ${req.method} ${req.url} — ${error.message}`,
      }),
    }).catch(() => {});
  });

  // Guest abuse guard: rotating names for fresh free allowances is capped
  // per IP per day (accounts are the legitimate path past it).
  const guestSessionsByIp = new Map<string, { day: string; count: number }>();
  const GUEST_IP_CAP = Number(env.GUEST_IP_CAP ?? 8);

  /** Pick the brain for a session: premium plans get the premium provider. */
  const chatFor = (session: LiveSession) =>
    limitsFor(session.plan).premiumBrain ? gateway.premiumChat : gateway.chat;

  /**
   * Entitlement gate for metered actions. Returns an error string when the
   * plan's daily allowance is exhausted; null when the action may proceed.
   */
  async function checkAllowance(
    session: LiveSession,
    kind: "message" | "voice_turn",
  ): Promise<string | null> {
    // API-key sessions: the monthly quota holds for the whole session, not
    // just its creation — long-lived sessions can't overrun it.
    if (session.apiKeyId && session.apiKeyQuota !== undefined) {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const used = await store.sumUsage({ apiKeyId: session.apiKeyId }, null, monthStart);
      if (used >= session.apiKeyQuota) {
        return "monthly API quota exhausted — contact us to raise it";
      }
      return null;
    }
    const limits = limitsFor(session.plan);
    const cap = kind === "message" ? limits.dailyMessages : limits.dailyVoiceTurns;
    const subject = session.ownerUserId ? { userId: session.ownerUserId } : { studentId: session.studentId };
    const used = await store.sumUsage(subject, kind, startOfToday());
    if (used >= cap) {
      return kind === "message"
        ? `Daily message limit reached on the ${session.plan} plan — upgrade for more time with your tutor.`
        : `Daily voice limit reached on the ${session.plan} plan — upgrade for more voice time with your tutor.`;
    }
    return null;
  }

  async function meter(session: LiveSession, kind: "message" | "voice_turn" | "tts_chars" | "practice" | "exam", quantity = 1) {
    await store.recordUsage({
      userId: session.ownerUserId,
      studentId: session.studentId,
      apiKeyId: session.apiKeyId,
      kind,
      quantity,
    });
  }

  /**
   * Safety gate for student input. Returns null to let the message through,
   * or the tutor's safe reply when it must not reach the LLM. All flags are
   * logged; danger flags also alert the guardian immediately.
   */
  async function gateStudentInput(session: LiveSession, text: string): Promise<string | null> {
    const verdict = await gateway.moderation.moderate(text, "student");
    if (!verdict.flagged) return null;
    await store.recordIncident({
      studentId: session.studentId,
      sessionId: session.id,
      direction: "student",
      categories: verdict.categories,
      severity: verdict.severity === "danger" ? "danger" : "concern",
      excerpt: text.slice(0, 300),
    });
    if (verdict.severity === "danger") {
      if (session.parentEmail) {
        sendSafetyAlert({
          to: session.parentEmail,
          studentName: session.studentName,
          categories: verdict.categories,
          excerpt: text.slice(0, 300),
        }).catch((err) => app.log.error(err, "safety alert email failed"));
      }
      return safeReply(verdict.categories, session.studentName);
    }
    // Concern-level: jailbreaks and off-color content are blocked from the
    // model too — the canned redirect is safer than trusting the persona.
    return safeReply(verdict.categories, session.studentName);
  }

  /** Post-generation check on tutor output; logs (never retracts mid-stream). */
  async function auditTutorOutput(session: LiveSession, text: string): Promise<void> {
    const verdict = await gateway.moderation.moderate(text, "tutor");
    if (verdict.flagged) {
      await store.recordIncident({
        studentId: session.studentId,
        sessionId: session.id,
        direction: "tutor",
        categories: verdict.categories,
        severity: verdict.severity === "danger" ? "danger" : "concern",
        excerpt: text.slice(0, 300),
      });
      app.log.warn({ categories: verdict.categories }, "tutor output flagged");
    }
  }

  /** TTS cache: identical text+voice never hits the engine twice. */
  const ttsCache = new Map<string, { audio: Uint8Array; mimeType: string }>();
  async function cachedSpeak(text: string, voiceId: string) {
    const key = createHash("sha256").update(`${gateway.tts.name}|${voiceId}|${text}`).digest("hex");
    const hit = ttsCache.get(key);
    if (hit) return hit;
    const result = await gateway.tts.speak(text, voiceId);
    if (ttsCache.size > 500) {
      const oldest = ttsCache.keys().next().value;
      if (oldest) ttsCache.delete(oldest);
    }
    ttsCache.set(key, { audio: result.audio, mimeType: result.mimeType });
    return result;
  }

  // Raw audio uploads for push-to-talk (multipart adds nothing here).
  app.addContentTypeParser(/^audio\/.*/, { parseAs: "buffer" }, (_req, body, done) =>
    done(null, body),
  );

  await app.register(cors, { origin: env.WEB_ORIGIN ?? true });
  await app.register(rateLimit, {
    max: Number(env.RATE_LIMIT_MAX ?? 120),
    timeWindow: "1 minute",
  });

  // ---- Accounts & auth ----

  const credentialsSchema = {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email", maxLength: 254 },
      password: { type: "string", minLength: 8, maxLength: 128 },
      displayName: { type: "string", minLength: 1, maxLength: 80 },
      role: { type: "string", enum: ["parent", "student"] },
    },
  };

  app.post<{ Body: { email: string; password: string; displayName?: string; role?: "parent" | "student" } }>(
    "/auth/register",
    { schema: { body: { ...credentialsSchema, additionalProperties: false } }, config: { rateLimit: { max: Number(env.AUTH_RATE_LIMIT ?? 10), timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { email, password, displayName, role } = req.body;
      const account = await store.createAccount(
        email,
        await hashPassword(password),
        role ?? "parent",
        displayName?.trim() || email.split("@")[0],
      );
      if (!account) return reply.code(409).send({ error: "that email is already registered" });
      const token = mintToken();
      await store.saveToken(token.hash, account.userId);
      // Email verification: fire-and-forget so signup never blocks on SMTP.
      const rawVerify = randomBytes(24).toString("hex");
      await store.createEmailVerification(account.userId, createHash("sha256").update(rawVerify).digest("hex"));
      sendVerifyEmail(email, rawVerify).catch((err) => app.log.error(err, "verify email failed"));
      return { token: token.raw, role: role ?? "parent", studentId: account.studentId ?? null };
    },
  );

  app.post<{ Body: { token: string } }>(
    "/auth/verify",
    {
      schema: {
        body: {
          type: "object",
          required: ["token"],
          additionalProperties: false,
          properties: { token: { type: "string", minLength: 32, maxLength: 128 } },
        },
      },
      config: { rateLimit: { max: Number(env.AUTH_RATE_LIMIT ?? 10), timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const userId = await store.consumeEmailVerification(
        createHash("sha256").update(req.body.token).digest("hex"),
        24 * 60 * 60 * 1000,
      );
      if (!userId) return reply.code(400).send({ error: "that verification link is invalid or expired — request a new one" });
      await store.markEmailVerified(userId);
      return { verified: true };
    },
  );

  app.post("/auth/resend-verification", { config: { rateLimit: { max: Number(env.AUTH_RATE_LIMIT ?? 5), timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = await userFromRequest(req, store);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (await store.isEmailVerified(user.userId)) return { alreadyVerified: true };
    const raw = randomBytes(24).toString("hex");
    await store.createEmailVerification(user.userId, createHash("sha256").update(raw).digest("hex"));
    sendVerifyEmail(user.email, raw).catch((err) => app.log.error(err, "verify email failed"));
    return { sent: true };
  });

  app.post<{ Body: { email: string; password: string } }>(
    "/auth/login",
    { schema: { body: { ...credentialsSchema, additionalProperties: false } }, config: { rateLimit: { max: Number(env.AUTH_RATE_LIMIT ?? 10), timeWindow: "1 minute" } } },
    async (req, reply) => {
      const account = await store.getAccountByEmail(req.body.email);
      const ok = account && (await verifyPassword(req.body.password, account.passwordHash));
      // Same response for unknown email and wrong password — no account probing.
      if (!ok) return reply.code(401).send({ error: "invalid email or password" });
      const token = mintToken();
      await store.saveToken(token.hash, account.userId);
      return { token: token.raw, role: account.role };
    },
  );

  app.get("/me", async (req, reply) => {
    const user = await userFromRequest(req, store);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    return {
      email: user.email,
      role: user.role,
      emailVerified: await store.isEmailVerified(user.userId),
      students: await store.listStudentProfiles(user.userId),
    };
  });

  app.post<{ Body: { displayName: string } }>(
    "/students",
    {
      schema: {
        body: {
          type: "object",
          required: ["displayName"],
          additionalProperties: false,
          properties: { displayName: { type: "string", minLength: 1, maxLength: 80 } },
        },
      },
    },
    async (req, reply) => {
      const user = await userFromRequest(req, store);
      if (!user) return reply.code(401).send({ error: "sign in required" });
      const plan = await store.getUserPlan(user.userId);
      const existing = await store.listStudentProfiles(user.userId);
      if (existing.length >= limitsFor(plan).familySeats) {
        return reply.code(402).send({
          error: `The ${plan} plan includes ${limitsFor(plan).familySeats} student ${limitsFor(plan).familySeats === 1 ? "seat" : "seats"} — upgrade for a bigger family.`,
          upgrade: true,
        });
      }
      const student = await store.addStudentProfile(user.userId, req.body.displayName.trim());
      return { id: student.id, displayName: req.body.displayName.trim() };
    },
  );

  /** Parent dashboard: per student — recent sessions with recaps + mastery. */
  app.get("/dashboard", async (req, reply) => {
    const user = await userFromRequest(req, store);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    const students = await store.listStudentProfiles(user.userId);
    return {
      students: await Promise.all(
        students.map(async (s) => ({
          ...s,
          sessions: await store.listSessionSummaries(s.id, 5),
          mastery: (await store.getMasterySnapshot(s.id)).map((m) => ({
            skillId: m.skillId,
            title: skillTitle(m.skillId),
            level: m.level,
            stage: masteryStage(m),
            due: m.dueAt != null && m.dueAt.getTime() <= Date.now(),
          })),
          safety: await store.listIncidents(s.id, 10),
          streakDays: await store.getStreakDays(s.id),
          profile: await store.getProfile(s.id),
        })),
      ),
    };
  });

  /** Spaced-review queue: what this student should warm up on next. */
  app.get<{ Params: { id: string } }>("/students/:id/review", async (req, reply) => {
    const user = await userFromRequest(req, store);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!(await store.ownsStudent(user.userId, req.params.id))) {
      return reply.code(403).send({ error: "that student is not in your family" });
    }
    const due = await store.getDueSkills(req.params.id, 10);
    return {
      due: due.map((d) => ({
        skillId: d.skillId,
        title: skillTitle(d.skillId),
        level: d.level,
        dueAt: d.dueAt,
      })),
    };
  });

  /** The Dingba Brain, readable by whoever owns the student. */
  app.get<{ Params: { id: string } }>("/students/:id/profile", async (req, reply) => {
    const user = await userFromRequest(req, store);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!(await store.ownsStudent(user.userId, req.params.id))) {
      return reply.code(403).send({ error: "that student is not in your family" });
    }
    return {
      profile: await store.getProfile(req.params.id),
      mastery: (await store.getMasterySnapshot(req.params.id)).map((m) => ({
        skillId: m.skillId,
        title: skillTitle(m.skillId),
        level: m.level,
        stage: masteryStage(m),
        due: m.dueAt != null && m.dueAt.getTime() <= Date.now(),
      })),
    };
  });

  // Live sessions are in-memory conversation state; sweep abandoned ones so a
  // long-running server doesn't accumulate them forever.
  const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
  const sweeper = setInterval(() => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [id, s] of live) if (s.createdAt < cutoff && !s.busy) live.delete(id);
  }, 10 * 60 * 1000);
  sweeper.unref?.();
  app.addHook("onClose", async () => clearInterval(sweeper));

  app.get("/health", async () => ({
    ok: true,
    store: store.kind,
    providers: {
      chat: gateway.chat.name,
      planner: gateway.planner.name,
      stt: gateway.stt.name,
      tts: gateway.tts.name,
      vision: gateway.vision.name,
    },
  }));

  app.get("/credits", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
    return JSON.parse(readFileSync(join(root, "config/credits.json"), "utf8"));
  });

  app.get("/personas", async () =>
    loadPersonas().map(({ id, name, style, voiceId, color, accent }) => ({
      id,
      name,
      style,
      voiceId,
      color,
      accent,
    })),
  );

  app.get("/packs", async () =>
    PACK_IDS.map((id) => {
      const p = loadPack(id);
      return { id: p.id, title: p.title, vertical: p.vertical, description: p.description };
    }),
  );

  /** Practice problems, sanitized — answers and misconception tables never leave the server. */
  app.get<{ Params: { packId: string } }>("/packs/:packId/problems", async (req, reply) => {
    try {
      const pack = loadPack(req.params.packId);
      return pack.problems.map((p, i) => ({
        index: i,
        skillId: p.skillId,
        prompt: p.prompt,
        timeLimitSec: p.timeLimitSec ?? null,
      }));
    } catch (err) {
      if (err instanceof UnknownPackError) return reply.code(404).send({ error: err.message });
      throw err;
    }
  });

  app.post<{
    Body: {
      studentName?: string;
      studentId?: string;
      personaId: string;
      packId: string;
      parentEmail?: string;
    };
  }>(
    "/sessions",
    {
      schema: {
        body: {
          type: "object",
          required: ["personaId", "packId"],
          additionalProperties: false,
          properties: {
            // Guest flow: a name (+ optional parent email). Account flow: a
            // studentId owned by the signed-in account.
            studentName: { type: "string", minLength: 1, maxLength: 80 },
            studentId: { type: "string", format: "uuid" },
            personaId: { type: "string", maxLength: 40 },
            packId: { type: "string", maxLength: 40 },
            parentEmail: { type: "string", format: "email", maxLength: 254 },
          },
        },
      },
    },
    async (req, reply) => {
      const { personaId, packId } = req.body;
      const persona = loadPersonas().find((p) => p.id === personaId);
      if (!persona) return reply.code(400).send({ error: `unknown persona: ${personaId}` });

      let pack;
      try {
        pack = loadPack(packId);
      } catch (err) {
        if (err instanceof UnknownPackError) return reply.code(400).send({ error: err.message });
        throw err;
      }

      let studentIdResolved: string;
      let studentName: string;
      let parentEmail: string | undefined;
      let ownerUserId: string | undefined;
      let apiKeyId: string | undefined;
      let apiKeyQuota: number | undefined;
      let plan = "free";

      // B2B path: Tutor-as-a-Service via X-Api-Key (guest-style body, metered per key).
      const rawKey = req.headers["x-api-key"];
      if (typeof rawKey === "string" && rawKey) {
        const key = await store.resolveApiKey(createHash("sha256").update(rawKey).digest("hex"));
        if (!key) return reply.code(401).send({ error: "invalid API key" });
        if (!key.scopes.includes("tutor")) return reply.code(403).send({ error: "key lacks 'tutor' scope" });
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const used = await store.sumUsage({ apiKeyId: key.id }, null, monthStart);
        if (used >= key.monthlyQuota) {
          return reply.code(429).send({ error: "monthly API quota exhausted — contact us to raise it" });
        }
        apiKeyId = key.id;
        ownerUserId = key.ownerUserId;
        plan = "premium"; // API traffic is paid traffic: full capabilities, metered per call
        await store.recordUsage({ apiKeyId: key.id, kind: "api_call" });
        apiKeyQuota = key.monthlyQuota;
      }

      if (req.body.studentId) {
        const user = await userFromRequest(req, store);
        if (!user) return reply.code(401).send({ error: "sign in required" });
        if (!(await store.ownsStudent(user.userId, req.body.studentId))) {
          return reply.code(403).send({ error: "that student is not in your family" });
        }
        studentIdResolved = req.body.studentId;
        studentName = (await store.getStudentName(studentIdResolved)) ?? "Student";
        // Recaps go to the parent account's inbox; adult learners get their own.
        parentEmail = user.email.endsWith("@students.local") ? undefined : user.email;
        ownerUserId = user.userId;
        plan = await store.getUserPlan(user.userId);
      } else if (req.body.studentName) {
        if (!apiKeyId) {
          const day = new Date().toISOString().slice(0, 10);
          const rec = guestSessionsByIp.get(req.ip);
          const count = rec?.day === day ? rec.count : 0;
          if (count >= GUEST_IP_CAP) {
            return reply.code(429).send({ error: "daily guest limit for this network reached — create a free account to keep learning" });
          }
          guestSessionsByIp.set(req.ip, { day, count: count + 1 });
          if (guestSessionsByIp.size > 50_000) guestSessionsByIp.clear();
        }
        const student = await store.ensureStudent(req.body.studentName.trim(), req.body.parentEmail);
        studentIdResolved = student.id;
        studentName = req.body.studentName.trim();
        parentEmail = req.body.parentEmail;
      } else {
        return reply.code(400).send({ error: "provide studentName (guest) or studentId (account)" });
      }

      const memoryLines = await store.getMemories(studentIdResolved);
      const learnerProfile = await store.getProfile(studentIdResolved);
      // Spaced review: due skills from THIS pack surface as session warm-ups.
      const due = await store.getDueSkills(studentIdResolved, 10);
      const warmupSkills = due
        .map((d) => pack.skills.find((s) => s.id === d.skillId)?.title)
        .filter((t): t is string => Boolean(t))
        .slice(0, 3);
      const sessionId = await store.createSession(studentIdResolved, personaId, packId);

      live.set(sessionId, {
        id: sessionId,
        studentId: studentIdResolved,
        studentName,
        parentEmail,
        personaId,
        packId,
        history: [
          { role: "system", content: buildSystemPrompt({ persona, pack, studentName, memoryLines, profile: learnerProfile, warmupSkills }) },
        ],
        busy: false,
        practiceTotal: 0,
        practiceCorrect: 0,
        skillOutcomes: new Map(),
        ownerUserId,
        apiKeyId,
        plan,
        participants: new Map(),
        createdAt: Date.now(),
        apiKeyQuota,
      });
      // A live tutor speaks first. Generate the opening line in-character;
      // if the model stalls or fails, a warm deterministic line covers it.
      const session = live.get(sessionId)!;
      const greetInstruction = memoryLines.length
        ? `[${studentName} has just walked into the session. Greet them warmly by name in one or two short sentences, in your own voice, touching on one thing you remember about them, then ask what they'd like to start with. No lists.]`
        : `[${studentName} has just walked into their first session with you. Greet them warmly by name in one or two short sentences, introduce yourself in your own voice, and ask one easy question to get started. No lists.]`;
      let greeting = "";
      try {
        const signal = AbortSignal.timeout(8000);
        for await (const delta of chatFor(session).chat(
          [...session.history, { role: "user", content: greetInstruction }],
          { signal },
        )) {
          greeting += delta;
        }
      } catch {
        greeting = "";
      }
      if (!greeting.trim()) {
        greeting = memoryLines.length
          ? `Welcome back, ${studentName}! Ready to pick up where we left off?`
          : `Hi ${studentName}, I'm ${persona.name}. Glad you're here. What would you like to start with today?`;
      }
      greeting = greeting.trim();
      session.history.push({ role: "assistant", content: greeting });
      await store.saveMessage(sessionId, "assistant", greeting);
      auditTutorOutput(session, greeting).catch((err) => app.log.error(err));

      return {
        sessionId,
        persona: { id: persona.id, name: persona.name },
        pack: pack.title,
        remembered: memoryLines.length,
        greeting,
      };
    },
  );

  /** Student turn in, tutor reply streamed out as SSE. */
  app.post<{ Params: { id: string }; Body: { text: string; format?: string; participantId?: string } }>(
    "/sessions/:id/message",
    {
      schema: {
        body: {
          type: "object",
          required: ["text"],
          additionalProperties: false,
          properties: {
            text: { type: "string", minLength: 1, maxLength: MAX_TEXT },
            format: { type: "string", enum: Object.keys(FORMATS) },
            participantId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (req, reply) => {
      const session = live.get(req.params.id);
      if (!session) return reply.code(404).send({ error: "no such session" });
      if (session.busy) return reply.code(409).send({ error: "tutor is already responding" });

      // Who's speaking, and whose allowance pays for it.
      let speaker = session.studentName;
      if (req.body.participantId) {
        const p = session.participants.get(req.body.participantId);
        if (!p) return reply.code(404).send({ error: "you're not in this class" });
        speaker = p.name;
        if (p.userId) {
          // A member friend: their own plan's allowance pays.
          const used = await store.sumUsage({ userId: p.userId }, "message", startOfToday());
          if (used >= limitsFor(p.plan).dailyMessages) {
            return reply.code(402).send({ error: `Your daily allowance on the ${p.plan} plan is used up — upgrade for more class time.`, upgrade: true });
          }
          await store.recordUsage({ userId: p.userId, studentId: session.studentId, kind: "message" });
        } else {
          // A guest on a class pass: a taste, then the invitation to stay.
          if (p.guestMessagesLeft <= 0) {
            return reply.code(402).send({
              error: `Your free class pass with ${session.studentName} is used up — join as a member to keep learning together.`,
              upgrade: true,
            });
          }
          p.guestMessagesLeft -= 1;
          await store.recordUsage({ studentId: session.studentId, kind: "message" });
        }
        session.busy = true;
      } else {
        const capped = await checkAllowance(session, "message");
        if (capped) return reply.code(402).send({ error: capped, upgrade: true });
        session.busy = true;
        await meter(session, "message");
      }

      const blocked = await gateStudentInput(session, req.body.text);
      if (blocked) {
        session.busy = false;
        session.history.push({ role: "user", content: "[message withheld by safety filter]" });
        session.history.push({ role: "assistant", content: blocked });
        await store.saveMessage(session.id, "user", "[message withheld by safety filter]");
        await store.saveMessage(session.id, "assistant", blocked);
        // Same SSE shape as a normal reply so the client needs no special case.
        reply.raw.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
          "access-control-allow-origin": env.WEB_ORIGIN ?? "*",
        });
        reply.raw.write(`data: ${JSON.stringify({ delta: blocked })}\n\n`);
        reply.raw.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        reply.raw.end();
        return;
      }

      const formatNote = FORMATS[req.body.format ?? "plain"];
      let turnText = formatNote ? `${req.body.text}\n\n[${formatNote}]` : req.body.text;
      // In a group class every line is attributed so the tutor tracks voices.
      if (session.participants.size > 0) turnText = `${speaker}: ${turnText}`;
      session.history.push({ role: "user", content: turnText });
      await store.saveMessage(session.id, "user", turnText);

      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "access-control-allow-origin": env.WEB_ORIGIN ?? "*",
      });

      const abort = new AbortController();
      // Client-disconnect detection belongs on the response: the request stream's
      // "close" fires as soon as the body is fully read, not on disconnect.
      reply.raw.on("close", () => {
        if (!reply.raw.writableEnded) abort.abort();
      });

      let full = "";
      try {
        for await (const delta of chatFor(session).chat(session.history, { signal: abort.signal })) {
          full += delta;
          reply.raw.write(`data: ${JSON.stringify({ delta })}\n\n`);
        }
        session.history.push({ role: "assistant", content: full });
        await store.saveMessage(session.id, "assistant", full);
        reply.raw.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        auditTutorOutput(session, full).catch((err) => app.log.error(err));
      } catch (err) {
        app.log.error(err);
        // Keep the user's turn and any partial reply so the conversation
        // survives a provider hiccup instead of silently losing context.
        if (full) session.history.push({ role: "assistant", content: full });
        reply.raw.write(`data: ${JSON.stringify({ error: "generation failed" })}\n\n`);
      } finally {
        session.busy = false;
      }
      reply.raw.end();
    },
  );

  /**
   * Practice answer: SymPy verifies, mastery updates, and the tutor responds
   * in character — armed with the verified verdict and, on a known wrong
   * answer, the misconception diagnosis from the curriculum.
   */
  app.post<{ Params: { id: string }; Body: { problemIndex: number; answer: string } }>(
    "/sessions/:id/practice",
    {
      schema: {
        body: {
          type: "object",
          required: ["problemIndex", "answer"],
          additionalProperties: false,
          properties: {
            problemIndex: { type: "integer", minimum: 0, maximum: 10_000 },
            answer: { type: "string", minLength: 1, maxLength: 500 },
          },
        },
      },
    },
    async (req, reply) => {
      const session = live.get(req.params.id);
      if (!session) return reply.code(404).send({ error: "no such session" });
      if (session.busy) return reply.code(409).send({ error: "tutor is already responding" });
      const pack = loadPack(session.packId);
      const problem = pack.problems[req.body.problemIndex];
      if (!problem) return reply.code(400).send({ error: "unknown problem" });
      session.busy = true;

      try {
        const answer = req.body.answer.trim();
        let correct = await verifyAnswer(problem.check as Check, answer);
        if (correct === null && problem.answer !== undefined) {
          correct = answer.replace(/\s/g, "") === String(problem.answer).replace(/\s/g, "");
        }

        if (correct !== null && problem.skillId) {
          await store.recordAttempt(session.studentId, String(problem.skillId), correct);
          session.practiceTotal += 1;
          if (correct) session.practiceCorrect += 1;
          const o = session.skillOutcomes.get(String(problem.skillId)) ?? { correct: 0, total: 0 };
          o.total += 1;
          if (correct) o.correct += 1;
          session.skillOutcomes.set(String(problem.skillId), o);
        }
        await meter(session, "practice");

        const diagnosis =
          correct === false
            ? problem.misconceptions?.find(
                (m) => m.answer.replace(/\s/g, "") === answer.replace(/\s/g, ""),
              )?.diagnosis
            : undefined;

        const verdictNote =
          correct === null
            ? `The answer could not be machine-verified; judge it yourself carefully.`
            : `VERIFIED (symbolic math check): the answer is ${correct ? "CORRECT" : "INCORRECT"}.` +
              (diagnosis ? ` Known misconception behind this exact wrong answer: ${diagnosis}` : "");

        session.history.push({
          role: "user",
          content: `[practice] Problem: "${problem.prompt}" — my answer: ${answer}\n(${verdictNote} Respond as the tutor: if correct, confirm briefly and stretch me one step further; if wrong, do NOT reveal the answer — use the diagnosis to ask the question that exposes my mistake.)`,
        });

        let feedback = "";
        for await (const delta of chatFor(session).chat(session.history, {
          signal: AbortSignal.timeout(120_000),
        }))
          feedback += delta;
        session.history.push({ role: "assistant", content: feedback });
        await store.saveMessage(session.id, "assistant", feedback);

        return { correct, feedback };
      } finally {
        session.busy = false;
      }
    },
  );

  /**
   * Push-to-talk: one round trip. Raw audio in (Content-Type: audio/*) →
   * STT transcript → tutor reply → TTS audio back, all in a single JSON
   * response so the client stays simple and the turn feels like a call.
   */
  app.post<{ Params: { id: string } }>(
    "/sessions/:id/voice",
    { bodyLimit: 4 << 20 },
    async (req, reply) => {
      const session = live.get(req.params.id);
      if (!session) return reply.code(404).send({ error: "no such session" });
      if (session.busy) return reply.code(409).send({ error: "tutor is already responding" });
      const audioIn = req.body as Buffer;
      if (!Buffer.isBuffer(audioIn) || audioIn.length === 0) {
        return reply.code(400).send({ error: "send raw audio with an audio/* content-type" });
      }
      const capped = await checkAllowance(session, "voice_turn");
      if (capped) return reply.code(402).send({ error: capped, upgrade: true });
      session.busy = true;
      await meter(session, "voice_turn");

      try {
        const mime = req.headers["content-type"] ?? "audio/webm";
        const transcript = (
          await gateway.stt.transcribe(new Uint8Array(audioIn), mime)
        ).trim();
        if (!transcript) {
          return reply.code(422).send({ error: "could not hear anything in that recording" });
        }

        const persona = loadPersonas().find((p) => p.id === session.personaId)!;

        const blocked = await gateStudentInput(session, transcript);
        let replyText: string;
        if (blocked) {
          replyText = blocked;
          session.history.push({ role: "user", content: "[message withheld by safety filter]" });
          session.history.push({ role: "assistant", content: replyText });
          await store.saveMessage(session.id, "user", "[message withheld by safety filter]");
          await store.saveMessage(session.id, "assistant", replyText);
        } else {
          session.history.push({ role: "user", content: transcript });
          await store.saveMessage(session.id, "user", transcript);

          replyText = "";
          for await (const delta of chatFor(session).chat(session.history, {
            signal: AbortSignal.timeout(120_000),
          }))
            replyText += delta;
          session.history.push({ role: "assistant", content: replyText });
          await store.saveMessage(session.id, "assistant", replyText);
          auditTutorOutput(session, replyText).catch((err) => app.log.error(err));
        }

        // TTS engines have input caps; a long reply gets its head spoken and
        // the full text still arrives for the transcript view.
        await meter(session, "tts_chars", Math.min(replyText.length, 2000));
        const spoken = await cachedSpeak(replyText.slice(0, 2000), persona.voiceId);

        return {
          transcript,
          reply: replyText,
          audio: Buffer.from(spoken.audio).toString("base64"),
          audioMime: spoken.mimeType,
        };
      } finally {
        session.busy = false;
      }
    },
  );

  /** Voice note for a tutor message (async TTS — Phase 0 voice). */
  app.post<{ Body: { text: string; personaId: string } }>(
    "/tts",
    {
      schema: {
        body: {
          type: "object",
          required: ["text", "personaId"],
          additionalProperties: false,
          properties: {
            text: { type: "string", minLength: 1, maxLength: 2000 },
            personaId: { type: "string", maxLength: 40 },
          },
        },
      },
    },
    async (req, reply) => {
      const persona = loadPersonas().find((p) => p.id === req.body.personaId);
      if (!persona) return reply.code(400).send({ error: "unknown persona" });
      const result = await cachedSpeak(req.body.text, persona.voiceId);
      reply.header("content-type", result.mimeType);
      return reply.send(Buffer.from(result.audio));
    },
  );

  /**
   * End session: planner writes the recap and extracts memory lines for the
   * learner model; parent gets the recap by email (mailcow) when we have one.
   */
  app.post<{ Params: { id: string } }>("/sessions/:id/end", async (req, reply) => {
    const session = live.get(req.params.id);
    if (!session) return reply.code(404).send({ error: "no such session" });
    live.delete(session.id); // claim it — a double /end must 404, not double-email
    const persona = loadPersonas().find((p) => p.id === session.personaId)!;

    let recap = "";
    for await (const delta of gateway.planner.chat(
      [
        ...session.history,
        {
          role: "user",
          content:
            "SESSION OVER. As the tutor, write a short recap for the student's parent: 2-sentence summary, what the student struggled with, what they did well, what to focus on next session. Plain text, warm but concrete.",
        },
      ],
      { signal: AbortSignal.timeout(120_000) },
    ))
      recap += delta;

    let memoryRaw = "";
    for await (const delta of gateway.planner.chat(
      [
        ...session.history,
        {
          role: "user",
          content:
            "Extract up to 3 short memory lines about this student worth remembering for future sessions (skills shaky/strong, goals, personal details they shared). One per line, no bullets, no commentary. If nothing worth remembering, reply NONE.",
        },
      ],
      { signal: AbortSignal.timeout(120_000) },
    ))
      memoryRaw += delta;

    // The memory promise must not depend on model quality: always store a
    // deterministic line built from facts the server itself observed, then
    // let model-extracted lines enrich it.
    const pack = loadPack(session.packId);
    const factual =
      `Last session: worked on "${pack.title}"` +
      (session.practiceTotal > 0
        ? `; practice ${session.practiceCorrect}/${session.practiceTotal} correct`
        : "") +
      ` (${session.history.filter((m) => m.role === "user").length} student turns).`;
    await store.addMemory(session.studentId, "academic", factual);

    for (const line of memoryRaw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && l.toUpperCase() !== "NONE" && l.length <= 300)
      .slice(0, 3)) {
      await store.addMemory(session.studentId, "academic", line);
    }

    // The Dingba Brain: merge structured profile observations. Deterministic
    // part first — per-skill verdicts the server itself verified this session.
    const observed: Required<Pick<LearnerProfile, "strengths" | "strugglingWith">> = {
      strengths: [],
      strugglingWith: [],
    };
    for (const [skillId, o] of session.skillOutcomes) {
      if (o.total < 2) continue;
      const title = pack.skills.find((s) => s.id === skillId)?.title ?? skillId;
      if (o.correct / o.total >= 0.75) observed.strengths.push(title);
      else if (o.correct / o.total <= 0.4) observed.strugglingWith.push(title);
    }

    // Model-extracted part: strict JSON, quietly skipped when the model can't
    // comply — the profile never depends on model quality, only gains from it.
    let extracted: Partial<LearnerProfile> = {};
    try {
      let raw = "";
      for await (const delta of gateway.planner.chat(
        [
          ...session.history,
          {
            role: "user",
            content:
              'From this session only, update the student\'s learning profile. Reply with ONLY this JSON, no other text: {"goals":[],"strengths":[],"strugglingWith":[],"interests":[],"preferences":[]}. Up to 2 short items per list, only things clearly evidenced in the conversation. Empty lists are fine.',
          },
        ],
        { signal: AbortSignal.timeout(60_000) },
      ))
        raw += delta;
      const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Record<string, unknown>;
      const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
      extracted = {
        goals: list(parsed.goals),
        strengths: list(parsed.strengths),
        strugglingWith: list(parsed.strugglingWith),
        interests: list(parsed.interests),
        preferences: list(parsed.preferences),
      };
    } catch {
      // best-effort enrichment; the deterministic part always lands
    }
    await store.updateProfile(session.studentId, {
      goals: extracted.goals ?? [],
      strengths: [...observed.strengths, ...(extracted.strengths ?? [])],
      strugglingWith: [...observed.strugglingWith, ...(extracted.strugglingWith ?? [])],
      interests: extracted.interests ?? [],
      preferences: extracted.preferences ?? [],
    });

    await store.endSession(session.id, { summary: recap, nextFocus: "" });

    let emailStatus: "sent" | "skipped" | "failed" = "skipped";
    if (session.parentEmail) {
      try {
        emailStatus = await sendParentRecap({
          to: session.parentEmail,
          studentName: session.studentName,
          tutorName: persona.name,
          recap,
        });
      } catch (err) {
        app.log.error(err, "parent recap email failed");
        emailStatus = "failed";
      }
    }

    return {
      recap,
      turns: session.history.filter((m) => m.role !== "system").length,
      emailStatus,
      mastery: await store.getMasterySnapshot(session.studentId),
    };
  });

  // ---- Live class invites: bring your friends, everyone pays their own way ----

  /** Host mints an invite code (paid plans only; capped seats per plan). */
  app.post<{ Params: { id: string } }>("/sessions/:id/invite", async (req, reply) => {
    const session = live.get(req.params.id);
    if (!session) return reply.code(404).send({ error: "no such session" });
    const seats = limitsFor(session.plan).classInvites;
    if (seats === 0) {
      return reply.code(402).send({
        error: "Inviting friends to a live class is for members — upgrade to learn together.",
        upgrade: true,
      });
    }
    session.inviteCode ??= randomBytes(4).toString("hex");
    return { code: session.inviteCode, seats, seatsUsed: session.participants.size };
  });

  /** A friend joins with the code — as a member (their plan pays) or a guest (class pass). */
  app.post<{ Body: { code: string; guestName?: string } }>(
    "/sessions/join",
    {
      schema: {
        body: {
          type: "object",
          required: ["code"],
          additionalProperties: false,
          properties: {
            code: { type: "string", minLength: 4, maxLength: 16 },
            guestName: { type: "string", minLength: 1, maxLength: 80 },
          },
        },
      },
    },
    async (req, reply) => {
      const session = [...live.values()].find((s) => s.inviteCode === req.body.code);
      if (!session) return reply.code(404).send({ error: "that class code isn't live" });
      if (session.participants.size >= limitsFor(session.plan).classInvites) {
        return reply.code(409).send({ error: "this class is full" });
      }

      const user = await userFromRequest(req, store);
      const participant: Participant = user
        ? {
            id: crypto.randomUUID(),
            name: (await store.listStudentProfiles(user.userId))[0]?.displayName ?? user.email.split("@")[0],
            userId: user.userId,
            plan: await store.getUserPlan(user.userId),
            guestMessagesLeft: Number.MAX_SAFE_INTEGER, // members draw from their own allowance
          }
        : {
            id: crypto.randomUUID(),
            name: (req.body.guestName ?? "Guest").trim(),
            plan: "free",
            guestMessagesLeft: GUEST_CLASS_MESSAGES,
          };
      session.participants.set(participant.id, participant);
      session.history.push({
        role: "user",
        content: `[${participant.name} just joined the class as ${session.studentName}'s friend — welcome them warmly in one sentence when you next speak, and from now on address students by name.]`,
      });
      const persona = loadPersonas().find((p) => p.id === session.personaId)!;
      return {
        participantId: participant.id,
        sessionId: session.id,
        host: session.studentName,
        member: Boolean(user),
        guestMessages: user ? null : GUEST_CLASS_MESSAGES,
        persona: { id: persona.id, name: persona.name },
        pack: loadPack(session.packId).title,
      };
    },
  );

  // ---- Exam mode (premium): timed mock, silent grading, post-mortem ----

  app.post<{ Params: { id: string } }>("/sessions/:id/exam/start", async (req, reply) => {
    const session = live.get(req.params.id);
    if (!session) return reply.code(404).send({ error: "no such session" });
    if (!limitsFor(session.plan).examMode) {
      return reply.code(402).send({ error: "Exam mode is a premium feature — upgrade to unlock timed mocks with a full post-mortem.", upgrade: true });
    }
    if (session.exam) return reply.code(409).send({ error: "an exam is already in progress" });
    const pack = loadPack(session.packId);
    const problemIndexes = pack.problems
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.skillId)
      .slice(0, 8)
      .map(({ i }) => i);
    if (problemIndexes.length === 0) return reply.code(400).send({ error: "this pack has no exam problems" });
    session.exam = { problemIndexes, answers: new Map(), startedAt: Date.now() };
    await meter(session, "exam");
    return {
      problems: problemIndexes.map((i) => ({
        index: i,
        prompt: pack.problems[i].prompt,
        timeLimitSec: pack.problems[i].timeLimitSec ?? 90,
      })),
      totalTimeSec: problemIndexes.reduce((n, i) => n + (pack.problems[i].timeLimitSec ?? 90), 0),
    };
  });

  app.post<{ Params: { id: string }; Body: { problemIndex: number; answer: string } }>(
    "/sessions/:id/exam/answer",
    {
      schema: {
        body: {
          type: "object",
          required: ["problemIndex", "answer"],
          additionalProperties: false,
          properties: {
            problemIndex: { type: "integer", minimum: 0 },
            answer: { type: "string", minLength: 1, maxLength: 500 },
          },
        },
      },
    },
    async (req, reply) => {
      const session = live.get(req.params.id);
      if (!session?.exam) return reply.code(404).send({ error: "no exam in progress" });
      if (!session.exam.problemIndexes.includes(req.body.problemIndex)) {
        return reply.code(400).send({ error: "not part of this exam" });
      }
      const problem = loadPack(session.packId).problems[req.body.problemIndex];
      const answer = req.body.answer.trim();
      let correct = await verifyAnswer(problem.check as Check, answer);
      if (correct === null && problem.answer !== undefined) {
        correct = answer.replace(/\s/g, "") === String(problem.answer).replace(/\s/g, "");
      }
      // Exam conditions: verdicts stay sealed until the post-mortem.
      session.exam.answers.set(req.body.problemIndex, { answer, correct });
      return { received: true, answered: session.exam.answers.size, of: session.exam.problemIndexes.length };
    },
  );

  app.post<{ Params: { id: string } }>("/sessions/:id/exam/finish", async (req, reply) => {
    const session = live.get(req.params.id);
    if (!session?.exam) return reply.code(404).send({ error: "no exam in progress" });
    const pack = loadPack(session.packId);
    const exam = session.exam;
    session.exam = undefined;

    const results = exam.problemIndexes.map((i) => {
      const p = pack.problems[i];
      const a = exam.answers.get(i);
      return { index: i, prompt: p.prompt, skillId: p.skillId, answer: a?.answer ?? null, correct: a?.correct ?? false };
    });
    for (const r of results) {
      if (r.skillId && r.answer !== null) {
        await store.recordAttempt(session.studentId, String(r.skillId), Boolean(r.correct));
        const o = session.skillOutcomes.get(String(r.skillId)) ?? { correct: 0, total: 0 };
        o.total += 1;
        if (r.correct) o.correct += 1;
        session.skillOutcomes.set(String(r.skillId), o);
      }
    }
    const correctCount = results.filter((r) => r.correct).length;
    const durationSec = Math.round((Date.now() - exam.startedAt) / 1000);

    let postMortem = "";
    for await (const delta of (limitsFor(session.plan).premiumBrain ? gateway.premiumChat : gateway.planner).chat(
      [
        ...session.history,
        {
          role: "user",
          content:
            `MOCK EXAM FINISHED. Score: ${correctCount}/${results.length} in ${durationSec}s. Results: ` +
            results.map((r) => `[${r.prompt} -> ${r.answer ?? "(blank)"} ${r.correct ? "✓" : "✗"}]`).join(" ") +
            ` As the tutor, write a short post-mortem: celebrate what went right, name the pattern behind the misses, and give the single highest-impact thing to practice before the real exam.`,
        },
      ],
      { signal: AbortSignal.timeout(120_000) },
    ))
      postMortem += delta;
    session.history.push({ role: "assistant", content: postMortem });
    await store.saveMessage(session.id, "assistant", postMortem);

    return { score: correctCount, of: results.length, durationSec, results, postMortem };
  });

  // ---- Orgs (schools): seats, roster, teacher dashboard ----

  app.post<{ Body: { name: string; seats?: number } }>(
    "/orgs",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 2, maxLength: 120 },
            seats: { type: "integer", minimum: 1, maximum: 10_000 },
          },
        },
      },
    },
    async (req, reply) => {
      const user = await userFromRequest(req, store);
      if (!user) return reply.code(401).send({ error: "sign in required" });
      if (await store.getOrgByOwner(user.userId)) return reply.code(409).send({ error: "you already have an organization" });
      const org = await store.createOrg(user.userId, req.body.name.trim(), req.body.seats ?? 30);
      return { id: org.id, name: req.body.name.trim(), seats: req.body.seats ?? 30 };
    },
  );

  app.post<{ Body: { names: string[] } }>(
    "/orgs/roster",
    {
      schema: {
        body: {
          type: "object",
          required: ["names"],
          additionalProperties: false,
          properties: {
            names: {
              type: "array",
              minItems: 1,
              maxItems: 500,
              items: { type: "string", minLength: 1, maxLength: 80 },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const user = await userFromRequest(req, store);
      if (!user) return reply.code(401).send({ error: "sign in required" });
      const org = await store.getOrgByOwner(user.userId);
      if (!org) return reply.code(404).send({ error: "create an organization first" });
      const current = await store.countOrgStudents(org.id);
      if (current + req.body.names.length > org.seats) {
        return reply.code(402).send({
          error: `roster would exceed your ${org.seats} seats (${current} used) — contact us to add seats`,
          upgrade: true,
        });
      }
      const added = await store.addOrgStudents(org.id, user.userId, req.body.names.map((n) => n.trim()));
      return { added, seatsUsed: current + added.length, seats: org.seats };
    },
  );

  /** Teacher dashboard: whole-class mastery, activity, and safety visibility. */
  app.get("/orgs/dashboard", async (req, reply) => {
    const user = await userFromRequest(req, store);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    const org = await store.getOrgByOwner(user.userId);
    if (!org) return reply.code(404).send({ error: "create an organization first" });
    const students = await store.listOrgStudents(org.id);
    return {
      org: { name: org.name, seats: org.seats, seatsUsed: students.length },
      students: await Promise.all(
        students.map(async (s) => ({
          ...s,
          mastery: await store.getMasterySnapshot(s.id),
          sessions: await store.listSessionSummaries(s.id, 3),
          safety: await store.listIncidents(s.id, 5),
        })),
      ),
    };
  });

  // ---- API keys (B2B: Tutor-as-a-Service) ----

  app.post<{ Body: { name: string; scopes?: string[] } }>(
    "/apikeys",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 80 },
            scopes: { type: "array", maxItems: 8, items: { type: "string", enum: ["tutor", "pedagogy", "safety"] } },
          },
        },
      },
    },
    async (req, reply) => {
      const user = await userFromRequest(req, store);
      if (!user) return reply.code(401).send({ error: "sign in required" });
      const raw = `tk_${randomBytes(24).toString("hex")}`;
      const key = await store.createApiKey(
        user.userId,
        req.body.name.trim(),
        createHash("sha256").update(raw).digest("hex"),
        req.body.scopes ?? ["tutor"],
      );
      // The raw key is shown exactly once; only its hash is stored.
      return { id: key.id, key: raw, scopes: req.body.scopes ?? ["tutor"] };
    },
  );

  app.get("/apikeys", async (req, reply) => {
    const user = await userFromRequest(req, store);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    return store.listApiKeys(user.userId);
  });

  app.delete<{ Params: { id: string } }>("/apikeys/:id", async (req, reply) => {
    const user = await userFromRequest(req, store);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    const ok = await store.revokeApiKey(user.userId, req.params.id);
    return ok ? { revoked: true } : reply.code(404).send({ error: "no such key" });
  });

  // ---- Auth lifecycle: logout, password reset ----

  app.post("/auth/logout", async (req, reply) => {
    const user = await userFromRequest(req, store);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    await store.revokeUserTokens(user.userId); // logs out everywhere
    return { loggedOut: true };
  });

  app.post<{ Body: { email: string } }>(
    "/auth/forgot",
    {
      schema: {
        body: {
          type: "object",
          required: ["email"],
          additionalProperties: false,
          properties: { email: { type: "string", format: "email", maxLength: 254 } },
        },
      },
      config: { rateLimit: { max: Number(env.AUTH_RATE_LIMIT ?? 5), timeWindow: "1 minute" } },
    },
    async (req) => {
      const account = await store.getAccountByEmail(req.body.email);
      if (account) {
        const raw = randomBytes(24).toString("hex");
        await store.createPasswordReset(account.userId, createHash("sha256").update(raw).digest("hex"));
        const { sendPasswordReset } = await import("./email.js");
        sendPasswordReset(req.body.email, raw).catch((err) => app.log.error(err, "reset email failed"));
      }
      // Identical response either way — no account probing.
      return { sent: true };
    },
  );

  app.post<{ Body: { token: string; password: string } }>(
    "/auth/reset",
    {
      schema: {
        body: {
          type: "object",
          required: ["token", "password"],
          additionalProperties: false,
          properties: {
            token: { type: "string", minLength: 32, maxLength: 128 },
            password: { type: "string", minLength: 8, maxLength: 128 },
          },
        },
      },
      config: { rateLimit: { max: Number(env.AUTH_RATE_LIMIT ?? 10), timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const userId = await store.consumePasswordReset(
        createHash("sha256").update(req.body.token).digest("hex"),
        60 * 60 * 1000,
      );
      if (!userId) return reply.code(400).send({ error: "that reset link is invalid or expired — request a new one" });
      await store.setPassword(userId, await hashPassword(req.body.password));
      await store.revokeUserTokens(userId); // every old session dies with the old password
      return { reset: true };
    },
  );

  /** GDPR/COPPA erasure: the account and every trace of its students. */
  app.delete<{ Body: { confirm: string } }>(
    "/me",
    {
      schema: {
        body: {
          type: "object",
          required: ["confirm"],
          additionalProperties: false,
          properties: { confirm: { type: "string", enum: ["DELETE"] } },
        },
      },
    },
    async (req, reply) => {
      const user = await userFromRequest(req, store);
      if (!user) return reply.code(401).send({ error: "sign in required" });
      await store.deleteAccount(user.userId);
      return { deleted: true };
    },
  );

  // ---- Web push notifications ----

  app.get("/push/vapid", async (_req, reply) => {
    if (!env.VAPID_PUBLIC_KEY) return reply.code(501).send({ error: "push not configured" });
    return { publicKey: env.VAPID_PUBLIC_KEY };
  });

  app.post<{ Body: { endpoint: string; keys: { p256dh: string; auth: string } } }>(
    "/push/subscribe",
    {
      schema: {
        body: {
          type: "object",
          required: ["endpoint", "keys"],
          properties: {
            endpoint: { type: "string", maxLength: 1000 },
            keys: {
              type: "object",
              required: ["p256dh", "auth"],
              properties: { p256dh: { type: "string", maxLength: 300 }, auth: { type: "string", maxLength: 100 } },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const user = await userFromRequest(req, store);
      if (!user) return reply.code(401).send({ error: "sign in required" });
      await store.savePushSubscription(user.userId, {
        endpoint: req.body.endpoint,
        p256dh: req.body.keys.p256dh,
        auth: req.body.keys.auth,
      });
      return { subscribed: true };
    },
  );

  /** Admin-triggered nudge (deploy cron hits this daily; body optional email filter). */
  app.post<{ Body: { email: string; title?: string; message?: string } }>(
    "/admin/nudge",
    {
      schema: {
        body: {
          type: "object",
          required: ["email"],
          additionalProperties: false,
          properties: {
            email: { type: "string", format: "email" },
            title: { type: "string", maxLength: 80 },
            message: { type: "string", maxLength: 300 },
          },
        },
      },
    },
    async (req, reply) => {
      if (!env.ADMIN_KEY) return reply.code(501).send({ error: "ADMIN_KEY not configured" });
      if (req.headers["x-admin-key"] !== env.ADMIN_KEY) return reply.code(403).send({ error: "forbidden" });
      if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
        return reply.code(501).send({ error: "push not configured" });
      }
      const account = await store.getAccountByEmail(req.body.email);
      if (!account) return reply.code(404).send({ error: "no such account" });
      const subs = await store.listPushSubscriptions(account.userId);
      const webpush = (await import("web-push")).default;
      webpush.setVapidDetails(
        env.VAPID_SUBJECT ?? "mailto:tutor@example.com",
        env.VAPID_PUBLIC_KEY,
        env.VAPID_PRIVATE_KEY,
      );
      let sent = 0;
      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({
              title: req.body.title ?? "Your tutor is ready 📚",
              body: req.body.message ?? "A few minutes of practice today keeps the streak alive!",
            }),
          );
          sent += 1;
        } catch {
          await store.deletePushSubscription(sub.endpoint); // stale device
        }
      }
      return { sent, of: subs.length };
    },
  );

  /** Guardian transcript view: the recent conversation for a student you own. */
  app.get<{ Params: { id: string } }>("/students/:id/transcript", async (req, reply) => {
    const user = await userFromRequest(req, store);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    if (!(await store.ownsStudent(user.userId, req.params.id))) {
      return reply.code(403).send({ error: "that student is not in your family" });
    }
    return { messages: await store.listRecentMessages(req.params.id, 40) };
  });

  // ---- Admin (pre-billing): set a user's plan manually ----

  app.post<{ Body: { email: string; plan: string } }>(
    "/admin/plan",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "plan"],
          additionalProperties: false,
          properties: {
            email: { type: "string", format: "email" },
            plan: { type: "string", enum: ["free", "plus", "premium"] },
          },
        },
      },
    },
    async (req, reply) => {
      if (!env.ADMIN_KEY) return reply.code(501).send({ error: "ADMIN_KEY not configured" });
      if (req.headers["x-admin-key"] !== env.ADMIN_KEY) return reply.code(403).send({ error: "forbidden" });
      const ok = await store.setUserPlan(req.body.email, req.body.plan);
      return ok ? { email: req.body.email, plan: req.body.plan } : reply.code(404).send({ error: "no such account" });
    },
  );

  /** Usage summary for the signed-in account (today + this month). */
  app.get("/me/usage", async (req, reply) => {
    const user = await userFromRequest(req, store);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const plan = await store.getUserPlan(user.userId);
    const limits = limitsFor(plan);
    return {
      plan,
      today: {
        messages: await store.sumUsage({ userId: user.userId }, "message", startOfToday()),
        voiceTurns: await store.sumUsage({ userId: user.userId }, "voice_turn", startOfToday()),
        limits: { messages: limits.dailyMessages, voiceTurns: limits.dailyVoiceTurns },
      },
      monthTotal: await store.sumUsage({ userId: user.userId }, null, monthStart),
    };
  });

  // ---- Billing (Sprint 6b) ----
  await registerBilling(app, store, env, (req) => userFromRequest(req as Parameters<typeof userFromRequest>[0], store));

  return app;
}
