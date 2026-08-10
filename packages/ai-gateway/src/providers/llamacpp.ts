import type { ChatMessage, ChatOptions, ChatProvider, VisionProvider } from "../types.js";

/**
 * Adapter for any OpenAI-compatible self-hosted server: llama.cpp (`llama-server`),
 * vLLM, or Ollama (/v1). This is the workhorse for zero-API-spend inference.
 * Because the wire format is OpenAI-compatible, pointing this adapter at a paid
 * endpoint later is also just a URL change.
 */
export class LlamaCppChatProvider implements ChatProvider {
  readonly name = "llamacpp";
  constructor(
    private baseUrl: string,
    private model = "default",
  ) {}

  async *chat(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<string> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: opts?.signal,
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
        temperature: opts?.temperature ?? 0.6,
        max_tokens: opts?.maxTokens ?? 1024,
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`llamacpp chat failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const data = line.replace(/^data: ?/, "").trim();
        if (!data || data === "[DONE]") continue;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // partial JSON split across chunks — carried in buffer
        }
      }
    }
  }
}

/** Multimodal chat server (e.g. llama.cpp with a Qwen-VL GGUF) used as the vision capability. */
export class LlamaCppVisionProvider implements VisionProvider {
  readonly name = "llamacpp";
  constructor(
    private baseUrl: string,
    private model = "default",
  ) {}

  async see(image: Uint8Array, mimeType: string, instruction: string): Promise<string> {
    const b64 = Buffer.from(image).toString("base64");
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: instruction },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${b64}` } },
            ],
          },
        ],
        max_tokens: 1024,
      }),
    });
    if (!res.ok) throw new Error(`llamacpp vision failed: ${res.status}`);
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content ?? "";
  }
}
