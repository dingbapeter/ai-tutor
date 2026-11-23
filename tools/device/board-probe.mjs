#!/usr/bin/env node
/**
 * The whiteboard probe: can a child actually write on it, and does the
 * writing reach the tutor?
 *
 * Drawing is the one part of Dingba that depends on pointer input, canvas
 * and image export all working together, and those are exactly the things
 * that differ between engines and between a finger and a mouse. So this
 * draws on the real board, on every engine, and checks that ink appeared,
 * that undo and clear mean what they say, that the page did not scroll out
 * from under the drawing hand, and that pressing "Show my tutor" produces a
 * picture the tutor answers.
 *
 * Same stack as the browser sweep; see docs/BROWSERS.md for how to start it.
 *   node tools/device/board-probe.mjs [--url http://127.0.0.1:3100]
 *                                     [--engines webkit,chromium,firefox]
 *                                     [--chromium /path/to/chromium]
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

/** How much of the board is not white: our measure of "there is ink here". */
const inkFraction = (page) =>
  page.evaluate(() => {
    const el = document.querySelector("canvas.board-canvas");
    if (!el) return -1;
    const ctx = el.getContext("2d");
    const { data } = ctx.getImageData(0, 0, el.width, el.height);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 200) dark++;
    return dark / (data.length / 4);
  });

/** Draw a stroke across the board with a real pointer. */
async function scribble(page, box, rows = 3) {
  for (let r = 0; r < rows; r++) {
    const y = box.y + box.height * (0.3 + r * 0.15);
    await page.mouse.move(box.x + box.width * 0.15, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(box.x + box.width * (0.15 + i * 0.08), y + (i % 2 ? 12 : -12));
    }
    await page.mouse.up();
  }
}

for (const engineName of WANTED) {
  const engine = ENGINES[engineName];
  const browser = await engine.launch(engineName === "chromium" && CHROME ? { executablePath: CHROME } : {});
  console.log(`\n=== ${engineName} ${browser.version()} ===`);
  // A phone, because that is where a finger draws.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

  await page.goto(`${URL_BASE}/learn`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /Amara/ }).click();
  await page.getByRole("button", { name: /Middle School Math/ }).click();
  await page.getByRole("button", { name: /^Start session$/ }).click();
  await page.locator(".msg.tutor").first().waitFor({ timeout: 15_000 }).catch(() => {});

  await page.getByTitle("Work it out on the board").click();
  const canvas = page.locator("canvas.board-canvas");
  check("the board opens", await canvas.isVisible());
  const box = await canvas.boundingBox();

  check("nothing to show on an empty board", await page.getByRole("button", { name: "Show my tutor" }).isDisabled());

  const scrollBefore = await page.evaluate(() => window.scrollY);
  await scribble(page, box);
  const afterWriting = await inkFraction(page);
  check("writing leaves ink on the board", afterWriting > 0.001, `ink=${afterWriting.toFixed(4)}`);
  check("the page did not scroll out from under the drawing hand", (await page.evaluate(() => window.scrollY)) === scrollBefore);
  check("there is now something to show", await page.getByRole("button", { name: "Show my tutor" }).isEnabled());

  await page.getByTitle("Undo the last thing you drew").click();
  const afterUndo = await inkFraction(page);
  check("undo takes back the last stroke, not the whole board", afterUndo < afterWriting && afterUndo > 0, `${afterWriting.toFixed(4)} -> ${afterUndo.toFixed(4)}`);

  // The eraser must take ink away, not add white lines over a white page.
  await page.getByTitle("Rub out").click();
  await scribble(page, box, 1);
  const afterErase = await inkFraction(page);
  check("the eraser rubs out", afterErase < afterUndo, `${afterUndo.toFixed(4)} -> ${afterErase.toFixed(4)}`);

  await page.getByTitle("Start the board again").click();
  check("clear leaves a clean white page", (await inkFraction(page)) === 0);
  check("a cleared board has nothing to show", await page.getByRole("button", { name: "Show my tutor" }).isDisabled());

  // Write again and send it: the tutor must answer what the child wrote.
  await page.getByTitle("Write").click();
  await scribble(page, box);
  const tutorLines = await page.locator(".msg.tutor").count();
  await page.getByRole("button", { name: "Show my tutor" }).click();
  const answered = await page
    .locator(".msg.tutor")
    .nth(tutorLines)
    .waitFor({ timeout: 25_000 })
    .then(() => true)
    .catch(() => false);
  check("the tutor answers the working", answered);
  check("the board puts itself away once the work is sent", !(await canvas.isVisible()));
  const mine = await page.locator(".msg.user").last().innerText();
  check("the lesson records what the child did", mine.includes("Showed my working"), mine.slice(0, 40));
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

  await context.close();
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nthe board works on every engine");
process.exit(failures ? 1 : 0);
