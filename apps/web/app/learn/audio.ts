/**
 * iPhone-safe audio.
 *
 * Safari (iOS especially) starts every AudioContext SUSPENDED and only lets
 * it resume inside a real user gesture. Two consequences drive this module:
 *
 *  1. If we route the tutor's voice through a suspended context (which is
 *     what an analyser for lip-sync does), the sound is swallowed entirely
 *     and the child hears NOTHING. Audibility always wins over lip-sync, so
 *     we only attach the analyser when the context is genuinely running.
 *  2. Older Safari and some in-app WebViews expose only `webkitAudioContext`.
 *     Checking bare `AudioContext` hides the hands-free button on those
 *     phones, so every lookup goes through one resolver.
 *
 * The decision helpers are pure so they can be tested without a browser.
 */

type WinLike = {
  AudioContext?: unknown;
  webkitAudioContext?: unknown;
};

/** The AudioContext constructor this browser actually has, or null. */
export function resolveAudioContextCtor(win: WinLike | undefined): (new () => AudioContext) | null {
  if (!win) return null;
  const ctor = win.AudioContext ?? win.webkitAudioContext;
  return typeof ctor === "function" ? (ctor as new () => AudioContext) : null;
}

/** True when this browser can do Web Audio at all (either spelling). */
export function hasWebAudio(win: WinLike | undefined): boolean {
  return resolveAudioContextCtor(win) !== null;
}

/**
 * Only analyse when the context is running. A suspended or closed context
 * would silence the voice the moment we route it, so we skip lip-sync and
 * let the face fall back to its natural talking wave.
 */
export function canAnalyse(ctx: { state?: string } | null | undefined): boolean {
  return !!ctx && ctx.state === "running";
}

let ctx: AudioContext | null = null;

/** The one shared context, created lazily. Null where Web Audio is absent. */
export function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = resolveAudioContextCtor(typeof window === "undefined" ? undefined : (window as WinLike));
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/**
 * Wake the audio engine. Safe to call often; only does real work while the
 * context is suspended. Must be reached from a user gesture on iOS, which is
 * what installAudioUnlock arranges.
 */
export function unlockAudio(): void {
  const c = audioContext();
  if (!c || c.state === "running") return;
  void c.resume().catch(() => {});
  try {
    // A silent tick: Safari treats an actually-played buffer as the unlock.
    const buf = c.createBuffer(1, 1, 22050);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(0);
  } catch {
    // An unlock that fails is not fatal: playback falls back to plain audio.
  }
}

/**
 * Unlock on the learner's first touch, tap or key. Returns a cleanup
 * function. The listeners remove themselves once the context is running.
 */
export function installAudioUnlock(): () => void {
  if (typeof window === "undefined") return () => {};
  const events = ["pointerdown", "touchend", "keydown"] as const;
  const onGesture = () => {
    unlockAudio();
    const c = audioContext();
    if (!c || c.state === "running") remove();
  };
  const remove = () => events.forEach((e) => window.removeEventListener(e, onGesture));
  events.forEach((e) => window.addEventListener(e, onGesture, { passive: true }));
  return remove;
}

type RecordWinLike = {
  MediaRecorder?: unknown;
  navigator?: { mediaDevices?: { getUserMedia?: unknown } };
};

/**
 * Can this browser actually CAPTURE the learner's voice?
 *
 * Opening the microphone and recording it are two different permissions of
 * the browser's making: some in-app browsers and older Safari hand over a
 * microphone and then have no recorder to put it in. Asking a child for
 * their microphone and then failing is worse than not offering, so the
 * talk button only appears where both halves exist.
 */
export function canCaptureVoice(win: RecordWinLike | undefined): boolean {
  if (!win) return false;
  return typeof win.MediaRecorder === "function" && typeof win.navigator?.mediaDevices?.getUserMedia === "function";
}

/** The audio format this browser can record in, or "" when it cannot say. */
export const RECORDING_FORMATS = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac"] as const;

export function pickRecordingFormat(
  isSupported: ((type: string) => boolean) | undefined,
  formats: readonly string[] = RECORDING_FORMATS,
): string {
  if (!isSupported) return "";
  return formats.find((t) => isSupported(t)) ?? "";
}
