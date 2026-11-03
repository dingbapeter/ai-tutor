import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/store/memory.js";
import { buildApp } from "../src/app.js";
import { cleanLook } from "../src/tutor/look.js";
import {
  MockChatProvider,
  MockSttProvider,
  MockTtsProvider,
  MockVisionProvider,
  RulesModerationProvider,
} from "@tutor/ai-gateway";

function gateway() {
  return {
    chat: new MockChatProvider(),
    planner: new MockChatProvider(),
    premiumChat: new MockChatProvider(),
    stt: new MockSttProvider(),
    tts: new MockTtsProvider(),
    vision: new MockVisionProvider(),
    moderation: new RulesModerationProvider(),
  };
}

async function build(store: MemoryStore) {
  return buildApp({ gateway: gateway(), store, env: { NODE_ENV: "test", RATE_LIMIT_MAX: "10000", AUTH_RATE_LIMIT: "100000" } });
}

describe("tutor look validation (sprint 43)", () => {
  it("accepts known keys, clears on empty, rejects unknown", () => {
    expect(cleanLook({ skin: "brown", hair: "locs", hairColor: "violet" })).toEqual({
      ok: true,
      look: { skin: "brown", hair: "locs", hairColor: "violet" },
    });
    expect(cleanLook({ skin: "", hair: null })).toEqual({
      ok: true,
      look: { skin: null, hair: null, hairColor: null },
    });
    expect(cleanLook({ skin: "chartreuse" })).toEqual({ ok: false, error: "unknown skin tone" });
    expect(cleanLook({ hair: "mohawk" })).toEqual({ ok: false, error: "unknown hair style" });
    expect(cleanLook({ hairColor: "#fff" })).toEqual({ ok: false, error: "unknown hair colour" });
  });
});

describe("tutor look, end to end", () => {
  it("owner sets the look, it round-trips and rides into the session", async () => {
    const store = new MemoryStore();
    const app = await build(store);
    const token = (
      await app.inject({ method: "POST", url: "/auth/register", payload: { email: "fam@example.com", password: "password12", role: "parent" } })
    ).json().token as string;
    const studentId = (
      await app.inject({ method: "POST", url: "/students", headers: { authorization: `Bearer ${token}` }, payload: { displayName: "Ada" } })
    ).json().id as string;

    const put = await app.inject({
      method: "PUT",
      url: `/students/${studentId}/tutor-look`,
      headers: { authorization: `Bearer ${token}` },
      payload: { skin: "porcelain", hair: "straight", hairColor: "blonde" },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().look).toEqual({ skin: "porcelain", hair: "straight", hairColor: "blonde" });

    // The family list carries it for the picker.
    const me = await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${token}` } });
    expect(me.json().students[0].look).toEqual({ skin: "porcelain", hair: "straight", hairColor: "blonde" });

    // A session renders that look.
    const session = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: { authorization: `Bearer ${token}` },
      payload: { studentId, personaId: "amara", packId: "math-ms" },
    });
    expect(session.json().look).toEqual({ skin: "porcelain", hair: "straight", hairColor: "blonde" });

    // A bad value is refused; a stranger cannot touch it.
    const bad = await app.inject({
      method: "PUT",
      url: `/students/${studentId}/tutor-look`,
      headers: { authorization: `Bearer ${token}` },
      payload: { skin: "neon" },
    });
    expect(bad.statusCode).toBe(400);

    const stranger = (
      await app.inject({ method: "POST", url: "/auth/register", payload: { email: "x@example.com", password: "password12", role: "parent" } })
    ).json().token as string;
    const forbidden = await app.inject({
      method: "PUT",
      url: `/students/${studentId}/tutor-look`,
      headers: { authorization: `Bearer ${stranger}` },
      payload: { skin: "dark" },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});
