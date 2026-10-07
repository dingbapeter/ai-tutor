#!/usr/bin/env node
/**
 * The 3D tutor probe: is the rigged face alive, and does it fall back with
 * grace where it cannot be?
 *
 * Loads the real production build with a persona that carries a rigged
 * model (the licence-free test head, served only to this probe, never to a
 * family), starts a lesson so the tutor speaks, and reads the engine's own
 * readout while it does: the jaw must open on the words, the smile must
 * come with the mood, the eyes must blink, the head must move, and it must
 * all settle when the voice stops. Then it takes WebGL away and checks the
 * drawn face steps in with no error.
 *
 * Chromium renders WebGL in software here, so it is the engine that proves
 * lip sync. WebKit and Firefox are run too; where their headless builds
 * will not play audio or draw WebGL, that is reported as a note, and the
 * fallback path is what gets checked.
 *
 * Same stack as the browser sweep; see docs/BROWSERS.md.
 *   node tools/device/avatar-probe.mjs [--url http://127.0.0.1:3100]
 *                                      [--engines chromium,webkit,firefox]
 *                                      [--chromium /path/to/chromium]
 */
import { chromium, firefox, webkit } from "@playwright/test";
import { readFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((p) => p.length),
);
const URL_BASE = args.url ?? "http://127.0.0.1:3100";
const ENGINES = { chromium, webkit, firefox };
const WANTED = (args.engines ?? "chromium,webkit,firefox").split(",").map((s) => s.trim());
const CHROME = args.chromium ?? process.env.CHROMIUM_PATH ?? undefined;
const HEAD = readFileSync(new URL("../../apps/web/test/fixtures/test-head.glb", import.meta.url));

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${name}${ok || !detail ? "" : `  (${detail})`}`);
};
const note = (m) => console.log(`    note: ${m}`);

/** A real voice-shaped sound: bursts of tone with gaps, three and a half seconds. */
function speechWav() {
  const rate = 22050, seconds = 3.5, n = Math.floor(rate * seconds);
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const burst = (t % 0.5) < 0.35 ? 1 : 0;              // syllables and gaps
    const env = burst * (0.6 + 0.4 * Math.sin(t * 9));   // loudness that moves
    const v = Math.sin(2 * Math.PI * 180 * t) * 0.5 + Math.sin(2 * Math.PI * 360 * t) * 0.25;
    pcm.writeInt16LE(Math.round(v * env * 0.8 * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
const WAV = speechWav();

/** Parse the engine's readout: "faces=1 visemes=0 head=1 eyes=1 jaw=0.42 ...". */
const parse = (s) => Object.fromEntries((s ?? "").split(" ").filter(Boolean).map((kv) => { const [k, v] = kv.split("="); return [k, Number(v)]; }));

async function wire(context, withWebGL) {
  // Service workers stay off in this probe: once one controls the page,
  // Playwright's WebKit can no longer stand in for the server below, and
  // Amara would quietly arrive without her test head.
  // Amara carries the test head, for this probe only.
  await context.route("**/personas", async (route) => {
    const res = await route.fetch();
    const list = await res.json();
    for (const p of list) if (p.id === "amara") p.model = "/test-head.glb";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(list) });
  });
  await context.route("**/test-head.glb", (route) => route.fulfill({ status: 200, contentType: "model/gltf-binary", body: HEAD }));
  // A real voice with real length, so the timeline has something to follow.
  await context.route("**/tts", (route) => route.fulfill({ status: 200, contentType: "audio/wav", body: WAV }));
  if (!withWebGL) {
    await context.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        if (String(type).startsWith("webgl")) return null;
        return orig.call(this, type, ...rest);
      };
    });
  }
}

async function startLesson(page) {
  await page.goto(`${URL_BASE}/learn`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /Amara/ }).click();
  await page.getByRole("button", { name: /Middle School Math/ }).click();
  await page.getByRole("button", { name: /^Start session$/ }).click();
  await page.locator(".msg.tutor").first().waitFor({ timeout: 20_000 });
}

for (const engineName of WANTED) {
  const engine = ENGINES[engineName];
  const launchOpts = engineName === "chromium"
    ? { ...(CHROME ? { executablePath: CHROME } : {}), args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=angle", "--use-angle=swiftshader"] }
    : {};
  const browser = await engine.launch(launchOpts);
  console.log(`\n=== ${engineName} ${browser.version()} ===`);

  // ---- with WebGL: the rigged face must be alive ----
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await wire(context, true);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    await startLesson(page);

    const host = page.locator(".avatar3d");
    const rendered = await host.locator("canvas").count().then((c) => c > 0).catch(() => false);
    // Ask the engine itself, so a model that failed to load on an engine
    // that can draw is a failure, not an excuse.
    const hasWebGL = await page.evaluate(() => Boolean(document.createElement("canvas").getContext("webgl2") || document.createElement("canvas").getContext("webgl")));
    if (!rendered && hasWebGL) {
      check("the rigged model loaded and is drawn", false, "this engine offers WebGL, yet the drawn face was shown");
    } else if (!rendered) {
      const fellBack = (await page.locator("svg").count()) > 0;
      check("no WebGL in this headless engine: the drawn face stepped in instead", fellBack);
      note("this engine build did not offer WebGL, so lip sync is proven on chromium");
    } else {
      check("the rigged model loaded and is drawn", true);
      // Sample the readout through the greeting and a little after.
      const samples = [];
      for (let i = 0; i < 60; i++) {
        samples.push(parse(await host.getAttribute("data-state")));
        await page.waitForTimeout(100);
      }
      const s0 = samples.find((s) => s.faces !== undefined) ?? {};
      check("the engine found the face sliders, the head node and both eyes", s0.faces >= 1 && s0.head === 1 && s0.eyes === 1, JSON.stringify(s0));
      const jaws = samples.map((s) => s.jaw ?? 0);
      const spoke = Math.max(...jaws) > 0.15;
      check("the jaw opens on the words while the voice plays", spoke, `max jaw=${Math.max(...jaws).toFixed(2)}`);
      const moving = jaws.filter((j) => j > 0.05).length;
      check("the mouth moves through shapes rather than hanging open", spoke && moving < jaws.length, `${moving}/${jaws.length} frames open`);
      check("the mood shows on the face (a smile with a warm greeting)", Math.max(...samples.map((s) => s.smile ?? 0)) > 0.1);
      check("the eyes blink", Math.max(...samples.map((s) => s.lid ?? 0)) > 0.5);
      const yaws = samples.map((s) => s.yaw ?? 0);
      check("the head is never frozen", Math.max(...yaws) - Math.min(...yaws) > 0.004, `range=${(Math.max(...yaws) - Math.min(...yaws)).toFixed(4)}`);
      const tail = jaws.slice(-8);
      check("the mouth settles when the voice stops", Math.max(...tail) < 0.12, `end jaw=${Math.max(...tail).toFixed(2)}`);
    }
    check("no page errors with the 3D tutor", errors.length === 0, errors.slice(0, 2).join(" | "));
    await context.close();
  }

  // ---- without WebGL: the drawn face steps in, with no error ----
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await wire(context, false);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    await startLesson(page);
    await page.waitForTimeout(800);
    check("without WebGL, the drawn face is shown instead of a blank", (await page.locator("svg").count()) > 0 && (await page.locator(".avatar3d canvas").count()) === 0);
    check("no page errors on the fallback path", errors.length === 0, errors.slice(0, 2).join(" | "));
    await context.close();
  }

  await browser.close();
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nthe 3D tutor is alive, and falls back with grace");
process.exit(failures ? 1 : 0);
