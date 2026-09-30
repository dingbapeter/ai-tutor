#!/usr/bin/env node
/**
 * The character validator: does a delivered glTF actually meet the contract?
 *
 * Runs on any .glb the artist sends, before it goes near the product, and
 * says exactly what is wrong in the artist's own terms. Stricter than a
 * name check: a morph target with the right name and no movement is a
 * failure here, because a slider that does nothing is a mouth that does
 * not move.
 *
 * Standard library only, so anyone can run it anywhere:
 *   node tools/avatar/validate-glb.mjs path/to/amara.glb [--lenient]
 *
 * --lenient reports instead of failing on the budgets (size, triangles,
 * skeleton), for looking at a work-in-progress. The rig checks always
 * count.
 */
import { readFileSync, statSync } from "node:fs";

const ARKIT = [
  "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
  "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
  "eyeBlinkLeft", "eyeBlinkRight", "eyeLookDownLeft", "eyeLookDownRight", "eyeLookInLeft", "eyeLookInRight",
  "eyeLookOutLeft", "eyeLookOutRight", "eyeLookUpLeft", "eyeLookUpRight", "eyeSquintLeft", "eyeSquintRight",
  "eyeWideLeft", "eyeWideRight",
  "jawForward", "jawLeft", "jawOpen", "jawRight",
  "mouthClose", "mouthDimpleLeft", "mouthDimpleRight", "mouthFrownLeft", "mouthFrownRight", "mouthFunnel",
  "mouthLeft", "mouthLowerDownLeft", "mouthLowerDownRight", "mouthPressLeft", "mouthPressRight", "mouthPucker",
  "mouthRight", "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper",
  "mouthSmileLeft", "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight", "mouthUpperUpLeft", "mouthUpperUpRight",
  "noseSneerLeft", "noseSneerRight", "tongueOut",
];
const VISEMES = ["sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "ih", "oh", "ou"];
/** The ones the engine leans on hardest; missing any of these is a real problem. */
const ESSENTIAL = ["jawOpen", "mouthClose", "mouthFunnel", "mouthPucker", "mouthSmileLeft", "mouthSmileRight",
  "mouthStretchLeft", "mouthStretchRight", "browInnerUp", "browDownLeft", "browDownRight", "eyeBlinkLeft", "eyeBlinkRight"];
const REQUIRED_NODES = ["Hips", "Spine", "Neck", "Head", "LeftEye", "RightEye"];

const file = process.argv[2];
const lenient = process.argv.includes("--lenient");
if (!file) {
  console.error("usage: node tools/avatar/validate-glb.mjs character.glb [--lenient]");
  process.exit(2);
}

let failures = 0;
let warnings = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { failures++; console.log(`  FAIL  ${m}`); };
const warn = (m) => { warnings++; console.log(`  warn  ${m}`); };
const budget = (cond, m) => (cond ? ok(m) : lenient ? warn(m) : fail(m));

// ---------------------------------------------------------------- container
const bytes = readFileSync(file);
const sizeMb = statSync(file).size / (1024 * 1024);
console.log(`\n${file}  (${sizeMb.toFixed(2)} MB)\n`);
if (bytes.length < 12 || bytes.readUInt32LE(0) !== 0x46546c67) { fail("not a glTF binary (bad magic)"); done(); }
if (bytes.readUInt32LE(4) !== 2) fail(`glTF version ${bytes.readUInt32LE(4)}, expected 2`);
if (bytes.readUInt32LE(8) !== bytes.length) fail(`declared length ${bytes.readUInt32LE(8)} but file is ${bytes.length} bytes`);
let off = 12, json = null, bin = null;
while (off + 8 <= bytes.length) {
  const len = bytes.readUInt32LE(off), type = bytes.readUInt32LE(off + 4);
  const data = bytes.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(data.toString("utf8").replace(/\0+$/, ""));
  else if (type === 0x004e4942) bin = data;
  off += 8 + len;
}
if (!json) { fail("no JSON chunk"); done(); }
ok("valid glTF 2.0 binary container");
budget(sizeMb <= 15, `file size ${sizeMb.toFixed(2)} MB (limit 15, target 8 to 12)`);
if (sizeMb < 0.5 && !lenient) warn("under half a megabyte: is this the real character or a test?");

// ---------------------------------------------------------------- accessors
const COMP = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function readAccessor(i) {
  const a = json.accessors[i];
  const bv = json.bufferViews[a.bufferView];
  const n = NUM[a.type], cs = COMP[a.componentType];
  const stride = bv.byteStride ?? n * cs;
  const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = new Float64Array(a.count * n);
  for (let k = 0; k < a.count; k++) {
    for (let c = 0; c < n; c++) {
      const p = start + k * stride + c * cs;
      let v;
      switch (a.componentType) {
        case 5126: v = bin.readFloatLE(p); break;
        case 5123: v = bin.readUInt16LE(p); break;
        case 5125: v = bin.readUInt32LE(p); break;
        case 5121: v = bin.readUInt8(p); break;
        case 5122: v = bin.readInt16LE(p); break;
        default: v = bin.readInt8(p);
      }
      out[k * n + c] = v;
    }
  }
  return { data: out, n, count: a.count };
}

// ---------------------------------------------------------------- nodes
const nodeNames = (json.nodes ?? []).map((n) => n.name ?? "");
const missingNodes = REQUIRED_NODES.filter((r) => !nodeNames.includes(r));
budget(missingNodes.length === 0, missingNodes.length ? `missing nodes: ${missingNodes.join(", ")}` : "skeleton and eye nodes present (Hips, Spine, Neck, Head, LeftEye, RightEye)");
const byName = Object.fromEntries((json.nodes ?? []).map((n, i) => [n.name, i]));
const childOf = (parent, child) => byName[parent] !== undefined && (json.nodes[byName[parent]].children ?? []).includes(byName[child]);
if (byName.Head !== undefined && byName.LeftEye !== undefined) {
  budget(childOf("Head", "LeftEye") && childOf("Head", "RightEye"), "eyes are children of Head, so gaze moves with the head");
}
budget(!!(json.skins?.length), json.skins?.length ? `skinned: ${json.skins.length} skin(s)` : "no skin: the head cannot be posed by its bones");

// ---------------------------------------------------------------- meshes
let triangles = 0;
const targetNamesAll = new Set();
let bestVertices = 0;
let deadTargets = [];
let extent = null;
for (const mesh of json.meshes ?? []) {
  const names = mesh.extras?.targetNames ?? [];
  for (const prim of mesh.primitives ?? []) {
    const mode = prim.mode ?? 4;
    const count = prim.indices !== undefined ? json.accessors[prim.indices].count : json.accessors[prim.attributes.POSITION].count;
    triangles += mode === 4 ? Math.floor(count / 3) : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0;
    const pos = json.accessors[prim.attributes.POSITION];
    if (pos.min && pos.max) {
      extent = extent ?? { min: [...pos.min], max: [...pos.max] };
      for (let k = 0; k < 3; k++) { extent.min[k] = Math.min(extent.min[k], pos.min[k]); extent.max[k] = Math.max(extent.max[k], pos.max[k]); }
    }
    const targets = prim.targets ?? [];
    if (targets.length) {
      bestVertices = Math.max(bestVertices, pos.count);
      if (names.length && names.length !== targets.length) fail(`mesh "${mesh.name}": ${names.length} target names for ${targets.length} targets`);
      targets.forEach((t, ti) => {
        const name = names[ti] ?? `#${ti}`;
        targetNamesAll.add(name);
        if (t.POSITION === undefined) { deadTargets.push(`${name} (no POSITION)`); return; }
        // Real deformation: the largest displacement of any vertex must be
        // more than numerical noise relative to the mesh's own size.
        const acc = readAccessor(t.POSITION);
        let maxLen = 0;
        for (let k = 0; k < acc.count; k++) {
          const x = acc.data[k * 3], y = acc.data[k * 3 + 1], z = acc.data[k * 3 + 2];
          maxLen = Math.max(maxLen, Math.hypot(x, y, z));
        }
        const size = extent ? Math.max(...[0, 1, 2].map((k) => extent.max[k] - extent.min[k])) : 1;
        if (maxLen < size * 1e-4) deadTargets.push(`${name} (moves nothing)`);
      });
    }
  }
}
budget(triangles >= 30_000 && triangles <= 60_000, `${triangles.toLocaleString()} triangles (30,000 to 60,000)`);
if (bestVertices === 0) fail("no morph targets on any mesh: the face cannot move");
else ok(`morph targets on a ${bestVertices.toLocaleString()}-vertex face mesh`);
if (deadTargets.length) fail(`targets that do not deform anything: ${deadTargets.slice(0, 8).join(", ")}${deadTargets.length > 8 ? ` and ${deadTargets.length - 8} more` : ""}`);
else if (bestVertices) ok("every morph target really moves vertices");

// ---------------------------------------------------------------- names
const have = new Set([...targetNamesAll]);
const missingArkit = ARKIT.filter((n) => !have.has(n));
const missingEssential = ESSENTIAL.filter((n) => !have.has(n));
if (missingEssential.length) fail(`essential sliders missing: ${missingEssential.join(", ")}`);
if (missingArkit.length === 0) ok("all 52 ARKit sliders present, named exactly");
else if (missingEssential.length === 0) budget(false, `ARKit sliders missing (${missingArkit.length}): ${missingArkit.join(", ")}`);
const visemes = VISEMES.filter((v) => have.has(`viseme_${v}`) || have.has(v) || have.has(`v_${v}`));
if (visemes.length === VISEMES.length) ok("all 15 visemes present as well");
else if (visemes.length) warn(`${visemes.length}/15 visemes present; the engine blends the rest from ARKit`);
else console.log("  note  no viseme sliders: the engine will blend mouth shapes from ARKit (fine)");
const sideBad = [...have].filter((n) => /Left$|Right$/.test(n) && !have.has(n.replace(/Left$/, "Right").replace(/Right$/, "Left")));
if (sideBad.length) warn(`one-sided sliders (no partner): ${sideBad.slice(0, 6).join(", ")}`);

// ---------------------------------------------------------------- textures
const images = json.images ?? [];
const external = images.filter((im) => im.uri && !im.uri.startsWith("data:"));
budget(external.length === 0, external.length ? `external texture files referenced: ${external.map((e) => e.uri).join(", ")}` : `${images.length} texture image(s), all embedded`);
function imageSize(im) {
  if (im.bufferView === undefined) return null;
  const bv = json.bufferViews[im.bufferView];
  const d = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  if (d[0] === 0x89 && d[1] === 0x50) return { w: d.readUInt32BE(16), h: d.readUInt32BE(20), kind: "png" };
  if (d[0] === 0xff && d[1] === 0xd8) {
    let p = 2;
    while (p < d.length) {
      if (d[p] !== 0xff) { p++; continue; }
      const marker = d[p + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { h: d.readUInt16BE(p + 5), w: d.readUInt16BE(p + 7), kind: "jpeg" };
      p += 2 + d.readUInt16BE(p + 2);
    }
  }
  return { w: 0, h: 0, kind: "unknown" };
}
let maxPx = 0;
for (const im of images) { const s = imageSize(im); if (s) maxPx = Math.max(maxPx, s.w, s.h); }
if (images.length) budget(maxPx <= 2048, `largest texture ${maxPx} px (limit 2048)`);
const mats = json.materials ?? [];
if (mats.length) ok(`${mats.length} material(s)`); else warn("no materials: the character will render flat grey");

// ---------------------------------------------------------------- scale
if (extent) {
  const h = extent.max[1] - extent.min[1];
  const w = extent.max[0] - extent.min[0];
  if (h > 0.15 && h < 1.2 && w > 0.1 && w < 1.0) ok(`size ${w.toFixed(2)} by ${h.toFixed(2)} metres: a bust at human scale`);
  else warn(`size ${w.toFixed(2)} by ${h.toFixed(2)} units: expected a human-scale bust in metres (the engine reframes, but check the export scale)`);
}

done();
function done() {
  console.log("");
  if (failures) { console.log(`RESULT: ${failures} failure(s), ${warnings} warning(s)`); process.exit(1); }
  console.log(`RESULT: pass, ${warnings} warning(s)`);
  process.exit(0);
}
