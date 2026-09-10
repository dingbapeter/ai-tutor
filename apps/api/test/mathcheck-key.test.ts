import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The mathcheck client must present the shared brain key so the gate on the
 * model box lets it through. A stub server captures what actually goes over
 * the wire. Env is set BEFORE the module import because the client reads
 * MATHCHECK_URL at load time.
 */

let server: Server;
let seenKey: string | undefined = "never-called";
let verifyAnswer: typeof import("../src/mathcheck.js").verifyAnswer;

beforeAll(async () => {
  server = createServer((req, res) => {
    seenKey = req.headers["x-brain-key"] as string | undefined;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ correct: true }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  process.env.MATHCHECK_URL = `http://127.0.0.1:${port}`;
  process.env.BRAIN_KEY = "sesame-key";
  ({ verifyAnswer } = await import("../src/mathcheck.js"));
});

afterAll(() => {
  delete process.env.BRAIN_KEY;
  return new Promise<void>((r) => server.close(() => r()));
});

describe("mathcheck client and the brain key", () => {
  it("presents the key on solve checks", async () => {
    const ok = await verifyAnswer({ type: "solve", equation: "x + 1 = 3", variable: "x" }, "2");
    expect(ok).toBe(true);
    expect(seenKey).toBe("sesame-key");
  });

  it("presents the key on equivalence checks", async () => {
    seenKey = undefined;
    const ok = await verifyAnswer({ type: "equivalent", expression: "2*x" }, "x+x");
    expect(ok).toBe(true);
    expect(seenKey).toBe("sesame-key");
  });
});
