import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Store } from "./store/types.js";
import { chooseCurrency, currenciesOnOffer, quoteFor, toMajor, type Price } from "./pricing.js";

/**
 * Billing (Sprint 6b). Same philosophy as the AI gateway: the app talks to a
 * provider interface; which processor runs is a `.env` decision. Plain fetch
 * against the providers' REST APIs — no SDK dependency, fully mockable, and
 * zero network calls unless a provider is actually configured.
 *
 * The flow both providers share:
 *   1. POST /billing/checkout {plan, currency} → hosted payment page URL.
 *   2. Provider webhook → verify signature → normalized BillingEvent.
 *   3. Event flips users.plan (the entitlements engine does the rest) and
 *      upserts billing_subscriptions so cancellations can find the user.
 *
 * Both processors can be live at once. Each one says which currencies it
 * has prices for (read from the processor, never typed here: see
 * pricing.ts), a family pays in the currency they see, and the processor
 * that serves that currency takes the payment. Webhooks are told apart by
 * the signature header each processor sends.
 */

export type PaidPlan = "plus" | "premium";

export type BillingEvent =
  | {
      type: "activated";
      email: string;
      plan: PaidPlan;
      customerRef: string;
      subscriptionRef: string;
      /** The processor's own id for the event, for exact-once recording. */
      eventRef?: string;
    }
  | {
      type: "canceled";
      /** Cancellation payloads may carry refs only — email resolved via store. */
      email?: string;
      customerRef?: string;
      subscriptionRef?: string;
      eventRef?: string;
    }
  /**
   * A renewal that did not go through. The processor retries on its own and
   * sends a cancellation if it finally gives up, so this is recorded and
   * surfaced to finance rather than downgrading anyone mid-retry.
   */
  | {
      type: "payment_failed";
      email?: string;
      customerRef?: string;
      subscriptionRef?: string;
      amountMinor?: number;
      currency?: string;
      eventRef?: string;
    }
  /** Money went back. Recorded for finance; entitlements follow cancellation. */
  | {
      type: "refunded";
      email?: string;
      customerRef?: string;
      subscriptionRef?: string;
      amountMinor?: number;
      currency?: string;
      eventRef?: string;
    };

export interface BillingProvider {
  readonly name: string;
  /** The prices this processor is configured with, as it reports them. */
  listPrices(): Promise<Array<{ plan: PaidPlan; currency: string; amountMinor: number }>>;
  createCheckout(opts: {
    email: string;
    plan: PaidPlan;
    /** Upper-case ISO code; one of this processor's listed currencies. */
    currency: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }>;
  /** Whether a webhook's headers are this processor's. */
  ownsWebhook(headers: Record<string, string | undefined>): boolean;
  /**
   * Verify the webhook signature and normalize the event.
   * Returns null for irrelevant-but-authentic events; THROWS on bad signature.
   */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): Promise<BillingEvent | null>;
}

export class WebhookSignatureError extends Error {}

/**
 * Paystack (and the mock) send no event id, so the body's hash stands in.
 * A retried webhook resends identical bytes, so the ref stays stable.
 */
function bodyRef(rawBody: Buffer): string {
  return createHash("sha256").update(rawBody).digest("hex").slice(0, 32);
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// ---------------------------------------------------------------- Stripe ----

export class StripeProvider implements BillingProvider {
  readonly name = "stripe";
  constructor(
    private cfg: {
      secretKey: string;
      webhookSecret: string;
      pricePlus: string;
      pricePremium: string;
      /** Overridable for tests; never called unless checkout is used. */
      apiBase?: string;
    },
  ) {}

  /** Each price's own currency; a price may carry more in currency_options. */
  private defaults = new Map<string, string>();

  /**
   * One Stripe price per plan, with as many currencies as the dashboard
   * gave it (currency_options). The number a parent sees is this number.
   */
  async listPrices() {
    const out: Array<{ plan: PaidPlan; currency: string; amountMinor: number }> = [];
    for (const [plan, id] of [["plus", this.cfg.pricePlus], ["premium", this.cfg.pricePremium]] as Array<[PaidPlan, string]>) {
      const res = await fetch(`${this.cfg.apiBase ?? "https://api.stripe.com"}/v1/prices/${id}?expand[]=currency_options`, {
        headers: { authorization: `Bearer ${this.cfg.secretKey}` },
      });
      if (!res.ok) throw new Error(`stripe price ${id} unreadable: ${res.status} ${await res.text()}`);
      const p = (await res.json()) as {
        currency: string;
        unit_amount: number | null;
        currency_options?: Record<string, { unit_amount: number | null }>;
      };
      this.defaults.set(plan, p.currency.toUpperCase());
      if (typeof p.unit_amount === "number") out.push({ plan, currency: p.currency.toUpperCase(), amountMinor: p.unit_amount });
      for (const [cur, opt] of Object.entries(p.currency_options ?? {})) {
        if (typeof opt.unit_amount === "number" && cur.toUpperCase() !== p.currency.toUpperCase()) {
          out.push({ plan, currency: cur.toUpperCase(), amountMinor: opt.unit_amount });
        }
      }
    }
    return out;
  }

  ownsWebhook(headers: Record<string, string | undefined>) {
    return typeof headers["stripe-signature"] === "string";
  }

  async createCheckout(opts: { email: string; plan: PaidPlan; currency: string; successUrl: string; cancelUrl: string }) {
    const price = opts.plan === "plus" ? this.cfg.pricePlus : this.cfg.pricePremium;
    const body = new URLSearchParams({
      mode: "subscription",
      customer_email: opts.email,
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      "metadata[plan]": opts.plan,
      "subscription_data[metadata][plan]": opts.plan,
    });
    // A price's own currency needs no hint; another of its currencies does.
    if (this.defaults.get(opts.plan) !== opts.currency.toUpperCase()) body.set("currency", opts.currency.toLowerCase());
    const res = await fetch(`${this.cfg.apiBase ?? "https://api.stripe.com"}/v1/checkout/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.cfg.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) throw new Error(`stripe checkout failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { url: string };
    return { url: json.url };
  }

  /** Stripe-Signature: t=<ts>,v1=hmacSha256(`${ts}.${rawBody}`, webhookSecret) */
  async parseWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): Promise<BillingEvent | null> {
    const header = headers["stripe-signature"] ?? "";
    const parts = Object.fromEntries(
      header.split(",").map((kv) => kv.split("=", 2) as [string, string]),
    ) as { t?: string; v1?: string };
    if (!parts.t || !parts.v1) throw new WebhookSignatureError("missing stripe signature");
    const expected = createHmac("sha256", this.cfg.webhookSecret)
      .update(`${parts.t}.${rawBody.toString("utf8")}`)
      .digest("hex");
    if (!safeEqual(expected, parts.v1)) throw new WebhookSignatureError("bad stripe signature");
    const age = Math.abs(Date.now() / 1000 - Number(parts.t));
    if (!Number.isFinite(age) || age > 5 * 60) throw new WebhookSignatureError("stale stripe signature");

    const event = JSON.parse(rawBody.toString("utf8")) as {
      id?: string;
      type: string;
      data: { object: Record<string, unknown> };
    };
    if (event.type === "checkout.session.completed") {
      const o = event.data.object as {
        customer?: string;
        subscription?: string;
        customer_email?: string;
        customer_details?: { email?: string };
        metadata?: { plan?: string };
      };
      const email = o.customer_details?.email ?? o.customer_email;
      const plan = o.metadata?.plan;
      if (!email || (plan !== "plus" && plan !== "premium")) return null;
      return {
        type: "activated",
        email,
        plan,
        customerRef: o.customer ?? "",
        subscriptionRef: o.subscription ?? "",
        eventRef: event.id,
      };
    }
    if (event.type === "customer.subscription.deleted") {
      const o = event.data.object as { id?: string; customer?: string };
      return { type: "canceled", customerRef: o.customer, subscriptionRef: o.id, eventRef: event.id };
    }
    if (event.type === "invoice.payment_failed") {
      const o = event.data.object as {
        customer?: string;
        subscription?: string;
        customer_email?: string;
        amount_due?: number;
        currency?: string;
      };
      return {
        type: "payment_failed",
        email: o.customer_email ?? undefined,
        customerRef: o.customer,
        subscriptionRef: o.subscription,
        amountMinor: typeof o.amount_due === "number" ? o.amount_due : undefined,
        currency: o.currency?.toUpperCase(),
        eventRef: event.id,
      };
    }
    if (event.type === "charge.refunded") {
      const o = event.data.object as {
        customer?: string;
        amount_refunded?: number;
        currency?: string;
        receipt_email?: string;
        billing_details?: { email?: string };
      };
      return {
        type: "refunded",
        email: o.receipt_email ?? o.billing_details?.email ?? undefined,
        customerRef: o.customer,
        amountMinor: typeof o.amount_refunded === "number" ? o.amount_refunded : undefined,
        currency: o.currency?.toUpperCase(),
        eventRef: event.id,
      };
    }
    return null;
  }
}

// -------------------------------------------------------------- Paystack ----

export class PaystackProvider implements BillingProvider {
  readonly name = "paystack";
  constructor(
    private cfg: {
      secretKey: string;
      planCodePlus: string;
      planCodePremium: string;
      /** Extra plans, one per currency beyond the main pair: { GHS: { plus, premium } }. */
      extraPlans?: Record<string, { plus: string; premium: string }>;
      apiBase?: string;
    },
  ) {}

  /** Plan code → the currency and amount the processor holds for it, once listed. */
  private currencyOf = new Map<string, string>();
  private amountOf = new Map<string, number>();

  private allCodes(): Array<{ plan: PaidPlan; code: string }> {
    const out: Array<{ plan: PaidPlan; code: string }> = [
      { plan: "plus", code: this.cfg.planCodePlus },
      { plan: "premium", code: this.cfg.planCodePremium },
    ];
    for (const pair of Object.values(this.cfg.extraPlans ?? {})) out.push({ plan: "plus", code: pair.plus }, { plan: "premium", code: pair.premium });
    return out;
  }

  /** Every configured plan, with the amount and currency Paystack holds for it. */
  async listPrices() {
    const out: Array<{ plan: PaidPlan; currency: string; amountMinor: number }> = [];
    for (const { plan, code } of this.allCodes()) {
      const res = await fetch(`${this.cfg.apiBase ?? "https://api.paystack.co"}/plan/${encodeURIComponent(code)}`, {
        headers: { authorization: `Bearer ${this.cfg.secretKey}` },
      });
      if (!res.ok) throw new Error(`paystack plan ${code} unreadable: ${res.status} ${await res.text()}`);
      const json = (await res.json()) as { data: { amount: number; currency: string } };
      const currency = (json.data.currency ?? "NGN").toUpperCase();
      this.currencyOf.set(code, currency);
      this.amountOf.set(code, json.data.amount);
      out.push({ plan, currency, amountMinor: json.data.amount });
    }
    return out;
  }

  ownsWebhook(headers: Record<string, string | undefined>) {
    return typeof headers["x-paystack-signature"] === "string";
  }

  private codeFor(plan: PaidPlan, currency: string): string {
    const want = currency.toUpperCase();
    for (const { plan: p, code } of this.allCodes()) if (p === plan && this.currencyOf.get(code) === want) return code;
    // Not listed yet (first call before prices were read): the main pair.
    return plan === "plus" ? this.cfg.planCodePlus : this.cfg.planCodePremium;
  }

  async createCheckout(opts: { email: string; plan: PaidPlan; currency: string; successUrl: string; cancelUrl: string }) {
    const planCode = this.codeFor(opts.plan, opts.currency);
    // Paystack wants an amount on every initialize call even when a plan
    // sets the real one, and the plan's own currency alongside it, so the
    // dollar plan is charged in dollars. Both come from the plan as listed.
    const amount = this.amountOf.get(planCode);
    const currency = this.currencyOf.get(planCode);
    const res = await fetch(`${this.cfg.apiBase ?? "https://api.paystack.co"}/transaction/initialize`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.cfg.secretKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: opts.email,
        plan: planCode,
        callback_url: opts.successUrl,
        ...(amount !== undefined ? { amount } : {}),
        ...(currency ? { currency } : {}),
        metadata: { plan: opts.plan, cancel_action: opts.cancelUrl },
      }),
    });
    if (!res.ok) throw new Error(`paystack initialize failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { data: { authorization_url: string } };
    return { url: json.data.authorization_url };
  }

  /** x-paystack-signature: hmacSha512(rawBody, secretKey) */
  async parseWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): Promise<BillingEvent | null> {
    const sig = headers["x-paystack-signature"] ?? "";
    const expected = createHmac("sha512", this.cfg.secretKey).update(rawBody).digest("hex");
    if (!sig || !safeEqual(expected, sig)) throw new WebhookSignatureError("bad paystack signature");

    const event = JSON.parse(rawBody.toString("utf8")) as {
      event: string;
      data: Record<string, unknown>;
    };
    const planOf = (code: string | undefined): PaidPlan | null => this.allCodes().find((c) => c.code === code)?.plan ?? null;

    if (event.event === "charge.success" || event.event === "subscription.create") {
      const d = event.data as {
        customer?: { email?: string; customer_code?: string };
        plan?: { plan_code?: string };
        subscription_code?: string;
        reference?: string;
      };
      const plan = planOf(d.plan?.plan_code);
      const email = d.customer?.email;
      if (!plan || !email) return null;
      return {
        type: "activated",
        email,
        plan,
        customerRef: d.customer?.customer_code ?? "",
        subscriptionRef: d.subscription_code ?? d.reference ?? "",
      };
    }
    if (event.event === "subscription.disable" || event.event === "subscription.not_renew") {
      const d = event.data as { customer?: { email?: string; customer_code?: string }; subscription_code?: string };
      return {
        type: "canceled",
        email: d.customer?.email,
        customerRef: d.customer?.customer_code,
        subscriptionRef: d.subscription_code,
        eventRef: bodyRef(rawBody),
      };
    }
    if (event.event === "invoice.payment_failed") {
      const d = event.data as {
        customer?: { email?: string; customer_code?: string };
        subscription?: { subscription_code?: string };
        amount?: number;
        currency?: string;
      };
      return {
        type: "payment_failed",
        email: d.customer?.email,
        customerRef: d.customer?.customer_code,
        subscriptionRef: d.subscription?.subscription_code,
        amountMinor: typeof d.amount === "number" ? d.amount : undefined,
        currency: d.currency ?? "NGN",
        eventRef: bodyRef(rawBody),
      };
    }
    if (event.event === "refund.processed") {
      const d = event.data as {
        customer?: { email?: string; customer_code?: string };
        amount?: number;
        currency?: string;
        transaction_reference?: string;
      };
      return {
        type: "refunded",
        email: d.customer?.email,
        customerRef: d.customer?.customer_code,
        subscriptionRef: d.transaction_reference,
        amountMinor: typeof d.amount === "number" ? d.amount : undefined,
        currency: d.currency ?? "NGN",
        eventRef: bodyRef(rawBody),
      };
    }
    return null;
  }
}

// ------------------------------------------------------------------ Mock ----

/**
 * Test/dev provider: checkout returns a fake URL; webhooks are plain JSON
 * BillingEvents signed with hmacSha256(rawBody, MOCK_BILLING_SECRET).
 * Only active when BILLING_PROVIDER is unset/mock — configuring a real
 * provider switches this off entirely.
 */
export class MockBillingProvider implements BillingProvider {
  readonly name = "mock";
  constructor(
    private secret: string,
    /** Prices to pretend to have; default a single pair in US dollars. */
    private prices: Array<{ plan: PaidPlan; currency: string; amountMinor: number }> = [
      { plan: "plus", currency: "USD", amountMinor: 500 },
      { plan: "premium", currency: "USD", amountMinor: 1200 },
    ],
  ) {}

  async listPrices() {
    return this.prices;
  }

  ownsWebhook(headers: Record<string, string | undefined>) {
    return typeof headers["x-mock-signature"] === "string";
  }

  async createCheckout(opts: { email: string; plan: PaidPlan; currency: string; successUrl: string }) {
    return { url: `${opts.successUrl}#mock-checkout-${opts.plan}-${opts.currency.toLowerCase()}` };
  }

  async parseWebhook(rawBody: Buffer, headers: Record<string, string | undefined>) {
    const sig = headers["x-mock-signature"] ?? "";
    const expected = createHmac("sha256", this.secret).update(rawBody).digest("hex");
    if (!sig || !safeEqual(expected, sig)) throw new WebhookSignatureError("bad mock signature");
    const event = JSON.parse(rawBody.toString("utf8")) as BillingEvent;
    return { ...event, eventRef: event.eventRef ?? bodyRef(rawBody) };
  }
}

// ----------------------------------------------------------------- Wiring ----

/**
 * Every processor the environment configures. Set STRIPE_* and PAYSTACK_*
 * together and both are live; BILLING_PROVIDER, if set, keeps only that
 * one (the old single-processor behaviour). Paystack's main pair of plans
 * is PAYSTACK_PLAN_PLUS / PAYSTACK_PLAN_PREMIUM; more currencies come as
 * PAYSTACK_PLAN_PLUS_GHS / PAYSTACK_PLAN_PREMIUM_GHS and so on, and the
 * currency of each is read from Paystack, never assumed.
 */
export function billingFromEnv(env: Record<string, string | undefined>): BillingProvider[] {
  const only = env.BILLING_PROVIDER;
  const out: BillingProvider[] = [];
  if ((!only || only === "stripe") && (env.STRIPE_SECRET_KEY || only === "stripe")) {
    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_PRICE_PLUS || !env.STRIPE_PRICE_PREMIUM) {
      throw new Error("Stripe needs STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PLUS, STRIPE_PRICE_PREMIUM");
    }
    out.push(
      new StripeProvider({
        secretKey: env.STRIPE_SECRET_KEY,
        webhookSecret: env.STRIPE_WEBHOOK_SECRET,
        pricePlus: env.STRIPE_PRICE_PLUS,
        pricePremium: env.STRIPE_PRICE_PREMIUM,
        apiBase: env.STRIPE_API_BASE,
      }),
    );
  }
  if ((!only || only === "paystack") && (env.PAYSTACK_SECRET_KEY || only === "paystack")) {
    if (!env.PAYSTACK_SECRET_KEY || !env.PAYSTACK_PLAN_PLUS || !env.PAYSTACK_PLAN_PREMIUM) {
      throw new Error("Paystack needs PAYSTACK_SECRET_KEY, PAYSTACK_PLAN_PLUS, PAYSTACK_PLAN_PREMIUM");
    }
    const extraPlans: Record<string, { plus: string; premium: string }> = {};
    for (const [k, v] of Object.entries(env)) {
      const m = /^PAYSTACK_PLAN_PLUS_([A-Z]{3})$/.exec(k);
      if (m && v && env[`PAYSTACK_PLAN_PREMIUM_${m[1]}`]) extraPlans[m[1]] = { plus: v, premium: env[`PAYSTACK_PLAN_PREMIUM_${m[1]}`]! };
    }
    out.push(
      new PaystackProvider({
        secretKey: env.PAYSTACK_SECRET_KEY,
        planCodePlus: env.PAYSTACK_PLAN_PLUS,
        planCodePremium: env.PAYSTACK_PLAN_PREMIUM,
        extraPlans,
        apiBase: env.PAYSTACK_API_BASE,
      }),
    );
  }
  if (only === "mock" && env.MOCK_BILLING_SECRET) {
    let prices: Array<{ plan: PaidPlan; currency: string; amountMinor: number }> | undefined;
    if (env.MOCK_BILLING_PRICES) prices = JSON.parse(env.MOCK_BILLING_PRICES);
    out.push(new MockBillingProvider(env.MOCK_BILLING_SECRET, prices));
  }
  return out;
}

/** Finds the account behind an event's email or processor refs. */
async function accountBehind(
  store: Store,
  provider: string,
  event: { email?: string; customerRef?: string; subscriptionRef?: string },
): Promise<{ userId: string; email: string } | null> {
  if (event.email) {
    const a = await store.getAccountByEmail(event.email);
    return a ? { userId: a.userId, email: event.email } : null;
  }
  if (event.customerRef || event.subscriptionRef) {
    return store.findSubscriptionByRef(provider, {
      customerRef: event.customerRef,
      subscriptionRef: event.subscriptionRef,
    });
  }
  return null;
}

/** Apply a verified event to the store. Exported for direct testing. */
export async function applyBillingEvent(store: Store, provider: string, event: BillingEvent): Promise<boolean> {
  if (event.type === "payment_failed" || event.type === "refunded") {
    // Recorded, never acted on: the processor retries a failed renewal on its
    // own and sends a cancellation if it gives up, and a refund's entitlement
    // change arrives the same way. Downgrading here would race both.
    return (await accountBehind(store, provider, event)) !== null;
  }
  if (event.type === "activated") {
    const flipped = await store.setUserPlan(event.email, event.plan);
    if (!flipped) return false; // paid with an email we don't know — surfaced by the route
    const account = await store.getAccountByEmail(event.email);
    if (account) {
      await store.recordSubscription({
        userId: account.userId,
        provider,
        customerRef: event.customerRef,
        subscriptionRef: event.subscriptionRef,
        plan: event.plan,
        status: "active",
      });
    }
    return true;
  }
  // Cancellation: prefer the email if the payload had one, else map refs back.
  const found = await accountBehind(store, provider, event);
  if (!found) return false;
  await store.setUserPlan(found.email, "free");
  if (event.subscriptionRef || event.customerRef) {
    await store.recordSubscription({
      userId: found.userId,
      provider,
      customerRef: event.customerRef ?? "",
      subscriptionRef: event.subscriptionRef ?? event.customerRef ?? "",
      plan: "free",
      status: "canceled",
    });
  }
  return true;
}

/**
 * Routes. Registered in an encapsulated scope so the webhook can read the RAW
 * request body (signatures are computed over bytes, not parsed JSON).
 */
export async function registerBilling(
  app: FastifyInstance,
  store: Store,
  env: Record<string, string | undefined>,
  userFromRequest: (req: { headers: Record<string, unknown> }) => Promise<{ userId: string; email: string } | null>,
) {
  const providers = billingFromEnv(env);
  const webOrigin = env.WEB_ORIGIN ?? "http://localhost:3000";
  const PRICE_TTL_MS = 60 * 60 * 1000;
  const RETRY_MS = 5 * 60 * 1000;

  // The prices, as each processor reports them, read once an hour. A
  // processor that cannot be reached is simply not on offer until it can be,
  // and is asked again a few minutes later; the others carry on.
  const cache = new Map<string, { prices: Price[]; at: number; ok: boolean }>();
  async function prices(): Promise<Price[]> {
    const now = Date.now();
    const all: Price[] = [];
    for (const p of providers) {
      const c = cache.get(p.name);
      const fresh = c && now - c.at < (c.ok ? PRICE_TTL_MS : RETRY_MS);
      if (!fresh) {
        try {
          const listed = await p.listPrices();
          cache.set(p.name, { prices: listed.map((x) => ({ ...x, provider: p.name, currency: x.currency.toUpperCase() })), at: now, ok: true });
        } catch (err) {
          app.log.error({ err, provider: p.name }, "billing: prices unreadable; this processor is not on offer until they are");
          cache.set(p.name, { prices: c?.prices ?? [], at: now, ok: false });
        }
      }
      all.push(...(cache.get(p.name)?.prices ?? []));
    }
    return all;
  }

  app.get("/billing/status", async () => {
    const known = providers.length ? await prices() : [];
    return {
      configured: providers.length > 0,
      providers: providers.map((p) => p.name),
      /** Kept for older clients: the first processor's name. */
      provider: providers[0]?.name ?? null,
      plans: ["plus", "premium"],
      currencies: currenciesOnOffer(known),
    };
  });

  /**
   * What this family would pay, in the currency their device suggests or
   * the one they chose. Amounts are what the processor will charge.
   */
  app.get<{ Querystring: { tz?: string; lang?: string; currency?: string } }>("/billing/quote", async (req, reply) => {
    if (!providers.length) return reply.code(501).send({ error: "billing is not configured yet" });
    const known = await prices();
    const onOffer = currenciesOnOffer(known);
    const currency = chooseCurrency({ chosen: req.query.currency, timezone: req.query.tz, language: req.query.lang, onOffer });
    if (!currency) return reply.code(503).send({ error: "prices are not available right now", currencies: [] });
    const q = quoteFor(currency, known);
    if (!q) return reply.code(503).send({ error: "prices are not available right now", currencies: onOffer });
    return {
      currency,
      provider: q.provider,
      currencies: onOffer,
      monthly: {
        plus: { amountMinor: q.plus, amount: toMajor(q.plus, currency) },
        premium: { amountMinor: q.premium, amount: toMajor(q.premium, currency) },
      },
    };
  });

  app.post<{ Body: { plan: PaidPlan; currency?: string } }>(
    "/billing/checkout",
    {
      schema: {
        body: {
          type: "object",
          required: ["plan"],
          additionalProperties: false,
          properties: {
            plan: { type: "string", enum: ["plus", "premium"] },
            currency: { type: "string", pattern: "^[A-Za-z]{3}$" },
          },
        },
      },
    },
    async (req, reply) => {
      if (!providers.length) return reply.code(501).send({ error: "billing is not configured yet" });
      const user = await userFromRequest(req);
      if (!user) return reply.code(401).send({ error: "sign in required" });
      const known = await prices();
      const onOffer = currenciesOnOffer(known);
      const currency = chooseCurrency({ chosen: req.body.currency, onOffer });
      const q = currency ? quoteFor(currency, known) : null;
      // Prices unreadable everywhere: the first processor still takes the
      // payment in its own currency rather than turning a family away.
      const provider = q ? providers.find((p) => p.name === q.provider)! : providers[0];
      const { url } = await provider.createCheckout({
        email: user.email,
        plan: req.body.plan,
        currency: currency ?? req.body.currency?.toUpperCase() ?? "USD",
        successUrl: `${webOrigin}/account?upgraded=1`,
        cancelUrl: `${webOrigin}/account?canceled=1`,
      });
      return { url, provider: provider.name, currency: currency ?? null };
    },
  );

  app.get("/me/billing", async (req, reply) => {
    const user = await userFromRequest(req);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    return { subscription: await store.getSubscription(user.userId) };
  });

  // Webhooks live in a child scope with a raw-body parser: signature schemes
  // (Stripe HMAC over `${t}.${body}`, Paystack HMAC over body) need exact bytes.
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

    const handle = async (
      provider: BillingProvider | undefined,
      req: { body: unknown; headers: Record<string, unknown>; log: FastifyInstance["log"] },
      reply: { code: (n: number) => { send: (b: unknown) => unknown } },
    ) => {
      if (!provider) return reply.code(501).send({ error: "billing is not configured" });
      let event: BillingEvent | null;
      try {
        event = await provider.parseWebhook(req.body as Buffer, req.headers as Record<string, string | undefined>);
      } catch (err) {
        if (err instanceof WebhookSignatureError) {
          req.log.warn({ err }, "billing webhook rejected");
          return reply.code(400).send({ error: "bad signature" });
        }
        req.log.error({ err }, "billing webhook unparseable");
        return reply.code(400).send({ error: "bad payload" });
      }
      if (!event) return { received: true, handled: false };
      // Apply first (plan flips are idempotent), then record. A replayed
      // event re-applies harmlessly and the ledger's unique ref keeps the
      // record itself exactly-once.
      const applied = await applyBillingEvent(store, provider.name, event);
      const fresh = await store.recordBillingEvent({
        provider: provider.name,
        eventRef: event.eventRef ?? bodyRef(req.body as Buffer),
        type: event.type,
        email: event.email,
        customerRef: event.customerRef,
        subscriptionRef: event.subscriptionRef,
        plan: "plan" in event ? event.plan : undefined,
        amountMinor: "amountMinor" in event ? event.amountMinor : undefined,
        currency: "currency" in event ? event.currency : undefined,
        matched: applied,
      });
      if (!applied) {
        // Authentic payment for an unknown account: log loudly, still 200 so
        // the provider stops retrying; the money trail lives in their dashboard.
        req.log.error({ event }, "billing event did not match any account");
      }
      return { received: true, handled: applied, recorded: fresh };
    };

    // One address for all processors, told apart by the header each signs
    // with; and one address per processor for dashboards that want a name.
    scope.post("/billing/webhook", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
      const headers = req.headers as Record<string, string | undefined>;
      const provider = providers.find((p) => p.ownsWebhook(headers)) ?? (providers.length === 1 ? providers[0] : undefined);
      if (!provider && providers.length) return reply.code(400).send({ error: "no known processor signature on this webhook" });
      return handle(provider, req, reply);
    });
    scope.post<{ Params: { provider: string } }>(
      "/billing/webhook/:provider",
      { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
      async (req, reply) => handle(providers.find((p) => p.name === req.params.provider), req, reply),
    );
  });
}
