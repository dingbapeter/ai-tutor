#!/usr/bin/env node
/**
 * A scan in, a tutor out.
 *
 * Takes a scanned head (one textured statue, as an image-to-3D tool or a
 * scanner delivers it: no bones, no face controls) and writes a character
 * the lesson engine can bring to life: six bones, skin weights, the 52
 * ARKit face controls, the lips cut apart with teeth and a tongue behind
 * them, all on the scan's own surface, so the likeness and the texture
 * are untouched. No template head, no trained model, no GPU, no server:
 * one ordinary computer, a few minutes.
 *
 *   node tools/avatar/rig/rig-scan.ts scan.glb out.glb [--triangles 52000] [--no-judge] [--keep DIR]
 *
 * What it does, in order:
 *   1. renders the scan from the front (Blender);
 *   2. finds the face in that picture with the on-device face model the
 *      app already ships (in a headless browser);
 *   3. builds the character (Blender): see rig_scan.py;
 *   4. checks it against the same contract the Studio page enforces;
 *   5. unless --no-judge: renders every control fully on, has the face
 *      model score each picture, and writes `out-controls.png`, one sheet
 *      of all of them, for a person to look over.
 *
 * Needs: Blender 4.0 or newer on the PATH (or BLENDER=/path/to/blender),
 * Node 22.18 or newer, and the repository's own packages installed (the
 * browser comes from Playwright; CHROMIUM_PATH points at another one).
 *
 * The judge is honest about its own limits: the face model reads some
 * controls well (jaw, smile, blink, brows) and some hardly ever, even on
 * a living face (puffed cheeks, a jaw pushed forward). It is told apart
 * here, and the sheet is there for the eye.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkGlb, formatReport } from "../../../apps/web/app/studio/check.ts";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && argv[i - 1] !== "--no-judge"));
const [scanArg, outArg] = positional;
if (!scanArg || !outArg) {
  console.error("usage: node tools/avatar/rig/rig-scan.ts scan.glb out.glb [--triangles 52000] [--no-judge] [--keep DIR]");
  process.exit(2);
}
const scan = resolve(scanArg);
const out = resolve(outArg);
const judge = !argv.includes("--no-judge");
const blender = process.env.BLENDER ?? "blender";
const keep = flag("keep");
const work = keep ? resolve(keep) : mkdtempSync(join(tmpdir(), "rig-scan-"));
mkdirSync(work, { recursive: true });

/** Runs one step and shows the rigger's own lines, not the tool's chatter. */
function run(label: string, cmd: string, args: string[]) {
  let text: string;
  try {
    text = execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    const said = `${err.stdout ?? ""}\n${err.stderr ?? ""}`.split("\n").filter((l) => /^rig:|Error|Traceback|^\s+File /.test(l));
    console.error(`\n${label} failed:\n${said.join("\n") || err.message}`);
    process.exit(1);
  }
  for (const line of text.split("\n")) if (line.startsWith("rig:") || line.startsWith("read ")) console.log(`  ${line.replace(/^rig: /, "")}`);
}
const step = (name: string, more: string[]) => run(name, blender, ["-b", "--python", join(here, "rig_scan.py"), "--", "--step", name, ...more]);
const read = (json: string, pictures: string[]) => run("reading faces", process.execPath, [join(here, "face-read.mjs"), json, ...pictures]);

console.log(`\n1. The scan, from the front`);
step("front", ["--in", scan, "--png", join(work, "front.png"), "--state", join(work, "front.json")]);

console.log(`\n2. Finding the face`);
read(join(work, "front-read.json"), [join(work, "front.png")]);

console.log(`\n3. Building the character`);
step("build", ["--in", scan, "--landmarks", join(work, "front-read.json"), "--out", out, ...(flag("triangles") ? ["--triangles", flag("triangles")!] : [])]);

console.log(`\n4. The contract`);
const report = checkGlb(new Uint8Array(readFileSync(out)));
console.log(formatReport(report));

let seen = "";
if (judge) {
  console.log(`\n5. Every control, judged`);
  const pictures = join(work, "judge");
  step("judge", ["--blend", out.replace(/\.[^.]+$/, "") + ".rigged.blend", "--dir", pictures, "--close", "1", "--width", "420", "--height", "520", "--samples", "10"]);
  const names = [...report.facts.targets].sort();
  const files = ["rest", ...names].map((n) => join(pictures, `${n}.png`)).filter((f) => existsSync(f));
  read(join(work, "judge.json"), files);
  const scores = JSON.parse(readFileSync(join(work, "judge.json"), "utf8")) as Record<string, { shapes: Record<string, number> | null }>;
  const of = (n: string) => scores[join(pictures, `${n}.png`)]?.shapes ?? null;
  const rest = of("rest");
  const clear: string[] = [];
  const faint: string[] = [];
  const unseen: string[] = [];
  const unscored: string[] = [];
  if (rest) {
    for (const n of names) {
      const on = of(n);
      if (!on || rest[n] === undefined) {
        unscored.push(n);
        continue;
      }
      const rise = on[n] - rest[n];
      (rise >= 0.15 ? clear : rise >= 0.05 ? faint : unseen).push(n);
    }
    console.log(`  the face model, shown each control fully on, saw its own score for that control rise:`);
    console.log(`    clearly (${clear.length}): ${clear.join(", ")}`);
    console.log(`    faintly (${faint.length}): ${faint.join(", ")}`);
    console.log(`    not at all (${unseen.length}): ${unseen.join(", ")}`);
    if (unscored.length) console.log(`    it has no score for (${unscored.length}): ${unscored.join(", ")}`);
    console.log(`  resting face: smile ${((rest.mouthSmileLeft + rest.mouthSmileRight) / 2).toFixed(2)}, jaw ${rest.jawOpen.toFixed(2)}, blink ${((rest.eyeBlinkLeft + rest.eyeBlinkRight) / 2).toFixed(2)}`);
    // The controls a lesson leans on. If the face model cannot see these, the head is not ready whatever the contract says.
    const must = ["jawOpen", "mouthSmileLeft", "mouthSmileRight", "eyeBlinkLeft", "eyeBlinkRight", "browInnerUp"];
    const missing = must.filter((n) => !clear.includes(n) && !faint.includes(n));
    seen = missing.length ? `NOT seen by the face model: ${missing.join(", ")}` : "jaw, smile, blink and brow all seen by the face model";
  } else {
    seen = "the face model found no face in the finished head's resting picture";
  }
  const sheet = out.replace(/\.[^.]+$/, "") + "-controls.png";
  run("contact sheet", process.execPath, [join(here, "contact-sheet.mjs"), pictures, sheet, "8"]);
  console.log(`  every control on one sheet, to look over: ${sheet}`);
}

if (!keep) rmSync(work, { recursive: true, force: true });
const good = report.pass && (!judge || seen.startsWith("jaw"));
console.log(`\n${good ? "DONE" : "NOT READY"}: ${out}`);
console.log(`  contract: ${report.pass ? "passes" : `${report.failures} failure(s)`}${judge ? `\n  judge: ${seen}` : ""}`);
console.log(good ? `  next: drag it onto /studio and press "Say it"; then node tools/avatar/install-character.ts <tutor> ${outArg}` : "  see the lines above for what to fix");
process.exit(good ? 0 : 1);
