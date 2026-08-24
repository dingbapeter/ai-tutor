import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Store } from "./store/types.js";

/**
 * Billing (Sprint 6b). Same philosophy as the AI gateway: the app talks to a
 * provider interface; which processor runs is a `.env` decision. Plain fetch
 * against the providers' REST APIs — no SDK dependency, fully mockable, and
 * zero network calls unless a provider is actually configured.
 *
 * The flow both providers share:
 *   1. POST /billing/checkout {plan} → hosted payment page URL.
 *   2. Provider webhook → verify signature → normalized BillingEvent.
 *   3. Event flips users.plan (the entitlements engine does the rest) and
 *      upserts billing_subscriptions so cancellations can find the user.
 */

export type PaidPlan = "plus" | "premium";

export type BillingEvent =
  | {
      type: "activated";
      email: string;
      plan: PaidPlan;
      customerRef: string;
      subscriptionRef: string;
    }
  | {
      type: "canceled";
      /** Cancellation payloads may carry refs only — email resolved via store. */
      email?: string;
      customerRef?: string;
      subscriptionRef?: string;
    };

export interface BillingProvider {
  readonly name: string;
  createCheckout(opts: {
    email: string;
    plan: PaidPlan;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }>;
  /**
   * Verify the webhook signature and normalize the event.
   * Returns null for irrelevant-but-authentic events; THROWS on bad signature.
   */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): Promise<BillingEvent | null>;
}

export class WebhookSignatureError extends Error {}

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

  async createCheckout(opts: { email: string; plan: PaidPlan; successUrl: string; cancelUrl: string }) {
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
      };
    }
    if (event.type === "customer.subscription.deleted") {
      const o = event.data.object as { id?: string; customer?: string };
      return { type: "canceled", customerRef: o.customer, subscriptionRef: o.id };
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
      apiBase?: string;
    },
  ) {}

  async createCheckout(opts: { email: string; plan: PaidPlan; successUrl: string; cancelUrl: string }) {
    const planCode = opts.plan === "plus" ? this.cfg.planCodePlus : this.cfg.planCodePremium;
    const res = await fetch(`${this.cfg.apiBase ?? "https://api.paystack.co"}/transaction/initialize`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.cfg.secretKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: opts.email, plan: planCode, callback_url: opts.successUrl }),
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
    const planOf = (code: string | undefined): PaidPlan | null =>
      code === this.cfg.planCodePlus ? "plus" : code === this.cfg.planCodePremium ? "premium" : null;

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
  constructor(private secret: string) {}

  async createCheckout(opts: { email: string; plan: PaidPlan; successUrl: string }) {
    return { url: `${opts.successUrl}#mock-checkout-${opts.plan}` };
  }

  async parseWebhook(rawBody: Buffer, headers: Record<string, string | undefined>) {
    const sig = headers["x-mock-signature"] ?? "";
    const expected = createHmac("sha256", this.secret).update(rawBody).digest("hex");
    if (!sig || !safeEqual(expected, sig)) throw new WebhookSignatureError("bad mock signature");
    return JSON.parse(rawBody.toString("utf8")) as BillingEvent;
  }
}

// ----------------------------------------------------------------- Wiring ----

export function billingFromEnv(env: Record<string, string | undefined>): BillingProvider | null {
  const which = env.BILLING_PROVIDER ?? (env.STRIPE_SECRET_KEY ? "stripe" : env.PAYSTACK_SECRET_KEY ? "paystack" : null);
  if (which === "stripe") {
    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_PRICE_PLUS || !env.STRIPE_PRICE_PREMIUM) {
      throw new Error(
        "BILLING_PROVIDER=stripe needs STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PLUS, STRIPE_PRICE_PREMIUM",
      );
    }
    return new StripeProvider({
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      pricePlus: env.STRIPE_PRICE_PLUS,
      pricePremium: env.STRIPE_PRICE_PREMIUM,
      apiBase: env.STRIPE_API_BASE,
    });
  }
  if (which === "paystack") {
    if (!env.PAYSTACK_SECRET_KEY || !env.PAYSTACK_PLAN_PLUS || !env.PAYSTACK_PLAN_PREMIUM) {
      throw new Error("BILLING_PROVIDER=paystack needs PAYSTACK_SECRET_KEY, PAYSTACK_PLAN_PLUS, PAYSTACK_PLAN_PREMIUM");
    }
    return new PaystackProvider({
      secretKey: env.PAYSTACK_SECRET_KEY,
      planCodePlus: env.PAYSTACK_PLAN_PLUS,
      planCodePremium: env.PAYSTACK_PLAN_PREMIUM,
      apiBase: env.PAYSTACK_API_BASE,
    });
  }
  if (which === "mock" && env.MOCK_BILLING_SECRET) return new MockBillingProvider(env.MOCK_BILLING_SECRET);
  return null;
}

/** Apply a verified event to the store. Exported for direct testing. */
export async function applyBillingEvent(store: Store, provider: string, event: BillingEvent): Promise<boolean> {
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
  const found = event.email
    ? await store.getAccountByEmail(event.email).then((a) => (a ? { userId: a.userId, email: event.email! } : null))
    : await store.findSubscriptionByRef(provider, {
        customerRef: event.customerRef,
        subscriptionRef: event.subscriptionRef,
      });
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
  const provider = billingFromEnv(env);
  const webOrigin = env.WEB_ORIGIN ?? "http://localhost:3000";

  app.get("/billing/status", async () => ({
    configured: provider !== null,
    provider: provider?.name ?? null,
    plans: ["plus", "premium"],
  }));

  app.post<{ Body: { plan: PaidPlan } }>(
    "/billing/checkout",
    {
      schema: {
        body: {
          type: "object",
          required: ["plan"],
          additionalProperties: false,
          properties: { plan: { type: "string", enum: ["plus", "premium"] } },
        },
      },
    },
    async (req, reply) => {
      if (!provider) return reply.code(501).send({ error: "billing is not configured yet" });
      const user = await userFromRequest(req);
      if (!user) return reply.code(401).send({ error: "sign in required" });
      const { url } = await provider.createCheckout({
        email: user.email,
        plan: req.body.plan,
        successUrl: `${webOrigin}/account?upgraded=1`,
        cancelUrl: `${webOrigin}/account?canceled=1`,
      });
      return { url };
    },
  );

  app.get("/me/billing", async (req, reply) => {
    const user = await userFromRequest(req);
    if (!user) return reply.code(401).send({ error: "sign in required" });
    return { subscription: await store.getSubscription(user.userId) };
  });

  // Webhook lives in a child scope with a raw-body parser: signature schemes
  // (Stripe HMAC over `${t}.${body}`, Paystack HMAC over body) need exact bytes.
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

    scope.post("/billing/webhook", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
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
      const applied = await applyBillingEvent(store, provider.name, event);
      if (!applied) {
        // Authentic payment for an unknown account: log loudly, still 200 so
        // the provider stops retrying — the money trail lives in their dashboard.
        req.log.error({ event }, "billing event did not match any account");
      }
      return { received: true, handled: applied };
    });
  });
}
