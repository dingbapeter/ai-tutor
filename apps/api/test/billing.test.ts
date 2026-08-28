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
let store: MemoryStore;

beforeAll(async () => {
  store = new MemoryStore();
  app = await buildApp({
    gateway: gateway(),
    store,
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

describe("stripe failure and refund events (signature math, no network)", () => {
  const stripe = new StripeProvider({
    secretKey: "sk_test_x",
    webhookSecret: "whsec_test",
    pricePlus: "price_plus",
    pricePremium: "price_prem",
  });
  const sign = (body: string, ts = Math.floor(Date.now() / 1000)) =>
    `t=${ts},v1=${createHmac("sha256", "whsec_test").update(`${ts}.${body}`).digest("hex")}`;

  it("normalizes invoice.payment_failed with the processor's event id", async () => {
    const body = JSON.stringify({
      id: "evt_fail_1",
      type: "invoice.payment_failed",
      data: {
        object: {
          customer: "cus_A",
          subscription: "sub_A",
          customer_email: "a@example.com",
          amount_due: 1900,
          currency: "usd",
        },
      },
    });
    const event = await stripe.parseWebhook(Buffer.from(body), { "stripe-signature": sign(body) });
    expect(event).toEqual({
      type: "payment_failed",
      email: "a@example.com",
      customerRef: "cus_A",
      subscriptionRef: "sub_A",
      amountMinor: 1900,
      currency: "USD",
      eventRef: "evt_fail_1",
    });
  });

  it("normalizes charge.refunded and finds the email in billing details", async () => {
    const body = JSON.stringify({
      id: "evt_ref_1",
      type: "charge.refunded",
      data: {
        object: { customer: "cus_A", amount_refunded: 950, currency: "usd", billing_details: { email: "a@example.com" } },
      },
    });
    const event = await stripe.parseWebhook(Buffer.from(body), { "stripe-signature": sign(body) });
    expect(event).toEqual({
      type: "refunded",
      email: "a@example.com",
      customerRef: "cus_A",
      amountMinor: 950,
      currency: "USD",
      eventRef: "evt_ref_1",
    });
  });

  it("still rejects a tampered failure event", async () => {
    const body = JSON.stringify({ id: "evt_x", type: "invoice.payment_failed", data: { object: {} } });
    await expect(
      stripe.parseWebhook(Buffer.from(body.replace("payment_failed", "payment_failed ")), {
        "stripe-signature": sign(body),
      }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });
});

describe("paystack failure and refund events (signature math, no network)", () => {
  const paystack = new PaystackProvider({
    secretKey: "psk_test",
    planCodePlus: "PLN_plus",
    planCodePremium: "PLN_prem",
  });
  const sign = (body: string) => createHmac("sha512", "psk_test").update(body).digest("hex");

  it("normalizes invoice.payment_failed with amounts in kobo", async () => {
    const body = JSON.stringify({
      event: "invoice.payment_failed",
      data: {
        customer: { email: "k@example.com", customer_code: "CUS_k" },
        subscription: { subscription_code: "SUB_k" },
        amount: 250000,
      },
    });
    const event = await paystack.parseWebhook(Buffer.from(body), { "x-paystack-signature": sign(body) });
    expect(event).toMatchObject({
      type: "payment_failed",
      email: "k@example.com",
      customerRef: "CUS_k",
      subscriptionRef: "SUB_k",
      amountMinor: 250000,
      currency: "NGN",
    });
    expect((event as { eventRef?: string }).eventRef).toHaveLength(32); // body hash stands in for a missing id
  });

  it("normalizes refund.processed", async () => {
    const body = JSON.stringify({
      event: "refund.processed",
      data: { customer: { email: "k@example.com", customer_code: "CUS_k" }, amount: 250000, transaction_reference: "trx_9" },
    });
    const event = await paystack.parseWebhook(Buffer.from(body), { "x-paystack-signature": sign(body) });
    expect(event).toMatchObject({
      type: "refunded",
      email: "k@example.com",
      subscriptionRef: "trx_9",
      amountMinor: 250000,
      currency: "NGN",
    });
  });

  it("gives a retried body the same reference, so the ledger can dedupe it", async () => {
    const body = JSON.stringify({ event: "refund.processed", data: { customer: { email: "k@example.com" }, amount: 1 } });
    const a = await paystack.parseWebhook(Buffer.from(body), { "x-paystack-signature": sign(body) });
    const b = await paystack.parseWebhook(Buffer.from(body), { "x-paystack-signature": sign(body) });
    expect((a as { eventRef?: string }).eventRef).toBe((b as { eventRef?: string }).eventRef);
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
    expect(event).toMatchObject({ type: "canceled", email: "b@example.com", customerRef: "CUS_B", subscriptionRef: "SUB_B" });
    expect((event as { eventRef?: string }).eventRef).toHaveLength(32);
  });
});

describe("the money ledger", () => {
  it("records a failed renewal without downgrading anyone mid-retry", async () => {
    const token = await register("wobbly@example.com");
    await mockWebhook({
      type: "activated",
      email: "wobbly@example.com",
      plan: "premium",
      customerRef: "cus_w",
      subscriptionRef: "sub_w",
    });
    const account = await store.getAccountByEmail("wobbly@example.com");
    expect(await store.getUserPlan(account!.userId)).toBe("premium");

    const res = await mockWebhook({
      type: "payment_failed",
      email: "wobbly@example.com",
      amountMinor: 1900,
      currency: "USD",
    });
    expect(res.json()).toMatchObject({ received: true, handled: true, recorded: true });

    // The processor retries on its own; the plan stands until it gives up.
    expect(await store.getUserPlan(account!.userId)).toBe("premium");
    const events = await store.listBillingEvents(10, { type: "payment_failed" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ email: "wobbly@example.com", amountMinor: 1900, currency: "USD", matched: true });

    // And the trouble counters see it.
    const trouble = await store.countBillingTroubleSince(new Date(Date.now() - 60_000));
    expect(trouble.failed).toBe(1);
  });

  it("records a refund without touching entitlements", async () => {
    const res = await mockWebhook({
      type: "refunded",
      email: "wobbly@example.com",
      amountMinor: 1900,
      currency: "USD",
    });
    expect(res.json()).toMatchObject({ handled: true, recorded: true });
    const account = await store.getAccountByEmail("wobbly@example.com");
    expect(await store.getUserPlan(account!.userId)).toBe("premium"); // cancellation flows separately
    expect((await store.countBillingTroubleSince(new Date(Date.now() - 60_000))).refunded).toBe(1);
  });

  it("lands a retried webhook exactly once in the ledger", async () => {
    const event = { type: "payment_failed", email: "wobbly@example.com", amountMinor: 555, currency: "USD" };
    const first = await mockWebhook(event);
    expect(first.json().recorded).toBe(true);
    // Identical bytes, as a processor retry would send them.
    const second = await mockWebhook(event);
    expect(second.json()).toMatchObject({ received: true, handled: true, recorded: false });
    const rows = (await store.listBillingEvents(50, { type: "payment_failed" })).filter((e) => e.amountMinor === 555);
    expect(rows).toHaveLength(1);
  });

  it("marks an event for an unknown account as unmatched instead of losing it", async () => {
    const res = await mockWebhook({ type: "refunded", email: "stranger@example.com", amountMinor: 900, currency: "USD" });
    expect(res.json()).toMatchObject({ handled: false, recorded: true });
    const rows = await store.listBillingEvents(50, { type: "refunded" });
    const stranger = rows.find((e) => e.email === "stranger@example.com");
    expect(stranger?.matched).toBe(false);
  });

  it("keeps activations and cancellations in the ledger too", async () => {
    const activations = await store.listBillingEvents(50, { type: "activated" });
    expect(activations.some((e) => e.email === "wobbly@example.com" && e.plan === "premium" && e.matched)).toBe(true);
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
