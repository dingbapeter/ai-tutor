import type { SttProvider } from "../types.js";

/**
 * Adapter for faster-whisper-server / speaches (OpenAI-compatible
 * /v1/audio/transcriptions). Self-hosted on Contabo; CPU handles the small
 * models near-real-time, GPU handles large-v3 easily.
 */
export class WhisperSttProvider implements SttProvider {
  readonly name = "whisper";
  constructor(
    private baseUrl: string,
    private model = "Systran/faster-whisper-small",
  ) {}

  async transcribe(audio: Uint8Array, mimeType: string, language?: string): Promise<string> {
    const form = new FormData();
    const ext = mimeType.split("/")[1]?.split(";")[0] ?? "wav";
    form.append("file", new Blob([audio as BlobPart], { type: mimeType }), `audio.${ext}`);
    form.append("model", this.model);
    if (language) form.append("language", language);
    const res = await fetch(`${this.baseUrl}/v1/audio/transcriptions`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`whisper transcribe failed: ${res.status}`);
    const json = (await res.json()) as { text?: string };
    return json.text ?? "";
  }
}
