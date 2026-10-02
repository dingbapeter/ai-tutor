import { createHmac } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MockChatProvider,
  MockSttProvider,
  MockTtsProvider,
  MockVisionProvider,
  RulesModerationProvider,
} from "@tutor/ai-gateway";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/store/memory.js";
import { PaystackProvider, StripeProvider, billingFromEnv } from "../src/billing.js";
import { chooseCurrency, currenciesOnOffer, providerFor, quoteFor, suggestedCurrency, toMajor, type Price } from "../src/pricing.js";

/**
 * Two processors at once, with prices read from the processors themselves.
 * A stand-in for Stripe's and Paystack's APIs runs on a local port and
 * records every call, so the real HTTP shapes are exercised with no network.
 */

const STRIPE_KEY = "sk_test_stand_in";
const STRIPE_WEBHOOK = "whsec_stand_in";
const PAYSTACK_KEY = "sk_test_paystack_stand_in";

interface Stub {
  url: string;
  calls: Array<{ method: string; url: string; body: string }>;
  stripeDown: boolean;
  close: () => Promise<void>;
}

async function standIn(): Promise<Stub> {
  const srv = Fastify();
  const calls: Stub["calls"] = [];
  const stub: Stub = { url: "", calls, stripeDown: false, close: () => srv.close() };
  srv.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_r, b, d) => d(null, b));
  srv.addHook("onRequest", async (req) => {
    calls.push({ method: req.method, url: req.url, body: "" });
  });
  srv.addHook("preHandler", async (req) => {
    calls[calls.length - 1].body = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? "");
  });
  // Stripe: one price per plan, in dollars with pounds and euros as options.
  srv.get("/v1/prices/:id", async (req, reply) => {
    if (stub.stripeDown) return reply.code(500).send({ error: "down" });
    const id = (req.params as { id: string }).id;
    const base = id === "price_plus" ? 500 : 1200;
    return {
      id,
      currency: "usd",
      unit_amount: base,
      currency_options: { usd: { unit_amount: base }, gbp: { unit_amount: Math.round(base * 0.8) }, eur: { unit_amount: Math.round(base * 0.92) } },
    };
  });
  srv.post("/v1/checkout/sessions", async (req) => ({ url: `https://checkout.stripe.test/${encodeURIComponent(String(req.body))}` }));
  // Paystack: plans in naira, and a Ghanaian pair.
  srv.get("/plan/:code", async (req) => {
    const code = (req.params as { code: string }).code;
    const table: Record<string, { amount: number; currency: string }> = {
      PLN_plus_ngn: { amount: 250000, currency: "NGN" },
      PLN_premium_ngn: { amount: 750000, currency: "NGN" },
      PLN_plus_ghs: { amount: 6000, currency: "GHS" },
      PLN_premium_ghs: { amount: 15000, currency: "GHS" },
    };
    return { status: true, data: table[code] };
  });
  srv.post("/transaction/initialize", async (req) => ({
    status: true,
    data: { authorization_url: `https://checkout.paystack.test/${encodeURIComponent(JSON.stringify(req.body))}` },
  }));
  await srv.listen({ port: 0, host: "127.0.0.1" });
  const addr = srv.server.address();
  stub.url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  return stub;
}

function envFor(stub: Stub, only?: string) {
  return {
    NODE_ENV: "test",
    RATE_LIMIT_MAX: "10000",
    GUEST_IP_CAP: "100000",
    AUTH_RATE_LIMIT: "100000",
    ...(only ? { BILLING_PROVIDER: only } : {}),
    STRIPE_SECRET_KEY: STRIPE_KEY,
    STRIPE_WEBHOOK_SECRET: STRIPE_WEBHOOK,
    STRIPE_PRICE_PLUS: "price_plus",
    STRIPE_PRICE_PREMIUM: "price_premium",
    STRIPE_API_BASE: stub.url,
    PAYSTACK_SECRET_KEY: PAYSTACK_KEY,
    PAYSTACK_PLAN_PLUS: "PLN_plus_ngn",
    PAYSTACK_PLAN_PREMIUM: "PLN_premium_ngn",
    PAYSTACK_PLAN_PLUS_GHS: "PLN_plus_ghs",
    PAYSTACK_PLAN_PREMIUM_GHS: "PLN_premium_ghs",
    PAYSTACK_API_BASE: stub.url,
    WEB_ORIGIN: "https://dingba.test",
  };
}

const gateway = () => {
  const planner = new MockChatProvider();
  return { chat: new MockChatProvider(), planner, premiumChat: planner, stt: new MockSttProvider(), tts: new MockTtsProvider(), vision: new MockVisionProvider(), moderation: new RulesModerationProvider() };
};

describe("the pricing rules", () => {
  const prices: Price[] = [
    { provider: "stripe", plan: "plus", currency: "USD", amountMinor: 500 },
    { provider: "stripe", plan: "premium", currency: "USD", amountMinor: 1200 },
    { provider: "stripe", plan: "plus", currency: "GBP", amountMinor: 400 },
    { provider: "stripe", plan: "premium", currency: "GBP", amountMinor: 960 },
    { provider: "stripe", plan: "plus", currency: "NGN", amountMinor: 300000 },
    { provider: "stripe", plan: "premium", currency: "NGN", amountMinor: 900000 },
    { provider: "paystack", plan: "plus", currency: "NGN", amountMinor: 250000 },
    { provider: "paystack", plan: "premium", currency: "NGN", amountMinor: 750000 },
    { provider: "paystack", plan: "plus", currency: "GHS", amountMinor: 6000 },
  ];

  it("reads a device's time zone or language as a currency", () => {
    expect(suggestedCurrency({ timezone: "Africa/Lagos" })).toBe("NGN");
    expect(suggestedCurrency({ timezone: "Europe/London" })).toBe("GBP");
    expect(suggestedCurrency({ timezone: "Europe/Paris" })).toBe("EUR");
    expect(suggestedCurrency({ timezone: "America/New_York" })).toBe("USD");
    expect(suggestedCurrency({ timezone: "Asia/Kolkata" })).toBe("INR");
    expect(suggestedCurrency({ timezone: "Antarctica/Troll", language: "en-NG" })).toBe("NGN");
    expect(suggestedCurrency({ timezone: "Antarctica/Troll", language: "en" })).toBeNull();
  });

  it("offers a currency only when every plan has a price in it", () => {
    expect(currenciesOnOffer(prices)).toEqual(["USD", "GBP", "NGN"]);
  });

  it("takes the family's choice, then the device's suggestion, then dollars", () => {
    const onOffer = currenciesOnOffer(prices);
    expect(chooseCurrency({ chosen: "gbp", timezone: "Africa/Lagos", onOffer })).toBe("GBP");
    expect(chooseCurrency({ chosen: "GHS", timezone: "Africa/Lagos", onOffer })).toBe("NGN");
    expect(chooseCurrency({ timezone: "Europe/Paris", onOffer })).toBe("USD");
    expect(chooseCurrency({ timezone: "Europe/Paris", onOffer: ["NGN"] })).toBe("NGN");
    expect(chooseCurrency({ onOffer: [] })).toBeNull();
  });

  it("sends naira to Paystack and dollars to Stripe when both could take them", () => {
    expect(providerFor("NGN", prices)).toBe("paystack");
    expect(providerFor("USD", prices)).toBe("stripe");
    expect(providerFor("GBP", prices)).toBe("stripe");
    expect(providerFor("JPY", prices)).toBeNull();
    expect(quoteFor("NGN", prices)).toEqual({ provider: "paystack", plus: 250000, premium: 750000 });
    expect(quoteFor("GHS", prices)).toBeNull();
  });

  it("shows amounts in the currency's own units", () => {
    expect(toMajor(250000, "NGN")).toBe(2500);
    expect(toMajor(500, "USD")).toBe(5);
    expect(toMajor(700, "JPY")).toBe(700);
  });
});

describe("prices read from the processors", () => {
  let stub: Stub;
  beforeAll(async () => {
    stub = await standIn();
  });
  afterAll(() => stub.close());

  it("Stripe: one price per plan, every currency it carries, and a checkout that names the currency only when it must", async () => {
    const stripe = new StripeProvider({ secretKey: STRIPE_KEY, webhookSecret: STRIPE_WEBHOOK, pricePlus: "price_plus", pricePremium: "price_premium", apiBase: stub.url });
    const prices = await stripe.listPrices();
    expect(prices).toContainEqual({ plan: "plus", currency: "USD", amountMinor: 500 });
    expect(prices).toContainEqual({ plan: "premium", currency: "GBP", amountMinor: 960 });
    expect(prices.filter((p) => p.plan === "plus")).toHaveLength(3);
    expect(stub.calls.at(-1)?.url).toContain("expand[]=currency_options");

    await stripe.createCheckout({ email: "a@b.c", plan: "plus", currency: "USD", successUrl: "s", cancelUrl: "c" });
    expect(stub.calls.at(-1)?.body).not.toContain("currency=");
    await stripe.createCheckout({ email: "a@b.c", plan: "plus", currency: "GBP", successUrl: "s", cancelUrl: "c" });
    expect(stub.calls.at(-1)?.body).toContain("currency=gbp");
  });

  it("Paystack: each plan's amount and currency, and the plan code that matches the currency", async () => {
    const paystack = new PaystackProvider({
      secretKey: PAYSTACK_KEY,
      planCodePlus: "PLN_plus_ngn",
      planCodePremium: "PLN_premium_ngn",
      extraPlans: { GHS: { plus: "PLN_plus_ghs", premium: "PLN_premium_ghs" } },
      apiBase: stub.url,
    });
    const prices = await paystack.listPrices();
    expect(prices).toEqual([
      { plan: "plus", currency: "NGN", amountMinor: 250000 },
      { plan: "premium", currency: "NGN", amountMinor: 750000 },
      { plan: "plus", currency: "GHS", amountMinor: 6000 },
      { plan: "premium", currency: "GHS", amountMinor: 15000 },
    ]);
    await paystack.createCheckout({ email: "a@b.c", plan: "premium", currency: "GHS", successUrl: "s", cancelUrl: "c" });
    expect(stub.calls.at(-1)?.body).toContain("PLN_premium_ghs");
    await paystack.createCheckout({ email: "a@b.c", plan: "plus", currency: "NGN", successUrl: "s", cancelUrl: "c" });
    expect(stub.calls.at(-1)?.body).toContain("PLN_plus_ngn");
  });

  it("builds both processors from one environment, or only the one asked for", () => {
    expect(billingFromEnv(envFor(stub)).map((p) => p.name)).toEqual(["stripe", "paystack"]);
    expect(billingFromEnv(envFor(stub, "paystack")).map((p) => p.name)).toEqual(["paystack"]);
    expect(billingFromEnv({ BILLING_PROVIDER: "mock", MOCK_BILLING_SECRET: "x" }).map((p) => p.name)).toEqual(["mock"]);
    expect(billingFromEnv({})).toEqual([]);
    expect(() => billingFromEnv({ STRIPE_SECRET_KEY: "k" })).toThrow(/Stripe needs/);
  });
});

describe("two processors live at once", () => {
  let stub: Stub;
  let app: FastifyInstance;
  let store: MemoryStore;
  beforeAll(async () => {
    stub = await standIn();
    store = new MemoryStore();
    app = await buildApp({ gateway: gateway(), store, env: envFor(stub) });
  });
  afterAll(async () => {
    await app.close();
    await stub.close();
  });

  async function family(email: string) {
    const res = await app.inject({ method: "POST", url: "/auth/register", payload: { email, password: "hunter22222", displayName: "Parent" } });
    return { token: res.json().token as string, auth: { authorization: `Bearer ${res.json().token}` } };
  }
  const plan = async (token: string) => (await app.inject({ method: "GET", url: "/me/usage", headers: { authorization: `Bearer ${token}` } })).json().plan as string;

  it("says which processors and currencies are on offer", async () => {
    const res = await app.inject({ method: "GET", url: "/billing/status" });
    expect(res.json()).toMatchObject({ configured: true, providers: ["stripe", "paystack"], currencies: ["USD", "EUR", "GBP", "GHS", "NGN"] });
  });

  it("quotes a Lagos family in naira through Paystack, and a London family in pounds through Stripe", async () => {
    const lagos = (await app.inject({ method: "GET", url: "/billing/quote?tz=Africa/Lagos&lang=en-NG" })).json();
    expect(lagos).toMatchObject({ currency: "NGN", provider: "paystack", monthly: { plus: { amountMinor: 250000, amount: 2500 }, premium: { amount: 7500 } } });
    const london = (await app.inject({ method: "GET", url: "/billing/quote?tz=Europe/London&lang=en-GB" })).json();
    expect(london).toMatchObject({ currency: "GBP", provider: "stripe", monthly: { plus: { amount: 4 }, premium: { amount: 9.6 } } });
    const accra = (await app.inject({ method: "GET", url: "/billing/quote?tz=Africa/Accra" })).json();
    expect(accra).toMatchObject({ currency: "GHS", provider: "paystack", monthly: { plus: { amount: 60 } } });
    // A chosen currency beats the device's suggestion; an unknown place gets dollars.
    expect((await app.inject({ method: "GET", url: "/billing/quote?tz=Africa/Lagos&currency=eur" })).json()).toMatchObject({ currency: "EUR", provider: "stripe" });
    expect((await app.inject({ method: "GET", url: "/billing/quote?tz=Antarctica/Troll" })).json()).toMatchObject({ currency: "USD", provider: "stripe" });
  });

  it("sends the checkout to the processor that takes the chosen currency", async () => {
    const fam = await family("router@example.com");
    const naira = (await app.inject({ method: "POST", url: "/billing/checkout", headers: fam.auth, payload: { plan: "plus", currency: "NGN" } })).json();
    expect(naira).toMatchObject({ provider: "paystack", currency: "NGN" });
    expect(naira.url).toContain("checkout.paystack.test");
    expect(decodeURIComponent(naira.url)).toContain("PLN_plus_ngn");
    const pounds = (await app.inject({ method: "POST", url: "/billing/checkout", headers: fam.auth, payload: { plan: "premium", currency: "gbp" } })).json();
    expect(pounds).toMatchObject({ provider: "stripe", currency: "GBP" });
    expect(decodeURIComponent(pounds.url)).toContain("currency=gbp");
    // A currency nobody takes falls back to dollars rather than refusing a family.
    const yen = (await app.inject({ method: "POST", url: "/billing/checkout", headers: fam.auth, payload: { plan: "plus", currency: "JPY" } })).json();
    expect(yen).toMatchObject({ provider: "stripe", currency: "USD" });
  });

  it("tells the two processors' webhooks apart by their signature", async () => {
    const fam = await family("both@example.com");
    // Paystack, on the shared address.
    const pBody = JSON.stringify({ event: "charge.success", data: { customer: { email: "both@example.com", customer_code: "CUS_1" }, plan: { plan_code: "PLN_premium_ghs" }, subscription_code: "SUB_1" } });
    const p = await app.inject({
      method: "POST",
      url: "/billing/webhook",
      headers: { "content-type": "application/json", "x-paystack-signature": createHmac("sha512", PAYSTACK_KEY).update(pBody).digest("hex") },
      payload: pBody,
    });
    expect(p.json()).toMatchObject({ received: true, handled: true });
    expect(await plan(fam.token)).toBe("premium");

    // Stripe, on its named address: a cancellation by subscription ref.
    const sub = await store.getSubscription((await store.getAccountByEmail("both@example.com"))!.userId);
    expect(sub?.provider).toBe("paystack");
    const t = Math.floor(Date.now() / 1000);
    const sBody = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { customer: "cus_9", subscription: "sub_9", customer_details: { email: "both@example.com" }, metadata: { plan: "plus" } } } });
    const s = await app.inject({
      method: "POST",
      url: "/billing/webhook/stripe",
      headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${createHmac("sha256", STRIPE_WEBHOOK).update(`${t}.${sBody}`).digest("hex")}` },
      payload: sBody,
    });
    expect(s.json()).toMatchObject({ received: true, handled: true });
    expect(await plan(fam.token)).toBe("plus");

    // A Stripe signature on Paystack's named address is a bad signature, not a flip.
    const wrong = await app.inject({
      method: "POST",
      url: "/billing/webhook/paystack",
      headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=deadbeef` },
      payload: sBody,
    });
    expect(wrong.statusCode).toBe(400);
    // And nothing signed at all is turned away.
    const none = await app.inject({ method: "POST", url: "/billing/webhook", headers: { "content-type": "application/json" }, payload: sBody });
    expect(none.statusCode).toBe(400);
  });

  it("keeps offering the other processor's currencies when one cannot be reached", async () => {
    const fresh = new MemoryStore();
    stub.stripeDown = true;
    const alone = await buildApp({ gateway: gateway(), store: fresh, env: envFor(stub) });
    try {
      const status = (await alone.inject({ method: "GET", url: "/billing/status" })).json();
      expect(status.currencies).toEqual(["GHS", "NGN"]);
      const london = (await alone.inject({ method: "GET", url: "/billing/quote?tz=Europe/London" })).json();
      expect(london).toMatchObject({ currency: "GHS", provider: "paystack" });
    } finally {
      stub.stripeDown = false;
      await alone.close();
    }
  });
});
