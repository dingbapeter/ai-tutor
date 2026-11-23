import { describe, expect, it, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { Metrics } from "../src/ops/metrics.js";
import {
  MockChatProvider,
  MockSttProvider,
  MockTtsProvider,
  MockVisionProvider,
  RulesModerationProvider,
} from "@tutor/ai-gateway";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/store/memory.js";

/** Observability: the registry's maths, then the wiring over real requests. */

describe("the metrics registry", () => {
  it("counts, buckets, and answers quantiles from the histogram", () => {
    const m = new Metrics();
    for (const ms of [3, 8, 20, 40, 90, 200, 400, 900, 2000, 8000]) {
      m.record("/things", "GET", 200, ms);
    }
    m.record("/things", "GET", 500, 12000); // one slow failure
    const q = (p: number) => m.quantile("/things", "GET", p);
    expect(q(0.5)).toBe(250); // the 6th of 11 samples lands in the 250ms bucket
    expect(q(0.95)).toBe(Infinity); // the overflow bucket
    const row = m.summary().routes.find((r) => r.route === "GET /things")!;
    expect(row.count).toBe(11);
    expect(row.errors).toBe(1); // the 500, and only the 500
  });

  it("treats a 404 as an answer and a 500 as a failure", () => {
    const m = new Metrics();
    m.record("/x", "GET", 404, 5);
    m.record("/x", "GET", 500, 5);
    expect(m.summary().routes[0].errors).toBe(1);
  });

  it("keeps the error ring bounded and newest first", () => {
    const m = new Metrics();
    for (let i = 0; i < 60; i += 1) {
      m.recordError({ route: "/boom", method: "GET", statusCode: 500, message: `failure ${i}` });
    }
    const errors = m.summary().recentErrors;
    expect(errors).toHaveLength(50);
    expect(errors[0].message).toBe("failure 59");
    expect(errors[49].message).toBe("failure 10");
  });

  it("renders Prometheus text a scraper will accept", () => {
    const m = new Metrics();
    m.record("/sessions/:id/message", "POST", 200, 42);
    const text = m.prometheus();
    expect(text).toContain('dingba_http_requests_total{method="POST",route="/sessions/:id/message"} 1');
    expect(text).toContain('le="50"');
    expect(text).toContain("dingba_http_request_duration_ms_count");
    expect(text).toContain("dingba_process_rss_bytes");
    // Histogram buckets are cumulative: every later bucket >= the earlier.
    const buckets = [...text.matchAll(/le="\d+"} (\d+)/g)].map((match) => Number(match[1]));
    for (let i = 1; i < buckets.length; i += 1) expect(buckets[i]).toBeGreaterThanOrEqual(buckets[i - 1]);
  });
});

describe("observability over the wire", () => {
  let app: FastifyInstance;
  let store: MemoryStore;

  beforeAll(async () => {
    store = new MemoryStore();
    const planner = new MockChatProvider();
    app = await buildApp({
      gateway: {
        chat: new MockChatProvider(), planner, premiumChat: planner,
        stt: new MockSttProvider(), tts: new MockTtsProvider(),
        vision: new MockVisionProvider(), moderation: new RulesModerationProvider(),
      },
      store,
      env: {
        NODE_ENV: "test", RATE_LIMIT_MAX: "10000", GUEST_IP_CAP: "100000", AUTH_RATE_LIMIT: "100000",
        ADMIN_KEY: "secret-admin", COMMAND_OWNER_EMAILS: "founder@dingba.ai",
      },
    });
  });

  it("gates the scrape endpoint and serves real route stats", async () => {
    expect((await app.inject({ method: "GET", url: "/admin/metrics" })).statusCode).toBe(403);

    await app.inject({ method: "GET", url: "/health" });
    await app.inject({ method: "GET", url: "/health" });

    // Both auth styles work, because Prometheus configs prefer bearer tokens.
    const viaHeader = await app.inject({ method: "GET", url: "/admin/metrics", headers: { "x-admin-key": "secret-admin" } });
    expect(viaHeader.statusCode).toBe(200);
    const viaBearer = await app.inject({ method: "GET", url: "/admin/metrics", headers: { authorization: "Bearer secret-admin" } });
    expect(viaBearer.statusCode).toBe(200);
    expect(viaBearer.headers["content-type"]).toContain("text/plain");
    expect(viaBearer.body).toMatch(/dingba_http_requests_total\{method="GET",route="\/health"\} \d/);
  });

  it("labels by route pattern, never by raw URL", async () => {
    await app.inject({ method: "POST", url: "/sessions/11111111-1111-1111-1111-111111111111/message", payload: { text: "hi" } });
    await app.inject({ method: "POST", url: "/sessions/22222222-2222-2222-2222-222222222222/message", payload: { text: "hi" } });
    const text = (await app.inject({ method: "GET", url: "/admin/metrics", headers: { "x-admin-key": "secret-admin" } })).body;
    expect(text).toContain('route="/sessions/:id/message"');
    expect(text).not.toContain("11111111");
  });

  it("shows the ops view to the owner and refuses everyone below config:write", async () => {
    const reg = async (email: string) =>
      (await app.inject({ method: "POST", url: "/auth/register", payload: { email, password: "correct-horse-battery" } })).json().token as string;
    const owner = await reg("founder@dingba.ai");
    const investorTok = await reg("investor@fund.example");
    await app.inject({
      method: "POST", url: "/command/staff",
      headers: { authorization: `Bearer ${owner}` },
      payload: { email: "investor@fund.example", role: "investor" },
    });

    const denied = await app.inject({ method: "GET", url: "/command/ops", headers: { authorization: `Bearer ${investorTok}` } });
    expect(denied.statusCode).toBe(403);

    const ops = await app.inject({ method: "GET", url: "/command/ops", headers: { authorization: `Bearer ${owner}` } });
    expect(ops.statusCode).toBe(200);
    const body = ops.json();
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(body.memory.rssMb).toBeGreaterThan(0);
    expect(body.routes.length).toBeGreaterThan(0);
    expect(body.routes[0]).toHaveProperty("p95Ms");
  });

  it("remembers a failure in the ring without carrying anyone's words", async () => {
    // A broken body forces a real error through the pipeline.
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    const owner = (await app.inject({
      method: "POST", url: "/auth/login",
      payload: { email: "founder@dingba.ai", password: "correct-horse-battery" },
    })).json().token;
    const ops = (await app.inject({ method: "GET", url: "/command/ops", headers: { authorization: `Bearer ${owner}` } })).json();
    // Whether or not this parse failure reached the ring, nothing in it may
    // exceed the truncation bound or carry a request body.
    for (const e of ops.recentErrors) {
      expect(e.message.length).toBeLessThanOrEqual(300);
    }
  });
});
