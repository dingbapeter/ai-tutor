#!/usr/bin/env node
/**
 * Puts the face model's engine where the browser can fetch it, from our own
 * site and nowhere else.
 *
 * The engine (WebAssembly, Apache-2.0) ships inside the npm package; this
 * copies the two variants a browser may ask for (with and without SIMD)
 * into public/face/wasm at build time, so nothing is fetched from a third
 * party and it keeps working in places a CDN is blocked. The model file
 * itself (Apache-2.0, about 3.7 MB) is committed, and checked here against
 * its known fingerprint so a swapped or damaged file fails the build
 * instead of shipping.
 *
 * Runs before every build: `node scripts/face-assets.mjs && next build`.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const publicFace = join(here, "..", "public", "face");
const MODEL = join(publicFace, "face_landmarker.task");
const MODEL_SHA256 = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff";

// The package does not export its package.json, so resolve its entry file
// and walk up to the package folder.
const require = createRequire(import.meta.url);
let pkgDir = dirname(require.resolve("@mediapipe/tasks-vision", { paths: [join(here, "..")] }));
while (!existsSync(join(pkgDir, "wasm")) && dirname(pkgDir) !== pkgDir) pkgDir = dirname(pkgDir);
const wasmFrom = join(pkgDir, "wasm");
const wasmTo = join(publicFace, "wasm");
const FILES = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];

mkdirSync(wasmTo, { recursive: true });
for (const f of FILES) {
  const src = join(wasmFrom, f);
  if (!existsSync(src)) {
    console.error(`face-assets: missing ${src}; is @mediapipe/tasks-vision installed?`);
    process.exit(1);
  }
  copyFileSync(src, join(wasmTo, f));
}

if (!existsSync(MODEL)) {
  console.error(`face-assets: the face model is missing at ${MODEL}`);
  process.exit(1);
}
const sum = createHash("sha256").update(readFileSync(MODEL)).digest("hex");
if (sum !== MODEL_SHA256) {
  console.error(`face-assets: the face model does not match its fingerprint (got ${sum})`);
  process.exit(1);
}
const mb = (p) => (statSync(p).size / 1024 / 1024).toFixed(1);
console.log(`face-assets: engine copied (${FILES.length} files), model verified (${mb(MODEL)} MB)`);
