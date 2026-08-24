import { describe, expect, it, beforeAll } from "vitest";
import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  MockChatProvider,
  MockSttProvider,
  MockTtsProvider,
  MockVisionProvider,
  RulesModerationProvider,
} from "@tutor/ai-gateway";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/store/memory.js";
import { StripeProvider, PaystackProvider, WebhookSignatureError } from "../src/billing.js";

/**
 * Sprint 6b tests. Two layers:
 *  - Provider units: real Stripe/Paystack signature math against fixture
 *    payloads (the exact HMAC schemes the live services use) — no network.
 *  - App integration: the mock billing provider drives the full webhook →
 *    plan-flip → entitlements path, plus the email-verification flow.
 */

function gateway() {
  const planner = new MockChatProvider();
  return {
    chat: new MockChatProvider(),
    planner,
    premiumChat: planner,
    stt: new MockSttProvider(),
    tts: new MockTtsProvider(),
    vision: new MockVisionProvider(),
    moderation: new RulesModerationProvider(),
  };
}

const MOCK_SECRET = "test-billing-secret";
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({
    gateway: gateway(),
    store: new MemoryStore(),
    env: {
      NODE_ENV: "test",
      RATE_LIMIT_MAX: "10000",
      GUEST_IP_CAP: "100000",
      AUTH_RATE_LIMIT: "100000",
      BILLING_PROVIDER: "mock",
      MOCK_BILLING_SECRET: MOCK_SECRET,
    },
  });
});

async function register(email: string) {
  const res = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email, password: "hunter22222", displayName: "Test Parent" },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

function mockWebhook(event: object) {
  const body = JSON.stringify(event);
  return app.inject({
    method: "POST",
    url: "/billing/webhook",
    headers: {
      "content-type": "application/json",
      "x-mock-signature": createHmac("sha256", MOCK_SECRET).update(body).digest("hex"),
    },
    payload: body,
  });
}

describe("billing endpoints", () => {
  it("reports configuration status", async () => {
    const res = await app.inject({ method: "GET", url: "/billing/status" });
    expect(res.json()).toMatchObject({ configured: true, provider: "mock" });
  });

  it("requires auth for checkout", async () => {
    const res = await app.inject({ method: "POST", url: "/billing/checkout", payload: { plan: "plus" } });
    expect(res.statusCode).toBe(401);
  });

  it("returns a checkout URL for a signed-in user", async () => {
    const token = await register("checkout@example.com");
    const res = await app.inject({
      method: "POST",
      url: "/billing/checkout",
      headers: { authorization: `Bearer ${token}` },
      payload: { plan: "premium" },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { url: string }).url).toContain("mock-checkout-premium");
  });

  it("rejects a webhook with a bad signature and changes nothing", async () => {
    const token = await register("victim@example.com");
    const body = JSON.stringify({
      type: "activated",
      email: "victim@example.com",
      plan: "premium",
      customerRef: "c1",
      subscriptionRef: "s1",
    });
    const res = await app.inject({
      method: "POST",
      url: "/billing/webhook",
      headers: { "content-type": "application/json", "x-mock-signature": "0".repeat(64) },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    const me = await app.inject({ method: "GET", url: "/me/usage", headers: { authorization: `Bearer ${token}` } });
    expect((me.json() as { plan: string }).plan).toBe("free");
  });

  it("activates a plan on a signed webhook and entitlements follow", async () => {
    const token = await register("payer@example.com");
    const res = await mockWebhook({
      type: "activated",
      email: "payer@example.com",
      plan: "premium",
      customerRef: "cus_1",
      subscriptionRef: "sub_1",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ handled: true });

    const usage = await app.inject({ method: "GET", url: "/me/usage", headers: { authorization: `Bearer ${token}` } });
    expect((usage.json() as { plan: string }).plan).toBe("premium");

    const billing = await app.inject({ method: "GET", url: "/me/billing", headers: { authorization: `Bearer ${token}` } });
    expect(billing.json()).toMatchObject({
      subscription: { provider: "mock", plan: "premium", status: "active", subscriptionRef: "sub_1" },
    });
  });

  it("downgrades on cancellation via subscription ref alone (no email in payload)", async () => {
    const token = await register("churner@example.com");
    await mockWebhook({
      type: "activated",
      email: "churner@example.com",
      plan: "plus",
      customerRef: "cus_2",
      subscriptionRef: "sub_2",
    });
    const res = await mockWebhook({ type: "canceled", subscriptionRef: "sub_2" });
    expect(res.json()).toMatchObject({ handled: true });
    const usage = await app.inject({ method: "GET", url: "/me/usage", headers: { authorization: `Bearer ${token}` } });
    expect((usage.json() as { plan: string }).plan).toBe("free");
  });

  it("acknowledges but flags an authentic event for an unknown account", async () => {
    const res = await mockWebhook({
      type: "activated",
      email: "nobody@example.com",
      plan: "plus",
      customerRef: "cus_x",
      subscriptionRef: "sub_x",
    });
    expect(res.statusCode).toBe(200); // 200 stops provider retries; error is logged
    expect(res.json()).toMatchObject({ handled: false });
  });
});

describe("stripe provider (signature math, no network)", () => {
  const stripe = new StripeProvider({
    secretKey: "sk_test_x",
    webhookSecret: "whsec_test",
    pricePlus: "price_plus",
    pricePremium: "price_prem",
  });

  function sign(body: string, ts = Math.floor(Date.now() / 1000)) {
    const v1 = createHmac("sha256", "whsec_test").update(`${ts}.${body}`).digest("hex");
    return `t=${ts},v1=${v1}`;
  }

  const checkoutCompleted = JSON.stringify({
    type: "checkout.session.completed",
    data: {
      object: {
        customer: "cus_A",
        subscription: "sub_A",
        customer_details: { email: "a@example.com" },
        metadata: { plan: "premium" },
      },
    },
  });

  it("accepts a correctly signed event", async () => {
    const event = await stripe.parseWebhook(Buffer.from(checkoutCompleted), {
      "stripe-signature": sign(checkoutCompleted),
    });
    expect(event).toEqual({
      type: "activated",
      email: "a@example.com",
      plan: "premium",
      customerRef: "cus_A",
      subscriptionRef: "sub_A",
    });
  });

  it("rejects a tampered body", async () => {
    const sig = sign(checkoutCompleted);
    const tampered = checkoutCompleted.replace("premium", "pluuuus");
    await expect(stripe.parseWebhook(Buffer.from(tampered), { "stripe-signature": sig })).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
  });

  it("rejects a stale timestamp (replay window)", async () => {
    const oldTs = Math.floor(Date.now() / 1000) - 3600;
    await expect(
      stripe.parseWebhook(Buffer.from(checkoutCompleted), { "stripe-signature": sign(checkoutCompleted, oldTs) }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it("normalizes subscription deletion to a cancellation", async () => {
    const body = JSON.stringify({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_A", customer: "cus_A" } },
    });
    const event = await stripe.parseWebhook(Buffer.from(body), { "stripe-signature": sign(body) });
    expect(event).toEqual({ type: "canceled", customerRef: "cus_A", subscriptionRef: "sub_A" });
  });

  it("ignores authentic but irrelevant events", async () => {
    const body = JSON.stringify({ type: "invoice.paid", data: { object: {} } });
    expect(await stripe.parseWebhook(Buffer.from(body), { "stripe-signature": sign(body) })).toBeNull();
  });
});

describe("paystack provider (signature math, no network)", () => {
  const paystack = new PaystackProvider({
    secretKey: "sk_ps_test",
    planCodePlus: "PLN_plus",
    planCodePremium: "PLN_prem",
  });

  const sign = (body: string) => createHmac("sha512", "sk_ps_test").update(body).digest("hex");

  const charge = JSON.stringify({
    event: "charge.success",
    data: {
      customer: { email: "b@example.com", customer_code: "CUS_B" },
      plan: { plan_code: "PLN_plus" },
      subscription_code: "SUB_B",
    },
  });

  it("accepts a correctly signed charge and maps the plan code", async () => {
    const event = await paystack.parseWebhook(Buffer.from(charge), { "x-paystack-signature": sign(charge) });
    expect(event).toEqual({
      type: "activated",
      email: "b@example.com",
      plan: "plus",
      customerRef: "CUS_B",
      subscriptionRef: "SUB_B",
    });
  });

  it("rejects a bad signature", async () => {
    await expect(
      paystack.parseWebhook(Buffer.from(charge), { "x-paystack-signature": "f".repeat(128) }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it("ignores a charge for an unknown plan code (one-off payments)", async () => {
    const body = JSON.stringify({
      event: "charge.success",
      data: { customer: { email: "b@example.com" }, plan: { plan_code: "PLN_other" } },
    });
    expect(await paystack.parseWebhook(Buffer.from(body), { "x-paystack-signature": sign(body) })).toBeNull();
  });

  it("normalizes subscription.disable to a cancellation", async () => {
    const body = JSON.stringify({
      event: "subscription.disable",
      data: { customer: { email: "b@example.com", customer_code: "CUS_B" }, subscription_code: "SUB_B" },
    });
    const event = await paystack.parseWebhook(Buffer.from(body), { "x-paystack-signature": sign(body) });
    expect(event).toEqual({ type: "canceled", email: "b@example.com", customerRef: "CUS_B", subscriptionRef: "SUB_B" });
  });
});

describe("email verification", () => {
  it("registers unverified, verifies via token, and reflects it in /me", async () => {
    // The raw token normally travels by email; tests reach into the store's
    // hash the same way the endpoint would — via a fresh resend + direct use.
    const store = new MemoryStore();
    const localApp = await buildApp({
      gateway: gateway(),
      store,
      env: { NODE_ENV: "test", RATE_LIMIT_MAX: "10000", GUEST_IP_CAP: "100000", AUTH_RATE_LIMIT: "100000" },
    });
    const reg = await localApp.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: "kid@example.com", password: "hunter22222" },
    });
    const token = (reg.json() as { token: string }).token;

    const before = await localApp.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${token}` } });
    expect((before.json() as { emailVerified: boolean }).emailVerified).toBe(false);

    // Mint a verification the way the API does, but keep the raw token.
    const { createHash, randomBytes } = await import("node:crypto");
    const raw = randomBytes(24).toString("hex");
    const account = await store.getAccountByEmail("kid@example.com");
    await store.createEmailVerification(account!.userId, createHash("sha256").update(raw).digest("hex"));

    const bad = await localApp.inject({ method: "POST", url: "/auth/verify", payload: { token: "0".repeat(48) } });
    expect(bad.statusCode).toBe(400);

    const ok = await localApp.inject({ method: "POST", url: "/auth/verify", payload: { token: raw } });
    expect(ok.statusCode).toBe(200);

    const after = await localApp.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${token}` } });
    expect((after.json() as { emailVerified: boolean }).emailVerified).toBe(true);

    // Single use: the same token cannot verify twice.
    const replay = await localApp.inject({ method: "POST", url: "/auth/verify", payload: { token: raw } });
    expect(replay.statusCode).toBe(400);

    const resend = await localApp.inject({
      method: "POST",
      url: "/auth/resend-verification",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resend.json()).toMatchObject({ alreadyVerified: true });
  });
});
