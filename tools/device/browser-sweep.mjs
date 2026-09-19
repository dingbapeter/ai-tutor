#!/usr/bin/env node
/**
 * The browser sweep: does Dingba work everywhere a child might open it?
 *
 * Three engines cover the world's browsers:
 *   - WebKit    -> Safari on iPhone, iPad and Mac, and EVERY iOS browser
 *                  (Apple requires them all to use WebKit).
 *   - Chromium  -> Chrome, Edge (Windows), Samsung Internet, Opera, Brave,
 *                  Android's system WebView.
 *   - Firefox   -> Firefox on Windows, Mac and Android.
 *
 * Each engine is driven at four sizes: a Windows laptop, a Mac desktop, an
 * Android phone and an iPhone. On every one it walks the journeys a real
 * family walks, and fails loudly on a page error, a broken journey, or a
 * layout that spills sideways.
 *
 * Usage (a fresh API, with the guest cap raised because the sweep starts a
 * lot of sessions from one address):
 *   PORT=4100 GUEST_IP_CAP=500 pnpm --filter @tutor/api dev
 *   cd apps/web && NEXT_PUBLIC_API_URL=http://127.0.0.1:4100 pnpm build
 *   cp -r .next/static .next/standalone/apps/web/.next/static
 *   (cd .next/standalone/apps/web && PORT=3100 node server.js)
 *   node tools/device/browser-sweep.mjs [--url http://127.0.0.1:3100]
 *                                       [--engines webkit,chromium,firefox]
 *
 * Playwright ships the engines; `npx playwright install webkit firefox` and
 * `npx playwright install-deps` put them on the machine. Add
 * --chromium /path/to/chromium (or CHROMIUM_PATH) where Chromium lives
 * somewhere else.
 */

import { chromium, firefox, webkit } from "@playwright/test";

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((p) => p.length),
);
const URL_BASE = args.url ?? "http://127.0.0.1:3100";
const ENGINES = { webkit, chromium, firefox };
const WANTED = (args.engines ?? "webkit,chromium,firefox").split(",").map((s) => s.trim());
// Where Chromium lives, when it is not where Playwright installs it.
const CHROME = args.chromium ?? process.env.CHROMIUM_PATH ?? undefined;

/** What the engine stands for out in the world, and who it must serve. */
const WHO = {
  webkit: "Safari and every iPhone/iPad browser",
  chromium: "Chrome, Edge, Samsung Internet, Opera, Android WebView",
  firefox: "Firefox on Windows, Mac and Android",
};

const SIZES = [
  { name: "Windows laptop", viewport: { width: 1366, height: 768 } },
  { name: "Mac desktop", viewport: { width: 1440, height: 900 } },
  { name: "Android phone", viewport: { width: 412, height: 915 } },
  { name: "iPhone", viewport: { width: 390, height: 844 } },
];

let failures = 0;
const results = [];
function check(where, name, ok, detail) {
  if (!ok) failures++;
  results.push({ where, name, ok, detail });
  console.log(`  ${ok ? "pass" : "FAIL"}  ${name}${ok || !detail ? "" : `  (${detail})`}`);
}

/** Nothing may spill sideways: a child should never have to scroll to read. */
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const engineName of WANTED) {
  const engine = ENGINES[engineName];
  if (!engine) {
    console.log(`unknown engine: ${engineName}`);
    failures++;
    continue;
  }
  const browser = await engine.launch(engineName === "chromium" && CHROME ? { executablePath: CHROME } : {});
  console.log(`\n=== ${engineName} ${browser.version()} — ${WHO[engineName]} ===`);

  for (const size of SIZES) {
    console.log(`\n- ${size.name} (${size.viewport.width}x${size.viewport.height})`);
    const context = await browser.newContext({ viewport: size.viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    const where = `${engineName}/${size.name}`;

    // 1. The front door.
    await page.goto(`${URL_BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(400);
    check(where, "the homepage opens", await page.locator("text=Dingba").first().isVisible());
    check(where, "the homepage fits the screen", await fits(page));

    // 2. The lesson itself: choose a tutor, choose a subject, be greeted,
    //    ask a question and get a streamed answer back.
    await page.goto(`${URL_BASE}/learn`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    check(where, "the tutors are offered", await page.getByRole("button", { name: /Amara/ }).isVisible());
    await page.getByRole("button", { name: /Amara/ }).click();
    await page.getByRole("button", { name: /Middle School Math/ }).click();
    await page.getByRole("button", { name: /^Start session$/ }).click();
    const greeted = await page
      .locator(".msg.tutor")
      .first()
      .waitFor({ timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    check(where, "the tutor greets the learner", greeted, await page.locator(".err").first().textContent().catch(() => ""));

    if (greeted) {
      const before = await page.locator(".msg.tutor").count();
      await page.locator("input.inp, textarea").last().fill("what is 2 + 3?");
      await page.keyboard.press("Enter");
      // The answer streams in over a live connection: the piece most likely
      // to break on an engine that handles streaming differently.
      const answered = await page
        .locator(".msg.tutor")
        .nth(before)
        .waitFor({ timeout: 25_000 })
        .then(() => true)
        .catch(() => false);
      check(where, "the answer streams back", answered);
      check(where, "the lesson fits the screen", await fits(page));
    }

    // 3. What this engine can actually do, and whether Dingba is honest
    //    about it. Read from inside the lesson we are already in: a
    //    browser that cannot record must not be offered a talk button, and
    //    typing, which every browser has, must still be there.
    const caps = await page.evaluate(() => ({
      webAudio: typeof window.AudioContext === "function" || typeof window.webkitAudioContext === "function",
      recorder: typeof MediaRecorder !== "undefined",
      recorderType: typeof MediaRecorder === "undefined" ? "" :
        ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac"].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "",
      streaming: typeof ReadableStream === "function" && "body" in Response.prototype,
      storage: (() => { try { localStorage.setItem("_t", "1"); localStorage.removeItem("_t"); return true; } catch { return false; } })(),
      serviceWorker: "serviceWorker" in navigator,
      talkButton: document.querySelectorAll('[title="Hold to talk"]').length,
      typing: document.querySelectorAll(".composer input.inp").length,
    }));
    check(where, "the tutor can speak out loud here (web audio)", caps.webAudio);
    check(where, "typing is always available", caps.typing === 1);
    if (caps.recorder) {
      check(where, "the talk button is offered, with a format we can send", caps.talkButton === 1 && caps.recorderType !== "", `button=${caps.talkButton} format=${caps.recorderType || "none"}`);
    } else {
      // Playwright's Linux WebKit has no MediaRecorder; real Safari does.
      // It still stands in honestly for the in-app browsers that do not, so
      // what matters is that we degrade instead of breaking.
      check(where, "no talk button where the browser cannot record", caps.talkButton === 0, `button=${caps.talkButton}`);
      console.log("    note: this engine build has no recorder, so voice-in is unavailable here by design");
    }
    check(where, "streamed answers are supported", caps.streaming);
    check(where, "the session can be remembered (storage)", caps.storage);
    if (!caps.serviceWorker) console.log("    note: no service worker here, so no offline shell (the app still works online)");

    // 4. A lesson in a language that reads right to left must actually read
    //    right to left. Direction is the engine's business, not the
    //    screen's, so this runs once per engine.
    if (size === SIZES[0]) {
      await page.goto(`${URL_BASE}/learn`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(600);
      await page.getByRole("button", { name: /Amara/ }).click();
      await page.getByRole("button", { name: /Middle School Math/ }).click();
      await page.getByLabel("Teaching language").selectOption("ar").catch(() => {});
      await page.getByRole("button", { name: /^Start session$/ }).click();
      await page.locator(".msg.tutor").first().waitFor({ timeout: 15_000 }).catch(() => {});
      const arabic = await page.evaluate(() => {
        const chat = document.querySelector(".chat");
        const bubble = document.querySelector(".msg.tutor");
        return { dir: chat?.getAttribute("dir") ?? "", aligned: bubble ? getComputedStyle(bubble).textAlign : "" };
      });
      check(where, "an Arabic lesson reads right to left", arabic.dir === "rtl" && arabic.aligned === "right", JSON.stringify(arabic));
    }

    // 5. The parent's side.
    await page.goto(`${URL_BASE}/account`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(400);
    check(where, "the family page opens", await page.locator("input").first().isVisible());
    check(where, "the family page fits the screen", await fits(page));

    // 6. The pages a parent reads before trusting us, and the staff door.
    for (const [path, label] of [["/terms", "terms"], ["/privacy", "privacy"], ["/command", "command centre"]]) {
      await page.goto(`${URL_BASE}${path}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(300);
      check(where, `the ${label} page opens and fits`, (await page.locator("body").innerText()).length > 80 && (await fits(page)));
    }

    check(where, "no page errors anywhere in the journey", errors.length === 0, errors.slice(0, 2).join(" | "));

    await context.close();
  }
  await browser.close();
}

console.log("\n========== summary ==========");
for (const engineName of WANTED) {
  const mine = results.filter((r) => r.where.startsWith(`${engineName}/`));
  const bad = mine.filter((r) => !r.ok);
  console.log(`${engineName.padEnd(9)} ${mine.length - bad.length}/${mine.length} checks passed${bad.length ? `  -> ${bad.map((b) => `${b.where}: ${b.name}`).join("; ")}` : ""}`);
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nevery check passed on every engine");
process.exit(failures ? 1 : 0);
