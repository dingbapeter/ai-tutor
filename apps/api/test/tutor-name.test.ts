import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/store/memory.js";
import { buildApp } from "../src/app.js";
import { buildSystemPrompt, loadPack, loadPersonas } from "../src/tutor/prompt.js";
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
  return buildApp({
    gateway: gateway(),
    store,
    env: { NODE_ENV: "test", RATE_LIMIT_MAX: "10000", AUTH_RATE_LIMIT: "100000" },
  });
}

describe("name your tutor (sprint 40)", () => {
  it("the identity line reaches the system prompt only when a name is given", () => {
    const persona = loadPersonas()[0];
    const pack = loadPack("math-ms");
    const base = { persona, pack, studentName: "Ada", memoryLines: [] };
    const renamed = buildSystemPrompt({ ...base, tutorName: "Sparkle" });
    expect(renamed).toContain("you are called Sparkle");
    expect(renamed).toContain(`never use the name ${persona.name}`);
    const plain = buildSystemPrompt(base);
    expect(plain).not.toContain("you are called");
    // Saving the persona's own name back changes nothing.
    expect(buildSystemPrompt({ ...base, tutorName: persona.name })).not.toContain("you are called");
  });

  it("owner names the tutor, the session answers to it, and clearing restores the default", async () => {
    const store = new MemoryStore();
    const app = await build(store);
    const reg = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "fam@example.com", password: "password12", role: "parent" },
    });
    const token = (reg.json() as { token: string }).token;
    const add = await app.inject({
      method: "POST",
      url: "/students",
      headers: { authorization: `Bearer ${token}` },
      payload: { displayName: "Ada" },
    });
    const studentId = (add.json() as { id: string }).id;

    const put = await app.inject({
      method: "PUT",
      url: `/students/${studentId}/tutor-name`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "  Sparkle   Sun " },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().tutorName).toBe("Sparkle Sun"); // trimmed, spaces collapsed

    // The dashboard list carries it, so the picker can show it.
    const me = await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${token}` } });
    expect(me.json().students[0].tutorName).toBe("Sparkle Sun");

    // A session with this student introduces the tutor by the chosen name.
    const session = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: { authorization: `Bearer ${token}` },
      payload: { studentId, personaId: "amara", packId: "math-ms" },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().persona).toEqual({ id: "amara", name: "Sparkle Sun" });

    // Empty name clears back to the persona default.
    const clear = await app.inject({
      method: "PUT",
      url: `/students/${studentId}/tutor-name`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "   " },
    });
    expect(clear.json().tutorName).toBeNull();
    const again = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: { authorization: `Bearer ${token}` },
      payload: { studentId, personaId: "amara", packId: "math-ms" },
    });
    expect(again.json().persona.name).toBe("Amara");
  });

  it("rejects junk names and other families' students", async () => {
    const store = new MemoryStore();
    const app = await build(store);
    const reg = async (email: string) =>
      (
        await app.inject({
          method: "POST",
          url: "/auth/register",
          payload: { email, password: "password12", role: "parent" },
        })
      ).json().token as string;
    const owner = await reg("own@example.com");
    const stranger = await reg("other@example.com");
    const add = await app.inject({
      method: "POST",
      url: "/students",
      headers: { authorization: `Bearer ${owner}` },
      payload: { displayName: "Ada" },
    });
    const studentId = (add.json() as { id: string }).id;

    const junk = await app.inject({
      method: "PUT",
      url: `/students/${studentId}/tutor-name`,
      headers: { authorization: `Bearer ${owner}` },
      payload: { name: "<script>hi</script>" },
    });
    expect(junk.statusCode).toBe(400);

    const single = await app.inject({
      method: "PUT",
      url: `/students/${studentId}/tutor-name`,
      headers: { authorization: `Bearer ${owner}` },
      payload: { name: "x" },
    });
    expect(single.statusCode).toBe(400);

    const notMine = await app.inject({
      method: "PUT",
      url: `/students/${studentId}/tutor-name`,
      headers: { authorization: `Bearer ${stranger}` },
      payload: { name: "Sparkle" },
    });
    expect(notMine.statusCode).toBe(403);

    expect(await store.getTutorName(studentId)).toBeNull();
  });
});
