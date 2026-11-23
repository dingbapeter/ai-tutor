/**
 * Which currency a family pays in, which processor takes it, and what the
 * plans cost. Plain rules, no network.
 *
 * Prices are never typed into this code. They are read from the processors
 * themselves (a Stripe price, a Paystack plan), so the number a parent sees
 * on the account page is the number the processor will charge, and a change
 * in the dashboard is a change on the page. A guessed price in a child's
 * app would be worse than none.
 *
 * Two processors can run at once: Paystack for the currencies it serves
 * (Nigerian, Ghanaian, Kenyan, South African) and Stripe for the rest. A
 * family's currency comes from their device's time zone and language, as a
 * suggestion they can change; what they chose is what the checkout uses.
 */

import type { PaidPlan } from "./billing.js";

export interface Price {
  provider: string;
  plan: PaidPlan;
  /** ISO 4217, upper case. */
  currency: string;
  /** In the currency's smallest unit (kobo, cents, pesewas). */
  amountMinor: number;
}

/** Currencies with no minor unit on the processors' side. */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "XOF", "XAF", "UGX", "RWF", "VND", "CLP", "ISK"]);

/** Currencies Paystack is the natural home for; Stripe takes the rest. */
export const PAYSTACK_FIRST = new Set(["NGN", "GHS", "KES", "ZAR"]);

/** A device's time zone, and failing that its language, point at a currency. */
const BY_ZONE: Array<[RegExp, string]> = [
  [/^Africa\/Lagos$/, "NGN"],
  [/^Africa\/Accra$/, "GHS"],
  [/^Africa\/Nairobi$/, "KES"],
  [/^Africa\/(Johannesburg|Maseru|Mbabane)$/, "ZAR"],
  [/^Europe\/London$/, "GBP"],
  [/^Europe\/(Dublin|Lisbon|Madrid|Paris|Berlin|Rome|Amsterdam|Brussels|Vienna|Helsinki|Athens|Luxembourg|Bratislava|Ljubljana|Riga|Tallinn|Vilnius|Valletta|Nicosia|Malta|Zagreb)$/, "EUR"],
  [/^Asia\/(Kolkata|Calcutta)$/, "INR"],
  [/^Asia\/Tokyo$/, "JPY"],
  [/^Australia\//, "AUD"],
  [/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina)$/, "CAD"],
  [/^America\//, "USD"],
  [/^Pacific\/Honolulu$/, "USD"],
];
const BY_LANGUAGE: Array<[RegExp, string]> = [
  [/-NG$/i, "NGN"],
  [/-GH$/i, "GHS"],
  [/-KE$/i, "KES"],
  [/-ZA$/i, "ZAR"],
  [/-GB$/i, "GBP"],
  [/-IN$/i, "INR"],
  [/-(FR|DE|ES|IT|NL|PT|BE|AT|IE|FI)$/i, "EUR"],
  [/-US$/i, "USD"],
];

/** The currency a device suggests, before checking what is actually on offer. */
export function suggestedCurrency(hints: { timezone?: string | null; language?: string | null }): string | null {
  for (const [re, cur] of BY_ZONE) if (hints.timezone && re.test(hints.timezone)) return cur;
  for (const [re, cur] of BY_LANGUAGE) if (hints.language && re.test(hints.language)) return cur;
  return null;
}

/** The currencies that have a price for every paid plan, in a stable order. */
export function currenciesOnOffer(prices: Price[]): string[] {
  const plans = new Set<PaidPlan>(["plus", "premium"]);
  const seen = new Map<string, Set<PaidPlan>>();
  for (const p of prices) seen.set(p.currency, new Set([...(seen.get(p.currency) ?? []), p.plan]));
  return [...seen.entries()]
    .filter(([, have]) => [...plans].every((pl) => have.has(pl)))
    .map(([c]) => c)
    .sort((a, b) => (a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b)));
}

/**
 * The currency to show: the family's own choice if it is on offer, else the
 * device's suggestion if it is, else US dollars, else whatever is first.
 */
export function chooseCurrency(opts: {
  chosen?: string | null;
  timezone?: string | null;
  language?: string | null;
  onOffer: string[];
}): string | null {
  const want = [opts.chosen?.toUpperCase(), suggestedCurrency(opts), "USD", opts.onOffer[0]];
  for (const c of want) if (c && opts.onOffer.includes(c)) return c;
  return null;
}

/** The processor that takes this currency, Paystack first where it is at home. */
export function providerFor(currency: string, prices: Price[]): string | null {
  const able = [...new Set(prices.filter((p) => p.currency === currency).map((p) => p.provider))];
  if (able.length === 0) return null;
  if (PAYSTACK_FIRST.has(currency) && able.includes("paystack")) return "paystack";
  return able.includes("stripe") ? "stripe" : able[0];
}

/** The two plan prices in one currency from one processor, or null if either is missing. */
export function quoteFor(currency: string, prices: Price[]): { provider: string; plus: number; premium: number } | null {
  const provider = providerFor(currency, prices);
  if (!provider) return null;
  const find = (plan: PaidPlan) => prices.find((p) => p.provider === provider && p.currency === currency && p.plan === plan);
  const plus = find("plus");
  const premium = find("premium");
  if (!plus || !premium) return null;
  return { provider, plus: plus.amountMinor, premium: premium.amountMinor };
}

/** Minor units to a plain number of the currency, for display. */
export function toMajor(amountMinor: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? amountMinor : amountMinor / 100;
}
