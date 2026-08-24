import type { AiGateway } from "./types.js";
import {
  MockChatProvider,
  MockSttProvider,
  MockTtsProvider,
  MockVisionProvider,
} from "./providers/mock.js";
import { LlamaCppChatProvider, LlamaCppVisionProvider } from "./providers/llamacpp.js";
import { WhisperSttProvider } from "./providers/whisper.js";
import { KokoroTtsProvider } from "./providers/kokoro.js";
import { RoutingTtsProvider } from "./providers/tts-router.js";
import { RulesModerationProvider } from "./providers/moderation-rules.js";
import { AnthropicModerationProvider } from "./providers/moderation-anthropic.js";

/**
 * Builds the gateway from environment config. This file is the ONLY place
 * that knows which engine backs which capability.
 *
 *   AI_CHAT_PROVIDER=llamacpp  LLAMACPP_URL=http://contabo-box:8080
 *
 * Adding a paid provider later = one new adapter file + one case below.
 */
export function createGatewayFromEnv(env: Record<string, string | undefined> = process.env): AiGateway {
  const llamaUrl = env.LLAMACPP_URL ?? "http://localhost:8080";
  const whisperUrl = env.WHISPER_URL ?? "http://localhost:8081";
  const ttsUrl = env.TTS_URL ?? "http://localhost:8082";

  const chatFor = (name: string | undefined) => {
    switch (name ?? "mock") {
      case "llamacpp":
        return new LlamaCppChatProvider(llamaUrl);
      case "mock":
        return new MockChatProvider();
      default:
        throw new Error(`Unknown chat provider: ${name}`);
    }
  };

  const stt = () => {
    switch (env.AI_STT_PROVIDER ?? "mock") {
      case "whisper":
        return new WhisperSttProvider(whisperUrl);
      case "mock":
        return new MockSttProvider();
      default:
        throw new Error(`Unknown STT provider: ${env.AI_STT_PROVIDER}`);
    }
  };

  const tts = () => {
    // Both engines can run side by side: set TTS_URL for Kokoro and
    // PIPER_TTS_URL for Piper, and voices route themselves by id shape.
    const piperUrl = env.PIPER_TTS_URL;
    switch (env.AI_TTS_PROVIDER ?? "mock") {
      case "kokoro": {
        const kokoro = new KokoroTtsProvider(ttsUrl, "kokoro");
        if (!piperUrl) return kokoro;
        return new RoutingTtsProvider(
          { kokoro, piper: new KokoroTtsProvider(piperUrl, "piper", "piper") },
          kokoro,
        );
      }
      case "piper":
        return new KokoroTtsProvider(piperUrl ?? ttsUrl, "piper", "piper");
      case "mock":
        return new MockTtsProvider();
      default:
        throw new Error(`Unknown TTS provider: ${env.AI_TTS_PROVIDER}`);
    }
  };

  const vision = () => {
    switch (env.AI_VISION_PROVIDER ?? "mock") {
      case "llamacpp":
        return new LlamaCppVisionProvider(llamaUrl);
      case "mock":
        return new MockVisionProvider();
      default:
        throw new Error(`Unknown vision provider: ${env.AI_VISION_PROVIDER}`);
    }
  };

  const moderation = () => {
    switch (env.AI_MODERATION_PROVIDER ?? "rules") {
      case "anthropic":
        return new AnthropicModerationProvider(env.ANTHROPIC_API_KEY);
      case "rules":
        return new RulesModerationProvider();
      default:
        throw new Error(`Unknown moderation provider: ${env.AI_MODERATION_PROVIDER}`);
    }
  };

  const planner = chatFor(env.AI_CHAT_PLANNER_PROVIDER ?? env.AI_CHAT_PROVIDER);
  return {
    chat: chatFor(env.AI_CHAT_PROVIDER),
    planner,
    premiumChat: env.AI_PREMIUM_CHAT_PROVIDER ? chatFor(env.AI_PREMIUM_CHAT_PROVIDER) : planner,
    stt: stt(),
    tts: tts(),
    vision: vision(),
    moderation: moderation(),
  };
}
