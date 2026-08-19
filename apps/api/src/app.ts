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
import { sendParentRecap } from "./email.js";

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

export async function buildApp({ gateway, store, env = process.env }: AppDeps): Promise<FastifyInstance> {
  const live = new Map<string, LiveSession>();
  const app = Fastify({ logger: env.NODE_ENV !== "test", bodyLimit: 1 << 20 });

  // Raw audio uploads for push-to-talk (multipart adds nothing here).
  app.addContentTypeParser(/^audio\/.*/, { parseAs: "buffer" }, (_req, body, done) =>
    done(null, body),
  );

  await app.register(cors, { origin: env.WEB_ORIGIN ?? true });
  await app.register(rateLimit, {
    max: Number(env.RATE_LIMIT_MAX ?? 120),
    timeWindow: "1 minute",
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

  app.post<{ Body: { studentName: string; personaId: string; packId: string; parentEmail?: string } }>(
    "/sessions",
    {
      schema: {
        body: {
          type: "object",
          required: ["studentName", "personaId", "packId"],
          additionalProperties: false,
          properties: {
            studentName: { type: "string", minLength: 1, maxLength: 80 },
            personaId: { type: "string", maxLength: 40 },
            packId: { type: "string", maxLength: 40 },
            parentEmail: { type: "string", format: "email", maxLength: 254 },
          },
        },
      },
    },
    async (req, reply) => {
      const { studentName, personaId, packId, parentEmail } = req.body;
      const persona = loadPersonas().find((p) => p.id === personaId);
      if (!persona) return reply.code(400).send({ error: `unknown persona: ${personaId}` });

      let pack;
      try {
        pack = loadPack(packId);
      } catch (err) {
        if (err instanceof UnknownPackError) return reply.code(400).send({ error: err.message });
        throw err;
      }

      const student = await store.ensureStudent(studentName.trim(), parentEmail);
      const memoryLines = await store.getMemories(student.id);
      const sessionId = await store.createSession(student.id, personaId, packId);

      live.set(sessionId, {
        id: sessionId,
        studentId: student.id,
        studentName: studentName.trim(),
        parentEmail,
        personaId,
        packId,
        history: [
          { role: "system", content: buildSystemPrompt({ persona, pack, studentName: studentName.trim(), memoryLines }) },
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

        const diagnosis = problem.misconceptions?.find(
          (m) => m.answer.replace(/\s/g, "") === answer.replace(/\s/g, ""),
        )?.diagnosis;

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

        session.history.push({ role: "user", content: transcript });
        await store.saveMessage(session.id, "user", transcript);

        let replyText = "";
        for await (const delta of gateway.chat.chat(session.history, {
          signal: AbortSignal.timeout(120_000),
        }))
          replyText += delta;
        session.history.push({ role: "assistant", content: replyText });
        await store.saveMessage(session.id, "assistant", replyText);

        const persona = loadPersonas().find((p) => p.id === session.personaId)!;
        // TTS engines have input caps; a long reply gets its head spoken and
        // the full text still arrives for the transcript view.
        const spoken = await gateway.tts.speak(replyText.slice(0, 2000), persona.voiceId);

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
      const result = await gateway.tts.speak(req.body.text, persona.voiceId);
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
