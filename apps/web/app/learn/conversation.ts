/**
 * Conversation mode: the tutor listens continuously, hears the learner out,
 * answers, and can be interrupted by simply speaking over it.
 *
 * All of it runs in the browser against the existing /voice round trip; no
 * new infrastructure. An analyser watches microphone energy; sustained
 * sound opens an utterance, sustained silence closes it and hands the
 * finished clip to the page to send. The recorder runs from the previous
 * segment's end, so the opening syllable of an utterance is never clipped,
 * and it is restarted during long quiet stretches so silence never piles up
 * in memory.
 *
 * Barge-in: while the tutor's voice is playing, the bar to count as speech
 * is higher (the mic hears some of the tutor through the speakers even with
 * echo cancellation). Clearing that higher bar stops playback and starts
 * capturing the learner immediately.
 *
 * The decisions live in VadFsm, which is pure (numbers in, events out) and
 * unit-tested; ConversationLoop is the thin browser shell around it.
 */

export type ConversationState = "listening" | "hearing" | "off";

export interface ConversationTuning {
  /** RMS above this counts as speech (0..1 scale). */
  speechRms: number;
  /** RMS needed to interrupt the tutor mid-sentence. */
  bargeInRms: number;
  /** Sustained sound needed to open an utterance. */
  startMs: number;
  /** Sustained quiet that ends an utterance. */
  endSilenceMs: number;
  /** Hard cap per utterance. */
  maxUtteranceMs: number;
  /** Clips below this much voiced time are discarded as noise. */
  minVoicedMs: number;
  /** Recycle the recorder after this much speechless listening. */
  idleRecycleMs: number;
}

export const DEFAULT_TUNING: ConversationTuning = {
  speechRms: 0.02,
  bargeInRms: 0.06,
  startMs: 150,
  endSilenceMs: 900,
  maxUtteranceMs: 20_000,
  minVoicedMs: 350,
  idleRecycleMs: 20_000,
};

export type VadEvent =
  | { kind: "open"; bargeIn: boolean }
  | { kind: "close"; voicedEnough: boolean }
  | { kind: "recycle" };

/** Pure voice-activity state machine: energy readings in, decisions out. */
export class VadFsm {
  private tuning: ConversationTuning;
  private capturing = false;
  private voicedMs = 0;
  private silenceMs = 0;
  private utteranceMs = 0;
  private idleMs = 0;

  constructor(tuning: ConversationTuning = DEFAULT_TUNING) {
    this.tuning = tuning;
  }

  isCapturing(): boolean {
    return this.capturing;
  }

  reset(): void {
    this.capturing = false;
    this.voicedMs = 0;
    this.silenceMs = 0;
    this.utteranceMs = 0;
    this.idleMs = 0;
  }

  feed(level: number, tutorSpeaking: boolean, dtMs: number): VadEvent | null {
    if (!this.capturing) {
      // While the tutor talks, only a clearly louder voice counts: the mic
      // hears some of the tutor through the speakers.
      const threshold = tutorSpeaking ? this.tuning.bargeInRms : this.tuning.speechRms;
      const voiced = level >= threshold;
      this.idleMs += dtMs;
      this.voicedMs = voiced ? this.voicedMs + dtMs : 0;
      if (this.voicedMs >= this.tuning.startMs) {
        this.capturing = true;
        this.utteranceMs = this.voicedMs;
        this.silenceMs = 0;
        this.idleMs = 0;
        return { kind: "open", bargeIn: tutorSpeaking };
      }
      if (this.idleMs >= this.tuning.idleRecycleMs) {
        this.idleMs = 0;
        return { kind: "recycle" };
      }
      return null;
    }

    const voiced = level >= this.tuning.speechRms;
    this.utteranceMs += dtMs;
    this.silenceMs = voiced ? 0 : this.silenceMs + dtMs;
    const done = this.silenceMs >= this.tuning.endSilenceMs || this.utteranceMs >= this.tuning.maxUtteranceMs;
    if (!done) return null;
    const voicedEnough = this.utteranceMs - this.silenceMs >= this.tuning.minVoicedMs;
    this.reset();
    return { kind: "close", voicedEnough };
  }
}

export interface ConversationHooks {
  /** A finished utterance, ready for the /voice round trip. */
  onSegment(blob: Blob): void;
  onState(state: ConversationState): void;
  /** The tutor's voice is playing right now. */
  isTutorSpeaking(): boolean;
  /** The learner spoke over the tutor: stop playback before capturing. */
  onBargeIn(): void;
  onError(message: string): void;
}

const TICK_MS = 50;

export function conversationSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined" &&
    typeof AudioContext !== "undefined"
  );
}

export class ConversationLoop {
  private hooks: ConversationHooks;
  private fsm: VadFsm;
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private mime = "";
  private stopping = false;

  constructor(hooks: ConversationHooks, tuning: Partial<ConversationTuning> = {}) {
    this.hooks = hooks;
    this.fsm = new VadFsm({ ...DEFAULT_TUNING, ...tuning });
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.stopping = false;
    try {
      // Echo cancellation matters here: it is what lets the mic stay open
      // while the tutor speaks without hearing mostly the tutor.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      this.hooks.onError("We can't reach your microphone. Check permissions and try again.");
      throw new Error("mic unavailable");
    }
    this.audioCtx = new AudioContext();
    const source = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 1024;
    source.connect(this.analyser);
    this.mime =
      ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac"].find((t) =>
        MediaRecorder.isTypeSupported?.(t),
      ) ?? "";
    this.startRecorder();
    this.fsm.reset();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.hooks.onState("listening");
  }

  stop(): void {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      this.recorder?.stop();
    } catch {
      /* already stopped */
    }
    this.recorder = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.analyser = null;
    this.hooks.onState("off");
  }

  /** Current mic energy, 0..1. */
  rms(): number {
    if (!this.analyser) return 0;
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    return Math.sqrt(sum / data.length);
  }

  private startRecorder(): void {
    if (!this.stream) return;
    this.chunks = [];
    const rec = this.mime ? new MediaRecorder(this.stream, { mimeType: this.mime }) : new MediaRecorder(this.stream);
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder = rec;
    rec.start(250);
  }

  /** Stop the current recorder and resolve with everything it heard. */
  private harvest(): Promise<Blob> {
    return new Promise((resolve) => {
      const rec = this.recorder;
      if (!rec || rec.state === "inactive") return resolve(new Blob([], { type: this.mime || "audio/webm" }));
      rec.onstop = () => resolve(new Blob(this.chunks, { type: rec.mimeType || this.mime || "audio/webm" }));
      rec.stop();
    });
  }

  private tick(): void {
    if (!this.analyser || this.stopping) return;
    const evt = this.fsm.feed(this.rms(), this.hooks.isTutorSpeaking(), TICK_MS);
    if (!evt) return;
    if (evt.kind === "open") {
      if (evt.bargeIn) this.hooks.onBargeIn();
      this.hooks.onState("hearing");
      return;
    }
    if (evt.kind === "recycle") {
      // Nothing said for a while: throw the silent recording away so it
      // never grows without bound, and start fresh.
      void this.harvest().then(() => {
        if (!this.stopping) this.startRecorder();
      });
      return;
    }
    void this.harvest().then((blob) => {
      if (this.stopping) return;
      this.startRecorder();
      this.hooks.onState("listening");
      if (evt.voicedEnough && blob.size > 1000) this.hooks.onSegment(blob);
    });
  }
}
