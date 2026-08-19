import Fastify from "fastify";
import cors from "@fastify/cors";
import { createGatewayFromEnv, type ChatMessage } from "@tutor/ai-gateway";
import { buildSystemPrompt, loadPack, loadPersonas } from "./tutor/prompt.js";
import type { Store } from "./store/types.js";
import { MemoryStore } from "./store/memory.js";
import { PostgresStore } from "./store/postgres.js";
import { verifyAnswer, type Check } from "./mathcheck.js";
import { sendParentRecap } from "./email.js";

const PACK_IDS = ["math-ms", "exam-prep", "language"];

/** Live conversational state; durable state goes through the Store. */
interface LiveSession {
  id: string;
  studentId: string;
  studentName: string;
  parentEmail?: string;
  personaId: string;
  packId: string;
  history: ChatMessage[];
}

const live = new Map<string, LiveSession>();
const gateway = createGatewayFromEnv();

let store: Store;
if (process.env.DATABASE_URL) {
  const pg = new PostgresStore(process.env.DATABASE_URL);
  await pg.seedSkills(PACK_IDS);
  store = pg;
} else {
  store = new MemoryStore();
}

const app = Fastify({ logger: true });
await app.register(cors, { origin: process.env.WEB_ORIGIN ?? true });

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

app.get("/personas", async () => loadPersonas());

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
  } catch {
    return reply.code(404).send({ error: "unknown pack" });
  }
});

app.post<{ Body: { studentName: string; personaId: string; packId: string; parentEmail?: string } }>(
  "/sessions",
  async (req, reply) => {
    const { studentName, personaId, packId, parentEmail } = req.body;
    const persona = loadPersonas().find((p) => p.id === personaId);
    if (!persona) return reply.code(400).send({ error: `unknown persona: ${personaId}` });
    const pack = loadPack(packId);

    const student = await store.ensureStudent(studentName, parentEmail);
    const memoryLines = await store.getMemories(student.id);
    const sessionId = await store.createSession(student.id, personaId, packId);

    live.set(sessionId, {
      id: sessionId,
      studentId: student.id,
      studentName,
      parentEmail,
      personaId,
      packId,
      history: [
        { role: "system", content: buildSystemPrompt({ persona, pack, studentName, memoryLines }) },
      ],
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
app.post<{ Params: { id: string }; Body: { text: string } }>(
  "/sessions/:id/message",
  async (req, reply) => {
    const session = live.get(req.params.id);
    if (!session) return reply.code(404).send({ error: "no such session" });

    session.history.push({ role: "user", content: req.body.text });
    await store.saveMessage(session.id, "user", req.body.text);

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": process.env.WEB_ORIGIN ?? "*",
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
      reply.raw.write(`data: ${JSON.stringify({ error: "generation failed" })}\n\n`);
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
  async (req, reply) => {
    const session = live.get(req.params.id);
    if (!session) return reply.code(404).send({ error: "no such session" });
    const pack = loadPack(session.packId);
    const problem = pack.problems[req.body.problemIndex];
    if (!problem) return reply.code(400).send({ error: "unknown problem" });

    const answer = String(req.body.answer).trim();
    let correct = await verifyAnswer(problem.check as Check, answer);
    if (correct === null && problem.answer !== undefined) {
      correct = answer.replace(/\s/g, "") === String(problem.answer).replace(/\s/g, "");
    }

    if (correct !== null && problem.skillId) {
      await store.recordAttempt(session.studentId, String(problem.skillId), correct);
    }

    const diagnosis = (problem.misconceptions as Array<{ answer: string; diagnosis: string }> | undefined)?.find(
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
    for await (const delta of gateway.chat.chat(session.history)) feedback += delta;
    session.history.push({ role: "assistant", content: feedback });
    await store.saveMessage(session.id, "assistant", feedback);

    return { correct, feedback };
  },
);

/** Voice note for a tutor message (async TTS — Phase 0 voice). */
app.post<{ Body: { text: string; personaId: string } }>("/tts", async (req, reply) => {
  const persona = loadPersonas().find((p) => p.id === req.body.personaId);
  if (!persona) return reply.code(400).send({ error: "unknown persona" });
  const result = await gateway.tts.speak(req.body.text, persona.voiceId);
  reply.header("content-type", result.mimeType);
  return reply.send(Buffer.from(result.audio));
});

/**
 * End session: planner writes the recap and extracts memory lines for the
 * learner model; parent gets the recap by email (mailcow) when we have one.
 */
app.post<{ Params: { id: string } }>("/sessions/:id/end", async (req, reply) => {
  const session = live.get(req.params.id);
  if (!session) return reply.code(404).send({ error: "no such session" });
  const persona = loadPersonas().find((p) => p.id === session.personaId)!;

  let recap = "";
  for await (const delta of gateway.planner.chat([
    ...session.history,
    {
      role: "user",
      content:
        "SESSION OVER. As the tutor, write a short recap for the student's parent: 2-sentence summary, what the student struggled with, what they did well, what to focus on next session. Plain text, warm but concrete.",
    },
  ]))
    recap += delta;

  let memoryRaw = "";
  for await (const delta of gateway.planner.chat([
    ...session.history,
    {
      role: "user",
      content:
        "Extract up to 3 short memory lines about this student worth remembering for future sessions (skills shaky/strong, goals, personal details they shared). One per line, no bullets, no commentary. If nothing worth remembering, reply NONE.",
    },
  ]))
    memoryRaw += delta;

  for (const line of memoryRaw.split("\n").map((l) => l.trim()).filter((l) => l && l !== "NONE").slice(0, 3)) {
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

  live.delete(session.id);
  return {
    recap,
    turns: session.history.filter((m) => m.role !== "system").length,
    emailStatus,
    mastery: await store.getMasterySnapshot(session.studentId),
  };
});

const port = Number(process.env.API_PORT ?? 4000);
await app.listen({ port, host: "0.0.0.0" });
