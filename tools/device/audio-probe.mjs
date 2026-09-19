#!/usr/bin/env node
/**
 * The phone-audio probe: does the tutor's voice actually come out of an
 * iPhone?
 *
 * Safari (iOS above all) starts every AudioContext SUSPENDED and only lets
 * it wake inside a real user gesture. Two ways that bites us:
 *
 *   - Routing the voice through a sleeping context for lip-sync swallows the
 *     sound completely: the child sees a mouth move and hears nothing.
 *   - Some older Safari and in-app WebViews only have `webkitAudioContext`,
 *     so checking the bare name hides the hands-free button.
 *
 * This drives the real production build in a phone-sized browser with an
 * audio engine that behaves like Safari's, taps through as a child would
 * (pick a tutor, pick a subject, start), and checks what happened. It runs
 * two Safari temperaments: a "stubborn" one whose engine never wakes (the
 * voice must still be heard, lip-sync gracefully dropped) and a "willing"
 * one (the voice is routed, so the mouth follows it).
 *
 * It is a manual probe, not a CI job: it needs a built web app and a running
 * API. Real devices are still the final word; this catches the class of bug
 * that no amount of desktop testing would.
 *
 * Usage (start the API fresh: each run spends a guest session, and the
 * daily guest limit is real):
 *   pnpm --filter @tutor/api dev                     # the API, on 4100
 *   cd apps/web && NEXT_PUBLIC_API_URL=http://127.0.0.1:4100 pnpm build
 *   cp -r .next/static .next/standalone/apps/web/.next/static
 *   (cd .next/standalone/apps/web && PORT=3100 node server.js)
 *   node tools/device/audio-probe.mjs [--url http://127.0.0.1:3100]
 *
 * Add --chromium /path/to/chromium (or CHROMIUM_PATH) where the browser is
 * not where Playwright installs it.
 */

import { chromium, devices } from "@playwright/test";

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((p) => p.length),
);
const URL = args.url ?? "http://127.0.0.1:3100";
// Where Chromium lives, when it is not where Playwright installs it.
const CHROME = args.chromium ?? process.env.CHROMIUM_PATH ?? undefined;

/** An audio engine that behaves like Safari's, and a record of what was done to it. */
const safariAudio = (wakes) => `
  window.__log = { routed: 0, played: 0, resumed: 0, unlockBuffers: 0 };
  class FakeNode { connect(){} disconnect(){} }
  class FakeAnalyser extends FakeNode {
    constructor(){ super(); this.fftSize = 256; this.frequencyBinCount = 128; this.smoothingTimeConstant = 0; }
    getByteTimeDomainData(a){ a.fill(128); }
    getFloatTimeDomainData(a){ a.fill(0); }
  }
  class SafariCtx {
    constructor(){ this.state = "suspended"; window.__ctxCount = (window.__ctxCount || 0) + 1; }
    async resume(){ window.__log.resumed++; if (${wakes ? "true" : "false"}) this.state = "running"; }
    createMediaElementSource(){ window.__log.routed++; return new FakeNode(); }
    createMediaStreamSource(){ return new FakeNode(); }
    createAnalyser(){ return new FakeAnalyser(); }
    createBuffer(){ return {}; }
    createBufferSource(){ window.__log.unlockBuffers++; return { buffer: null, connect(){}, start(){} }; }
    get destination(){ return new FakeNode(); }
    close(){ this.state = "closed"; return Promise.resolve(); }
  }
  delete window.AudioContext;            // the webkit-only shape
  window.webkitAudioContext = SafariCtx;
  // Speakers we do not have: record the attempt instead of failing on it.
  HTMLMediaElement.prototype.play = function(){
    window.__log.played++;
    window.__lastPlayInline = this.playsInline;
    return Promise.resolve();
  };
`;

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
};

for (const [label, device, wakes] of [
  ["iPhone, engine never wakes", devices["iPhone 14"], false],
  ["iPhone, engine wakes on the tap", devices["iPhone 14"], true],
  ["Android Chrome", devices["Pixel 7"], true],
]) {
  const context = await browser.newContext({ ...device });
  await context.addInitScript(safariAudio(wakes));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${URL}/learn`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  console.log(`\n--- ${label} ---`);

  check(
    "the hands-free button is offered on a webkit-only browser",
    await page.evaluate(() => !!(window.AudioContext || window.webkitAudioContext)),
  );

  await page.getByRole("button", { name: /Amara/ }).tap();
  await page.getByRole("button", { name: /Middle School Math/ }).tap();
  await page.getByRole("button", { name: /^Start session$/ }).tap();
  await page.waitForTimeout(2500);

  const log = await page.evaluate(() => ({ ...window.__log, ctxCount: window.__ctxCount || 0, inline: window.__lastPlayInline }));
  const greeted = await page.evaluate(() => !!document.querySelector(".msg.tutor"));
  const shown = await page.evaluate(() => document.querySelector(".err")?.textContent ?? "");
  check("the first tap reached the audio engine", log.ctxCount > 0 && log.resumed > 0, JSON.stringify(log));
  check("the tutor greeted, and its voice was played", log.played > 0 && greeted, shown && `page says: ${shown}`);
  check("the voice element is marked inline, so iOS will not take over the screen", log.inline === true);
  if (wakes) check("with a live engine the voice is routed, so the mouth can follow it", log.routed > 0);
  else check("with a sleeping engine the voice is NOT routed, so it stays audible", log.routed === 0);
  check("nothing scrolls sideways", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await context.close();
}

await browser.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
