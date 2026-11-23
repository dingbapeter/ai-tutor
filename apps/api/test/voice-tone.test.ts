import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/store/memory.js";
import { buildApp } from "../src/app.js";
import type { ChatMessage } from "@tutor/ai-gateway";
import {
  MockChatProvider,
  MockSttProvider,
  MockTtsProvider,
  MockVisionProvider,
  RulesModerationProvider,
} from "@tutor/ai-gateway";

/** A chat provider that records the exact history each turn was asked with. */
class CapturingChat {
  readonly name = "mock";
  seen: ChatMessage[][] = [];
  async *chat(messages: ChatMessage[]): AsyncIterable<string> {
    this.seen.push(messages.map((m) => ({ ...m })));
    yield "Let's take it slow. ";
    yield "How are you feeling today?";
  }
}

function gatewayWith(chat: CapturingChat) {
  return {
    chat,
    planner: new MockChatProvider(),
    premiumChat: new MockChatProvider(),
    stt: new MockSttProvider(),
    tts: new MockTtsProvider(),
    vision: new MockVisionProvider(),
    moderation: new RulesModerationProvider(),
  };
}

async function startVoiceSession(store: MemoryStore, chat: CapturingChat) {
  const app = await buildApp({
    gateway: gatewayWith(chat),
    store,
    env: { NODE_ENV: "test", RATE_LIMIT_MAX: "10000", AUTH_RATE_LIMIT: "100000", AI_TTS_PROVIDER: "mock" },
  });
  const started = await app.inject({
    method: "POST",
    url: "/sessions",
    payload: { studentName: "Ada", personaId: "amara", packId: "math-ms" },
  });
  return { app, sessionId: (started.json() as { sessionId: string }).sessionId };
}

describe("hearing how the student feels (sprint 42)", () => {
  it("a flat voice earns the tutor a private care note that the student never sees", async () => {
    const chat = new CapturingChat();
    const store = new MemoryStore();
    const { app, sessionId } = await startVoiceSession(store, chat);

    const res = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/voice`,
      headers: { "content-type": "audio/webm", "x-voice-tone": "low" },
      payload: Buffer.from([1, 2, 3, 4]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().reply).toContain("feeling");

    // The last turn the model saw carried the ephemeral care note...
    const lastTurn = chat.seen.at(-1)!;
    const note = lastTurn.find((m) => m.role === "system" && m.content.includes("sounded quiet and flat"));
    expect(note).toBeDefined();

    // ...but it is NOT written to the saved transcript the family can read.
    const messages = await store.listSessionMessages(sessionId);
    expect(messages.every((m) => !m.content.includes("sounded quiet and flat"))).toBe(true);
  });

  it("a normal voice adds no note at all", async () => {
    const chat = new CapturingChat();
    const store = new MemoryStore();
    const { app, sessionId } = await startVoiceSession(store, chat);

    const res = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/voice`,
      headers: { "content-type": "audio/webm" },
      payload: Buffer.from([1, 2, 3, 4]),
    });
    expect(res.statusCode).toBe(200);
    const lastTurn = chat.seen.at(-1)!;
    expect(lastTurn.some((m) => m.role === "system" && m.content.includes("sounded quiet and flat"))).toBe(false);
  });
});
