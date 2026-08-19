/**
 * The provider-abstraction layer. Everything above this file (API, pedagogy,
 * sessions) talks only to these four interfaces. Engines behind them are
 * chosen by config (see config.ts) — swapping self-hosted for a paid API,
 * or routing one capability to a stronger model, is a config change.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** Abort long generations (student interrupted, session ended). */
  signal?: AbortSignal;
}

export interface ChatProvider {
  readonly name: string;
  /** Streamed completion. Yields text deltas as they arrive. */
  chat(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<string>;
}

export interface SttProvider {
  readonly name: string;
  /** Transcribe an audio buffer (wav/ogg/webm) to text. */
  transcribe(audio: Uint8Array, mimeType: string, language?: string): Promise<string>;
}

export interface TtsResult {
  audio: Uint8Array;
  mimeType: string;
  /** Phoneme/viseme timings for browser-side avatar lip-sync, when the engine provides them. */
  visemes?: Array<{ timeMs: number; viseme: string }>;
}

export interface TtsProvider {
  readonly name: string;
  speak(text: string, voiceId: string): Promise<TtsResult>;
}

export interface VisionProvider {
  readonly name: string;
  /** Describe/extract from an image (homework photo, textbook page). */
  see(image: Uint8Array, mimeType: string, instruction: string): Promise<string>;
}

export interface ModerationVerdict {
  /** True when the text should not pass through unchanged. */
  flagged: boolean;
  /** e.g. ["self-harm"], ["contact-exchange"], ["jailbreak"] */
  categories: string[];
  /** none < concern < danger. danger triggers guardian alerts. */
  severity: "none" | "concern" | "danger";
}

export interface ModerationProvider {
  readonly name: string;
  moderate(text: string, direction: "student" | "tutor"): Promise<ModerationVerdict>;
}

/** The single object the rest of the codebase imports. */
export interface AiGateway {
  /** Live conversational turns — the cheap, always-on engine. */
  chat: ChatProvider;
  /** Lesson planning & weekly analysis — the slot you may upgrade to a frontier model. */
  planner: ChatProvider;
  stt: SttProvider;
  tts: TtsProvider;
  vision: VisionProvider;
  /** Safety gate for a kids' product. Never optional — worst case is `rules`. */
  moderation: ModerationProvider;
}
