import Fastify from "fastify";
import cors from "@fastify/cors";
import { createGatewayFromEnv, type ChatMessage } from "@tutor/ai-gateway";
import { buildSystemPrompt, loadPack, loadPersonas } from "./tutor/prompt.js";

/**
 * Sprint-1 spine: sessions live in memory so the whole loop runs with zero
 * external services (mock providers, no DB). Sprint 2 swaps the store for
 * Postgres via @tutor/db — the schema is already in packages/db.
 */
interface LiveSession {
  id: string;
  studentName: string;
  personaId: string;
  packId: string;
  history: ChatMessage[];
  startedAt: Date;
}

const sessions = new Map<string, LiveSession>();
const gateway = createGatewayFromEnv();

const app = Fastify({ logger: true });
await app.register(cors, { origin: process.env.WEB_ORIGIN ?? true });

app.get("/health", async () => ({
  ok: true,
  providers: {
    chat: gateway.chat.name,
    planner: gateway.planner.name,
    stt: gateway.stt.name,
    tts: gateway.tts.name,
    vision: gateway.vision.name,
  },
}));

app.get("/personas", async () => loadPersonas());

app.get("/packs", async () => {
  return ["math-ms", "exam-prep", "language"].map((id) => {
    const p = loadPack(id);
    return { id: p.id, title: p.title, vertical: p.vertical, description: p.description };
  });
});

app.post<{ Body: { studentName: string; personaId: string; packId: string } }>(
  "/sessions",
  async (req, reply) => {
    const { studentName, personaId, packId } = req.body;
    const persona = loadPersonas().find((p) => p.id === personaId);
    if (!persona) return reply.code(400).send({ error: `unknown persona: ${personaId}` });
    const pack = loadPack(packId);

    const id = crypto.randomUUID();
    const system = buildSystemPrompt({
      persona,
      pack,
      studentName,
      memoryLines: [], // Sprint 2: load from memories table
    });
    sessions.set(id, {
      id,
      studentName,
      personaId,
      packId,
      history: [{ role: "system", content: system }],
      startedAt: new Date(),
    });
    return { sessionId: id, persona: { id: persona.id, name: persona.name }, pack: pack.title };
  },
);

/** Student turn in, tutor reply streamed out as SSE. */
app.post<{ Params: { id: string }; Body: { text: string } }>(
  "/sessions/:id/message",
  async (req, reply) => {
    const session = sessions.get(req.params.id);
    if (!session) return reply.code(404).send({ error: "no such session" });

    session.history.push({ role: "user", content: req.body.text });

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
      reply.raw.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    } catch (err) {
      app.log.error(err);
      reply.raw.write(`data: ${JSON.stringify({ error: "generation failed" })}\n\n`);
    }
    reply.raw.end();
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

/** End session → tutor writes the recap (uses the planner slot: upgradeable to frontier). */
app.post<{ Params: { id: string } }>("/sessions/:id/end", async (req, reply) => {
  const session = sessions.get(req.params.id);
  if (!session) return reply.code(404).send({ error: "no such session" });

  const recapPrompt: ChatMessage[] = [
    ...session.history,
    {
      role: "user",
      content:
        "SESSION OVER. As the tutor, write a short recap: 2-sentence summary, what the student struggled with, what they did well, and what to focus on next session. Plain text.",
    },
  ];
  let recap = "";
  for await (const delta of gateway.planner.chat(recapPrompt)) recap += delta;

  sessions.delete(session.id);
  return { recap, turns: session.history.filter((m) => m.role !== "system").length };
});

const port = Number(process.env.API_PORT ?? 4000);
await app.listen({ port, host: "0.0.0.0" });
