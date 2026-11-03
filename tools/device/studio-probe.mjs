#!/usr/bin/env node
/**
 * The Studio probe: can an artist check a character and see it alive, on
 * their own, with nothing leaving their browser?
 *
 * In a real browser it:
 *   - opens /studio and drops the licence-free test head on it,
 *   - reads the verdict and the plain-words lines, strict and lenient,
 *   - sees the character drawn, says the sample line and watches the jaw
 *     move with the words, then walks through sliders by name,
 *   - drops a file that is not a character and reads why,
 *   - drops a character with a slider that moves nothing and sees it named,
 *   - and proves no request carried the file anywhere.
 *
 *   node tools/device/studio-probe.mjs [--url http://127.0.0.1:3100]
 *     [--engines chromium,webkit] [--chromium PATH]
 * Chromium and WebKit draw the character; Firefox headless has no WebGL,
 * so there the probe checks the check and the honest message instead.
 */
import { chromium, firefox, webkit } from "@playwright/test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((p) => p.length),
);
const WEB = args.url ?? "http://127.0.0.1:3100";
const CHROME = args.chromium ?? process.env.CHROMIUM_PATH ?? undefined;
const ENGINES = { chromium, webkit, firefox };
const WANTED = (args.engines ?? "chromium,webkit,firefox").split(",").map((s) => s.trim());
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HEAD = join(repo, "apps", "web", "test", "fixtures", "test-head.glb");

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${name}${ok || !detail ? "" : `  (${detail})`}`);
};
const parse = (s) => Object.fromEntries((s ?? "").split(" ").filter(Boolean).map((kv) => { const [k, v] = kv.split("="); return [k, Number(v)]; }));

// A copy of the test head with one slider flattened to nothing: the name is
// right, the movement is gone. Found by zeroing its target's bytes.
function flatten(bytes, sliderName) {
  const out = Buffer.from(bytes);
  const jsonLen = out.readUInt32LE(12);
  const json = JSON.parse(out.subarray(20, 20 + jsonLen).toString("utf8").replace(/\0+$/, ""));
  const binAt = 20 + jsonLen + 8;
  for (const mesh of json.meshes) {
    const names = mesh.extras?.targetNames ?? [];
    for (const prim of mesh.primitives) {
      (prim.targets ?? []).forEach((t, i) => {
        if (names[i] !== sliderName || t.POSITION === undefined) return;
        const acc = json.accessors[t.POSITION];
        const bv = json.bufferViews[acc.bufferView];
        out.fill(0, binAt + (bv.byteOffset ?? 0), binAt + (bv.byteOffset ?? 0) + bv.byteLength);
      });
    }
  }
  return out;
}
const dir = mkdtempSync(join(tmpdir(), "studio-probe-"));
const FLAT = join(dir, "flat-smile.glb");
writeFileSync(FLAT, flatten(readFileSync(HEAD), "mouthSmileLeft"));
const NOT = join(dir, "notes.glb");
writeFileSync(NOT, "these are my notes, not a character");

for (const name of WANTED) {
  const launch = name === "chromium"
    ? { ...(CHROME ? { executablePath: CHROME } : {}), args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=angle", "--use-angle=swiftshader"] }
    : {};
  const browser = await ENGINES[name].launch(launch);
  console.log(`\n=== ${name} ${browser.version()} ===`);
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const requests = [];
  page.on("request", (r) => requests.push({ url: r.url(), method: r.method(), size: r.postData()?.length ?? 0 }));

  await page.goto(`${WEB}/studio`, { waitUntil: "domcontentloaded" });
  check("the Studio opens and says the file stays in the browser", (await page.locator("body").innerText()).includes("nothing is uploaded"));

  // The test head, strict: a test file, so the budgets fail and say why.
  await page.locator('input[type="file"]').setInputFiles(HEAD);
  await page.locator(".studio-verdict[data-verdict='fail'], .studio-verdict[data-verdict='pass']").waitFor({ timeout: 20_000 });
  let text = await page.locator(".studio-report").innerText();
  check("a work-in-progress file gets a plain verdict with a count", /Not yet: \d+ things? to fix/.test(text), text.split("\n")[0]);
  check("and the lines say what is wrong in the artist's terms", text.includes("missing nodes: Hips, Spine, Neck") && text.includes("triangles (30,000 to 60,000)"));
  check("and what is right", text.includes("every slider really moves vertices"));

  // Lenient: the budgets become warnings, and it passes.
  await page.getByLabel(/Work in progress/).check();
  await page.locator(".studio-verdict[data-verdict='pass']").waitFor({ timeout: 10_000 }).catch(() => {});
  text = await page.locator(".studio-report").innerText();
  check("marked work in progress, the budgets warn and the rig passes", text.startsWith("Ready: this character meets the contract"), text.split("\n")[0]);

  // Alive, where the engine can draw.
  const hasWebGL = await page.evaluate(() => Boolean(document.createElement("canvas").getContext("webgl2") || document.createElement("canvas").getContext("webgl")));
  const canvas = await page.locator(".studio-canvas canvas").count();
  if (hasWebGL) {
    check("the character is drawn", canvas === 1);
    await page.locator(".studio-engine").waitFor({ timeout: 15_000 });
    const engine = await page.locator(".studio-engine").innerText();
    check("the engine panel says what it found", engine.includes("face found") && engine.includes("head node found") && engine.includes("eyes found"), engine);

    await page.getByRole("button", { name: "Say it" }).click();
    let jawMax = 0;
    let jawSamples = 0;
    for (let i = 0; i < 40; i++) {
      const st = parse(await page.locator(".avatar3d").getAttribute("data-state"));
      jawMax = Math.max(jawMax, st.jaw ?? 0);
      if ((st.jaw ?? 0) > 0.1) jawSamples++;
      await page.waitForTimeout(100);
    }
    check("saying the line moves the jaw on the words", jawMax > 0.2 && jawSamples >= 3, `max ${jawMax.toFixed(2)}, ${jawSamples} open samples`);

    await page.getByRole("button", { name: "Walk through every slider" }).click();
    const seen = new Set();
    for (let i = 0; i < 30; i++) {
      const s = await page.locator(".studio-slider").getAttribute("data-slider").catch(() => null);
      if (s) seen.add(s);
      await page.waitForTimeout(150);
    }
    check("the walk names each slider as it moves it", seen.size >= 3 && seen.has("browDownLeft"), [...seen].join(", "));
    const during = parse(await page.locator(".avatar3d").getAttribute("data-state"));
    check("while walking, the head holds still", Math.abs(during.yaw) < 1e-6 && Math.abs(during.pitch) < 1e-6, `yaw ${during.yaw} pitch ${during.pitch}`);
    await page.getByRole("button", { name: "Stop" }).click();
  } else {
    console.log("    note: this engine build has no WebGL; the check and the honest message are what is proven here");
    await page.locator(".studio-fallback").waitFor({ timeout: 15_000 }).catch(() => {});
    check("without WebGL, the Studio says so instead of showing a blank", (await page.locator(".studio-fallback").count()) === 1);
  }

  // A slider that moves nothing, named exactly.
  await page.locator('input[type="file"]').setInputFiles(FLAT);
  await page.waitForTimeout(800);
  await page.locator(".studio-verdict[data-verdict='fail']").waitFor({ timeout: 10_000 });
  text = await page.locator(".studio-report").innerText();
  check("a slider with the right name that moves nothing is named", text.includes("mouthSmileLeft (moves nothing)"));

  // Not a character at all.
  await page.locator('input[type="file"]').setInputFiles(NOT);
  await page.waitForTimeout(800);
  text = await page.locator(".studio-report").innerText();
  check("a file that is not a character is explained", text.includes("not a glTF binary"));

  // Nothing left the browser: no request carried a body, and none went to
  // anyone but Dingba. (The app shell's own small GETs to the API, for the
  // platform notice, are not the file.)
  const posts = requests.filter((r) => r.method !== "GET" || r.size > 0);
  const longUrl = requests.filter((r) => r.url.length > 2000);
  const outside = [...new Set(requests.map((r) => new URL(r.url).origin))].filter((o) => o !== WEB && !/127\.0\.0\.1:4100|localhost:4100|dingba\.ai/.test(o));
  check("no request carried the file anywhere", posts.length === 0 && longUrl.length === 0 && outside.length === 0, `${posts.length} with a body, ${longUrl.length} long, outside: ${outside.join(", ")}`);
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nan artist can check a character and see it alive, alone, with nothing leaving the browser");
process.exit(failures ? 1 : 0);
