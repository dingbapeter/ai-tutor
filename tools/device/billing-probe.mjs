#!/usr/bin/env node
/**
 * The billing probe: does a family see the right price, in their own
 * currency, and reach the right checkout?
 *
 * Runs against an API started with the mock processor carrying two
 * currencies, which is how this probe is meant to be run locally:
 *
 *   BILLING_PROVIDER=mock MOCK_BILLING_SECRET=probe \
 *   MOCK_BILLING_PRICES='[{"plan":"plus","currency":"NGN","amountMinor":250000},{"plan":"premium","currency":"NGN","amountMinor":750000},{"plan":"plus","currency":"USD","amountMinor":500},{"plan":"premium","currency":"USD","amountMinor":1200}]' \
 *   ... the usual API start
 *
 * In a real browser, on every engine:
 *   - a parent in Lagos sees naira on the family page, with the amounts
 *     the processor reports, and a currency switch;
 *   - choosing US dollars changes the amounts and is remembered;
 *   - tapping a plan goes to the checkout for that plan in that currency;
 *   - a parent in London, whose pounds are not on offer, sees dollars.
 *
 *   node tools/device/billing-probe.mjs [--url http://127.0.0.1:3100]
 *     [--api http://127.0.0.1:4100] [--engines webkit,chromium,firefox]
 */
import { chromium, firefox, webkit } from "@playwright/test";

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((p) => p.length),
);
const WEB = args.url ?? "http://127.0.0.1:3100";
const API = args.api ?? "http://127.0.0.1:4100";
const CHROME = args.chromium ?? process.env.CHROMIUM_PATH ?? undefined;
const ENGINES = { webkit, chromium, firefox };
const WANTED = (args.engines ?? "webkit,chromium,firefox").split(",").map((s) => s.trim());

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${name}${ok || !detail ? "" : `  (${detail})`}`);
};

const status = await fetch(`${API}/billing/status`).then((r) => r.json()).catch(() => null);
if (!status?.configured || !(status.currencies ?? []).includes("NGN") || !status.currencies.includes("USD")) {
  console.error("start the API with the mock processor carrying NGN and USD prices (see the header of this file)");
  process.exit(2);
}

async function family(tag) {
  const email = `pay-${tag}-${Date.now()}@example.com`;
  const res = await fetch(`${API}/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "password12", role: "parent" }) });
  return (await res.json()).token;
}

for (const name of WANTED) {
  const browser = await ENGINES[name].launch(name === "chromium" && CHROME ? { executablePath: CHROME } : {});
  console.log(`\n=== ${name} ${browser.version()} ===`);

  // Lagos.
  {
    const token = await family("lagos");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Africa/Lagos", locale: "en-NG" });
    await context.addInitScript((t) => { try { localStorage.setItem("tutor_token", t); } catch {} }, token);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    await page.goto(`${WEB}/account`, { waitUntil: "domcontentloaded" });
    await page.locator(".plan-offer").waitFor({ timeout: 15_000 });
    await page.locator(".plan-currency").waitFor({ timeout: 15_000 }).catch(() => {});
    let offer = await page.locator(".plan-offer").innerText();
    check("a parent in Lagos sees naira, with the processor's amounts", /NGN|₦/.test(offer) && /2,?500/.test(offer) && /7,?500/.test(offer), offer.replace(/\n/g, " | "));
    check("and a currency switch", (await page.locator(".plan-currency select").count()) === 1);
    check("and who takes the money", offer.includes("Cancel any time"));

    await page.locator(".plan-currency select").selectOption("USD");
    await page.waitForTimeout(800);
    offer = await page.locator(".plan-offer").innerText();
    check("choosing dollars changes the amounts", /\$5|US\$5|USD\s?5/.test(offer) && /\$12|US\$12|USD\s?12/.test(offer), offer.replace(/\n/g, " | "));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".plan-currency").waitFor({ timeout: 15_000 });
    check("and the choice is remembered", (await page.locator(".plan-currency select").inputValue()) === "USD");

    await page.getByRole("button", { name: /Plus/ }).click();
    await page.waitForURL(/mock-checkout-plus-usd/, { timeout: 15_000 }).catch(() => {});
    check("tapping a plan reaches the checkout for that plan in that currency", page.url().includes("mock-checkout-plus-usd"), page.url());
    check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
    await context.close();
  }

  // London: pounds are not on offer, so dollars.
  {
    const token = await family("london");
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Europe/London", locale: "en-GB" });
    await context.addInitScript((t) => { try { localStorage.setItem("tutor_token", t); } catch {} }, token);
    const page = await context.newPage();
    await page.goto(`${WEB}/account`, { waitUntil: "domcontentloaded" });
    await page.locator(".plan-currency").waitFor({ timeout: 15_000 });
    check("a parent in London, whose pounds are not on offer, sees dollars", (await page.locator(".plan-currency select").inputValue()) === "USD");
    await context.close();
  }
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nevery family sees the right price in their own currency and reaches the right checkout");
process.exit(failures ? 1 : 0);
