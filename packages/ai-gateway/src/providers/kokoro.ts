import type { TtsProvider, TtsResult } from "../types.js";

/**
 * Adapter for kokoro-fastapi (OpenAI-compatible /v1/audio/speech), which serves
 * the Apache-licensed Kokoro-82M model — near-human quality, runs on CPU.
 * The same wire shape covers a piper-http wrapper, so `piper` reuses this class.
 */
export class KokoroTtsProvider implements TtsProvider {
  readonly name: string;
  constructor(
    private baseUrl: string,
    name = "kokoro",
    private model = "kokoro",
  ) {
    this.name = name;
  }

  async speak(text: string, voiceId: string): Promise<TtsResult> {
    const res = await fetch(`${this.baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, input: text, voice: voiceId, response_format: "mp3" }),
    });
    if (!res.ok) throw new Error(`tts failed: ${res.status}`);
    return {
      audio: new Uint8Array(await res.arrayBuffer()),
      mimeType: "audio/mpeg",
      // Viseme timings come later from phoneme alignment; the avatar falls back
      // to amplitude-driven mouth movement without them.
    };
  }
}
