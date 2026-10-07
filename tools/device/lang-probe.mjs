#!/usr/bin/env node
/**
 * The language probe: do the app's own words follow the family, and never
 * show a draft to a child by accident?
 *
 * In a real browser, on every engine:
 *   - a French browser with no reviewed French still sees English (a draft
 *     is never chosen automatically);
 *   - a reviewer who opens ?uiDrafts=1 gets the switch with the drafts, and
 *     choosing Français turns the home page, the lesson start screen and
 *     the app bar French, and the choice survives a reload;
 *   - choosing العربية lays the whole page out right to left, with nothing
 *     spilling sideways, on the home page and the lesson start screen;
 *   - starting a lesson taught in Spanish, with no family choice, follows
 *     the teaching language when drafts are on;
 *   - back to English, English is English.
 *
 *   node tools/device/lang-probe.mjs [--url http://127.0.0.1:3100]
 *     [--engines webkit,chromium,firefox] [--chromium PATH]
 */
import { chromium, firefox, webkit } from "@playwright/test";

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((p) => p.length),
);
const WEB = args.url ?? "http://127.0.0.1:3100";
const CHROME = args.chromium ?? process.env.CHROMIUM_PATH ?? undefined;
const ENGINES = { webkit, chromium, firefox };
const WANTED = (args.engines ?? "webkit,chromium,firefox").split(",").map((s) => s.trim());

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${name}${ok || !detail ? "" : `  (${detail})`}`);
};
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const text = (page) => page.locator("body").innerText();

for (const name of WANTED) {
  const browser = await ENGINES[name].launch(name === "chromium" && CHROME ? { executablePath: CHROME } : {});
  console.log(`\n=== ${name} ${browser.version()} ===`);

  // A French-speaking family, drafts off (the live site as shipped).
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "fr-FR" });
    const page = await context.newPage();
    await page.goto(`${WEB}/learn`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const body = await text(page);
    check("a French browser still sees English while French is a draft", body.includes("Start session") && !body.includes("Commencer la séance"));
    check("and no switch is offered, since only English is reviewed", (await page.locator(".lang-switch").count()) === 0);
    await context.close();
  }

  // A reviewer, drafts on.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-US" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    await page.goto(`${WEB}/?uiDrafts=1`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const sw = page.locator(".lang-switch");
    const options = (await sw.count()) ? await sw.locator("option").allInnerTexts() : [];
    check("a reviewer gets the switch, with the drafts marked as drafts", options.includes("Français (draft)"), options.join(", "));

    await sw.selectOption("fr");
    await page.waitForTimeout(900);
    let body = await text(page);
    check("choosing Français turns the home page French", body.includes("Commencer à apprendre avec Dingba") && body.includes("Essaie :"), body.slice(0, 80));
    check("and the app bar", body.includes("Apprendre") && body.includes("Compte"));
    check("and the document says so", (await page.evaluate(() => document.documentElement.lang)) === "fr");
    check("the home page fits the screen in French", await fits(page));

    await page.goto(`${WEB}/learn`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    body = await text(page);
    check("the choice survives a reload and reaches the lesson start screen", body.includes("Commencer la séance") && body.includes("Choisis ton tuteur"));

    await page.locator(".lang-switch").selectOption("ar");
    await page.waitForTimeout(900);
    body = await text(page);
    const dir = await page.evaluate(() => document.documentElement.dir);
    check("choosing العربية lays the lesson start screen out right to left", dir === "rtl" && body.includes("ابدأ الجلسة"), `dir=${dir}`);
    check("and nothing spills sideways", await fits(page));
    await page.goto(`${WEB}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);
    check("the home page fits the screen right to left too", (await page.evaluate(() => document.documentElement.dir)) === "rtl" && (await fits(page)));

    // Forget the choice; a Spanish lesson then carries the Spanish words.
    await page.locator(".lang-switch").selectOption("en");
    await page.evaluate(() => localStorage.removeItem("dingba_ui_lang"));
    await page.goto(`${WEB}/learn`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(700);
    await page.getByLabel("Teaching language").selectOption("es");
    await page.waitForTimeout(900);
    body = await text(page);
    check("with no family choice, a lesson taught in Spanish follows into Spanish", body.includes("Empezar sesión"), body.slice(0, 80));
    check("and the teaching language stays Spanish", (await page.getByLabel("Idioma de enseñanza").inputValue()) === "es");

    await page.locator(".lang-switch").selectOption("en");
    await page.waitForTimeout(600);
    body = await text(page);
    check("back to English, English is English", body.includes("Start session") && (await page.evaluate(() => document.documentElement.dir)) === "ltr");
    check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
    await context.close();
  }
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nthe app's own words follow the family, and never a draft by accident");
process.exit(failures ? 1 : 0);
