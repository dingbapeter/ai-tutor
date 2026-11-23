#!/usr/bin/env node
/**
 * The outbox probe: does a child's question survive a dead connection?
 *
 * The banner has always told them their messages "will send when the
 * connection returns". This is the test of that sentence. It takes a real
 * browser offline in the middle of a lesson, types a question, brings the
 * network back, and watches what happens, on every engine.
 *
 * It also checks the refusals that must NOT be retried: when the server
 * itself answers (out of messages for today, for instance), the message is
 * gone for good and the learner is told why, because silently resending
 * would spend a family's allowance behind their back.
 *
 * Same stack as the browser sweep; see docs/BROWSERS.md for how to start it.
 *   node tools/device/outbox-probe.mjs [--url http://127.0.0.1:3100]
 *                                      [--engines webkit,chromium,firefox]
 *                                      [--chromium /path/to/chromium]
 */

import { chromium, firefox, webkit } from "@playwright/test";

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((p) => p.length),
);
const URL_BASE = args.url ?? "http://127.0.0.1:3100";
const ENGINES = { webkit, chromium, firefox };
const WANTED = (args.engines ?? "webkit,chromium,firefox").split(",").map((s) => s.trim());
const CHROME = args.chromium ?? process.env.CHROMIUM_PATH ?? undefined;

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${name}${ok || !detail ? "" : `  (${detail})`}`);
};

const tutorLines = (page) => page.locator(".msg.tutor").count();

async function startLesson(page) {
  await page.goto(`${URL_BASE}/learn`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /Amara/ }).click();
  await page.getByRole("button", { name: /Middle School Math/ }).click();
  await page.getByRole("button", { name: /^Start session$/ }).click();
  await page.locator(".msg.tutor").first().waitFor({ timeout: 15_000 });
}

for (const engineName of WANTED) {
  const engine = ENGINES[engineName];
  const browser = await engine.launch(engineName === "chromium" && CHROME ? { executablePath: CHROME } : {});
  console.log(`\n=== ${engineName} ${browser.version()} ===`);
  // Service workers off for this probe only. Ours leaves every message POST
  // alone, but once a worker controls the page, Playwright's WebKit can no
  // longer stand in for the server, so the refusal below would reach the
  // real server instead. The outbox lives in the page, not the worker, and
  // the sweep checks the worker itself.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

  await startLesson(page);
  const before = await tutorLines(page);

  // The connection dies, exactly as it does on a bus or in a power cut.
  await context.setOffline(true);
  await page.locator(".composer input.inp").fill("what is seven times eight?");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(3500); // the send tries twice before giving up

  const waitingText = await page.locator(".waiting").textContent().catch(() => "");
  check("the question is held, not lost", (waitingText ?? "").includes("waiting for the connection"), waitingText ?? "(no line)");
  check("no error is shouted at the child for having no signal",
    (await page.locator(".err").count()) === 0);
  check("the tutor is not left with an empty speech bubble",
    (await tutorLines(page)) === before);

  // It must survive the tab closing, which is what a phone does on its own.
  const saved = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem("dingba_outbox") || "[]").length; } catch { return -1; }
  });
  check("it is written down, so closing the tab does not lose it", saved === 1, `stored=${saved}`);

  // The connection comes back.
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const sent = await page
    .locator(".msg.tutor")
    .nth(before)
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  check("it sends itself when the connection returns", sent);
  // The answer streams in after the bubble appears; the note is torn up when
  // the whole turn is done, so wait for that rather than race it.
  await page.locator(".waiting").waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector(".composer .btn:last-child")?.disabled, null, { timeout: 30_000 }).catch(() => {});
  check("the child's own words went, not a placeholder",
    (await page.locator(".msg.user").last().innerText()).includes("seven times eight"));
  check("nothing is left waiting afterwards", (await page.locator(".waiting").count()) === 0);
  const after = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem("dingba_outbox") || "[]").length; } catch { return -1; }
  });
  check("the note is torn up once the message has gone", after === 0, `stored=${after}`);

  // A refusal the server actually made must NOT be retried behind their back.
  await page.route("**/message", (route) =>
    route.fulfill({ status: 402, contentType: "application/json", body: JSON.stringify({ error: "You've reached today's limit." }) }));
  const linesNow = await tutorLines(page);
  await page.locator(".composer input.inp").fill("one more question");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);
  check("a refusal from the server is told to the child, not queued",
    (await page.locator(".err").innerText().catch(() => "")).includes("limit"));
  check("and it is not secretly waiting to spend their allowance later",
    (await page.locator(".waiting").count()) === 0);
  check("no phantom reply was added", (await tutorLines(page)) === linesNow);
  await page.unroute("**/message");

  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await context.close();
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nno message is ever lost, on any engine");
process.exit(failures ? 1 : 0);
