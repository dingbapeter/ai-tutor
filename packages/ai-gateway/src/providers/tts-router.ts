import type { TtsProvider, TtsResult } from "../types.js";

/**
 * One mouth, several engines. Kokoro serves the languages it covers well;
 * Piper covers the long tail; a trained-in-house engine can join later.
 *
 * Routing is by voice-id shape, which keeps the promise that nothing outside
 * this package knows which engine runs. Kokoro ids are speaker handles
 * ("af_heart", "zm_yunjian"); Piper ids carry a locale and speaker
 * ("sw_CD-lanfrica-medium", "en_US-lessac-medium").
 */
export class RoutingTtsProvider implements TtsProvider {
  readonly name: string;

  constructor(
    private readonly routes: { kokoro?: TtsProvider; piper?: TtsProvider },
    private readonly fallback: TtsProvider,
  ) {
    const active = Object.entries(routes)
      .filter(([, p]) => p)
      .map(([k]) => k);
    this.name = active.length ? `routing(${active.join("+")})` : fallback.name;
  }

  /** Piper voices are locale-prefixed and hyphenated; Kokoro voices are not. */
  static isPiperVoice(voiceId: string): boolean {
    return /^[a-z]{2}(_[A-Za-z]{2,3})?-/.test(voiceId);
  }

  speak(text: string, voiceId: string): Promise<TtsResult> {
    const engine = RoutingTtsProvider.isPiperVoice(voiceId) ? this.routes.piper : this.routes.kokoro;
    return (engine ?? this.fallback).speak(text, voiceId);
  }
}
