import type {
  ChatMessage,
  ChatOptions,
  ChatProvider,
  SttProvider,
  TtsProvider,
  TtsResult,
  VisionProvider,
} from "../types.js";

/**
 * Mock providers so the whole platform runs end-to-end on any laptop with no
 * models installed. The chat mock plays a Socratic tutor well enough to
 * exercise session flow, memory writes, and the UI.
 */

const CANNED_TURNS = [
  "Good question — before I answer, what do you already know about this? Walk me through your thinking so far.",
  "You're closer than you think. Look at your last step again: what happens to the value on the right-hand side?",
  "Almost! There's one small slip. Try that step once more, slowly — say each part out loud as you go.",
  "Exactly right. Now, why does that work? If you can explain it back to me, you own it.",
];

export class MockChatProvider implements ChatProvider {
  readonly name = "mock";
  private turn = 0;

  async *chat(_messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<string> {
    const reply = CANNED_TURNS[this.turn++ % CANNED_TURNS.length];
    for (const word of reply.split(" ")) {
      if (opts?.signal?.aborted) return;
      await new Promise((r) => setTimeout(r, 30));
      yield word + " ";
    }
  }
}

export class MockSttProvider implements SttProvider {
  readonly name = "mock";
  async transcribe(): Promise<string> {
    return "[mock transcription] I don't understand how to solve for x here.";
  }
}

export class MockTtsProvider implements TtsProvider {
  readonly name = "mock";
  async speak(text: string): Promise<TtsResult> {
    // 0.1s of silence as a valid WAV so audio pipelines can be tested.
    const sampleRate = 16000;
    const samples = sampleRate / 10;
    const buf = new ArrayBuffer(44 + samples * 2);
    const v = new DataView(buf);
    const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); v.setUint32(4, 36 + samples * 2, true); w(8, "WAVE");
    w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, "data"); v.setUint32(40, samples * 2, true);
    return {
      audio: new Uint8Array(buf),
      mimeType: "audio/wav",
      visemes: text.split(/\s+/).map((_, i) => ({ timeMs: i * 120, viseme: "aa" })),
    };
  }
}

export class MockVisionProvider implements VisionProvider {
  readonly name = "mock";
  async see(): Promise<string> {
    return "[mock vision] Handwritten worksheet: '2x + 3 = 11', student wrote x = 7 (error at step 2: subtracted 3 from left side only).";
  }
}
