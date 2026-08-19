import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { AiGateway, ChatMessage } from "@tutor/ai-gateway";
import {
  buildSystemPrompt,
  loadPack,
  loadPersonas,
  PACK_IDS,
  UnknownPackError,
} from "./tutor/prompt.js";
import type { Store } from "./store/types.js";
import { verifyAnswer, type Check } from "./mathcheck.js";
import { sendParentRecap, sendSafetyAlert } from "./email.js";
import { hashPassword, mintToken, userFromRequest, verifyPassword } from "./auth.js";
import { createHash } from "node:crypto";

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
}

export interface AppDeps {
  gateway: AiGateway;
  store: Store;
  env?: Record<string, string | undefined>;
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

export async function buildApp({ gateway, store, env = process.env }: AppDeps): Promise<FastifyInstance> {
  const live = new Map<string, LiveSession>();
  const app = Fastify({ logger: env.NODE_ENV !== "test", bodyLimit: 1 << 20 });

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
    { schema: { body: { ...credentialsSchema, additionalProperties: false } }, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
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
      return { token: token.raw, role: role ?? "parent", studentId: account.studentId ?? null };
    },
  );

  app.post<{ Body: { email: string; password: string } }>(
    "/auth/login",
    { schema: { body: { ...credentialsSchema, additionalProperties: false } }, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
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
          mastery: await store.getMasterySnapshot(s.id),
          safety: await store.listIncidents(s.id, 10),
        })),
      ),
    };
  });

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
      } else if (req.body.studentName) {
        const student = await store.ensureStudent(req.body.studentName.trim(), req.body.parentEmail);
        studentIdResolved = student.id;
        studentName = req.body.studentName.trim();
        parentEmail = req.body.parentEmail;
      } else {
        return reply.code(400).send({ error: "provide studentName (guest) or studentId (account)" });
      }

      const memoryLines = await store.getMemories(studentIdResolved);
      const sessionId = await store.createSession(studentIdResolved, personaId, packId);

      live.set(sessionId, {
        id: sessionId,
        studentId: studentIdResolved,
        studentName,
        parentEmail,
        personaId,
        packId,
        history: [
          { role: "system", content: buildSystemPrompt({ persona, pack, studentName, memoryLines }) },
        ],
        busy: false,
        practiceTotal: 0,
        practiceCorrect: 0,
      });
      return {
        sessionId,
        persona: { id: persona.id, name: persona.name },
        pack: pack.title,
        remembered: memoryLines.length,
      };
    },
  );

  /** Student turn in, tutor reply streamed out as SSE. */
  app.post<{ Params: { id: string }; Body: { text: string; format?: string } }>(
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
          },
        },
      },
    },
    async (req, reply) => {
      const session = live.get(req.params.id);
      if (!session) return reply.code(404).send({ error: "no such session" });
      if (session.busy) return reply.code(409).send({ error: "tutor is already responding" });
      session.busy = true;

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
      const turnText = formatNote ? `${req.body.text}\n\n[${formatNote}]` : req.body.text;
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
        for await (const delta of gateway.chat.chat(session.history, { signal: abort.signal })) {
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
        }

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
        for await (const delta of gateway.chat.chat(session.history, {
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
      session.busy = true;

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
          for await (const delta of gateway.chat.chat(session.history, {
            signal: AbortSignal.timeout(120_000),
          }))
            replyText += delta;
          session.history.push({ role: "assistant", content: replyText });
          await store.saveMessage(session.id, "assistant", replyText);
          auditTutorOutput(session, replyText).catch((err) => app.log.error(err));
        }

        // TTS engines have input caps; a long reply gets its head spoken and
        // the full text still arrives for the transcript view.
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

  return app;
}
