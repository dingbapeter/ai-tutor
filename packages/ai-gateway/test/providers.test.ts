import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LlamaCppChatProvider } from "../src/providers/llamacpp.js";
import { WhisperSttProvider } from "../src/providers/whisper.js";
import { KokoroTtsProvider } from "../src/providers/kokoro.js";
import { RoutingTtsProvider } from "../src/providers/tts-router.js";
import { createGatewayFromEnv } from "../src/config.js";

/**
 * Protocol tests: stub servers speak the EXACT wire formats of llama.cpp
 * (OpenAI-compatible SSE), faster-whisper-server, and kokoro-fastapi —
 * including the nasty case of a JSON payload split across TCP chunks —
 * so adapter bugs surface here, not on deploy day.
 */

function sseChunk(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    if (req.url === "/v1/chat/completions") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(sseChunk("Hello "));
      // Split ONE SSE event across two writes mid-JSON to prove buffering.
      const evt = sseChunk("world");
      res.write(evt.slice(0, 15));
      await new Promise((r) => setTimeout(r, 20));
      res.write(evt.slice(15));
      res.write(sseChunk("!"));
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    if (req.url === "/v1/audio/transcriptions") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ text: "two x plus three equals eleven" }));
      return;
    }
    if (req.url === "/v1/audio/speech") {
      res.writeHead(200, { "content-type": "audio/mpeg" });
      res.end(Buffer.from([0xff, 0xfb, 0x90, 0x00]));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("LlamaCppChatProvider", () => {
  it("streams and reassembles SSE deltas, surviving mid-JSON chunk splits", async () => {
    const provider = new LlamaCppChatProvider(base);
    let out = "";
    for await (const delta of provider.chat([{ role: "user", content: "hi" }])) out += delta;
    expect(out).toBe("Hello world!");
  });

  it("throws a useful error on a non-200 response", async () => {
    const provider = new LlamaCppChatProvider(`${base}/nowhere`);
    await expect(async () => {
      for await (const _ of provider.chat([{ role: "user", content: "hi" }])) void _;
    }).rejects.toThrow(/llamacpp chat failed/);
  });
});

describe("WhisperSttProvider", () => {
  it("posts audio and returns the transcription text", async () => {
    const provider = new WhisperSttProvider(base);
    const text = await provider.transcribe(new Uint8Array([0, 1, 2]), "audio/wav");
    expect(text).toBe("two x plus three equals eleven");
  });
});

describe("KokoroTtsProvider", () => {
  it("returns audio bytes with the right mime type", async () => {
    const provider = new KokoroTtsProvider(base);
    const result = await provider.speak("hello", "af_heart");
    expect(result.mimeType).toBe("audio/mpeg");
    expect(result.audio.length).toBeGreaterThan(0);
  });
});

describe("createGatewayFromEnv", () => {
  it("defaults every capability to mock", () => {
    const gw = createGatewayFromEnv({});
    expect([gw.chat.name, gw.stt.name, gw.tts.name, gw.vision.name]).toEqual([
      "mock",
      "mock",
      "mock",
      "mock",
    ]);
  });

  it("routes the planner slot independently of live chat", () => {
    const gw = createGatewayFromEnv({
      AI_CHAT_PROVIDER: "llamacpp",
      AI_CHAT_PLANNER_PROVIDER: "mock",
      LLAMACPP_URL: "http://x",
    });
    expect(gw.chat.name).toBe("llamacpp");
    expect(gw.planner.name).toBe("mock");
  });

  it("rejects unknown providers loudly", () => {
    expect(() => createGatewayFromEnv({ AI_CHAT_PROVIDER: "gpt-99" })).toThrow(/Unknown chat provider/);
  });
});

describe("multi-engine TTS routing", () => {
  it("sends Piper-shaped voice ids to Piper and Kokoro-shaped ids to Kokoro", async () => {
    const calls: string[] = [];
    const fake = (name: string) => ({
      name,
      async speak(_t: string, voiceId: string) {
        calls.push(`${name}:${voiceId}`);
        return { audio: new Uint8Array(), mimeType: "audio/mpeg" };
      },
    });
    const router = new RoutingTtsProvider(
      { kokoro: fake("kokoro"), piper: fake("piper") },
      fake("fallback"),
    );

    await router.speak("hello", "af_heart"); // Kokoro speaker handle
    await router.speak("jambo", "sw_CD-lanfrica-medium"); // Piper locale-voice
    await router.speak("hola", "ef_dora");
    await router.speak("guten tag", "de_DE-thorsten-high");
    expect(calls).toEqual([
      "kokoro:af_heart",
      "piper:sw_CD-lanfrica-medium",
      "kokoro:ef_dora",
      "piper:de_DE-thorsten-high",
    ]);
  });

  it("falls back rather than failing when an engine is not configured", async () => {
    const calls: string[] = [];
    const fake = (name: string) => ({
      name,
      async speak(_t: string, v: string) {
        calls.push(`${name}:${v}`);
        return { audio: new Uint8Array(), mimeType: "audio/mpeg" };
      },
    });
    const router = new RoutingTtsProvider({ kokoro: fake("kokoro") }, fake("fallback"));
    await router.speak("jambo", "sw_CD-lanfrica-medium"); // no Piper wired
    expect(calls).toEqual(["fallback:sw_CD-lanfrica-medium"]);
  });
});
