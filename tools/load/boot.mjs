/**
 * Boots the built api with mock AI and the in-memory store on PORT (default
 * 4000), rate limits opened wide so the load driver measures the platform
 * rather than its own throttling. The mathcheck verdict falls back to exact
 * string match when the service is not running, which is the honest local
 * default.
 */
import { buildApp } from "../../apps/api/dist/app.js";
import { MemoryStore } from "../../apps/api/dist/store/memory.js";
import {
  MockChatProvider, MockSttProvider, MockTtsProvider, MockVisionProvider, RulesModerationProvider,
} from "../../packages/ai-gateway/dist/index.js";

const planner = new MockChatProvider();
const app = await buildApp({
  gateway: {
    chat: new MockChatProvider(), planner, premiumChat: planner,
    stt: new MockSttProvider(), tts: new MockTtsProvider(),
    vision: new MockVisionProvider(), moderation: new RulesModerationProvider(),
  },
  store: new MemoryStore(),
  env: { NODE_ENV: "test", RATE_LIMIT_MAX: "1000000", GUEST_IP_CAP: "10000000", AUTH_RATE_LIMIT: "1000000" },
});
const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: "127.0.0.1" });
console.log(`LOAD_TARGET_READY on ${port}`);
