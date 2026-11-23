#!/usr/bin/env node
/**
 * Makes the test head: a small, licence-free rigged character in glTF, so
 * the 3D engine can be proven before the artist's first model arrives, and
 * kept honest after it does.
 *
 * It is not a face anyone will see in the product. It is a sphere with a
 * mouth, two eye nodes, a Head node, and the ARKit sliders the driver
 * expects, each one really moving vertices. Its whole job is to let the
 * tests and the browser probe ask "did the jaw open, did the smile rise,
 * did the eyes blink, did the head turn" of a real glTF file loaded by the
 * real loader.
 *
 * Written by hand with no library, so the file is exactly what it says.
 *
 *   node tools/avatar/make-test-head.mjs
 * writes apps/web/test/fixtures/test-head.glb
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const OUT = new URL("../../apps/web/test/fixtures/test-head.glb", import.meta.url).pathname;

// ---------------------------------------------------------------- geometry
function sphere(radius, wSeg, hSeg) {
  const pos = [], nor = [], idx = [];
  for (let y = 0; y <= hSeg; y++) {
    const v = y / hSeg;
    const phi = v * Math.PI;
    for (let x = 0; x <= wSeg; x++) {
      const u = x / wSeg;
      const theta = u * Math.PI * 2;
      const nx = -Math.cos(theta) * Math.sin(phi);
      const ny = Math.cos(phi);
      const nz = Math.sin(theta) * Math.sin(phi);
      pos.push(radius * nx, radius * ny, radius * nz);
      nor.push(nx, ny, nz);
    }
  }
  for (let y = 0; y < hSeg; y++) {
    for (let x = 0; x < wSeg; x++) {
      const a = y * (wSeg + 1) + x;
      const b = a + wSeg + 1;
      if (y !== 0) idx.push(a, b, a + 1);
      if (y !== hSeg - 1) idx.push(b, b + 1, a + 1);
    }
  }
  return { pos, nor, idx };
}

const head = sphere(1, 24, 18);
const eye = sphere(0.11, 10, 8);
const vertexCount = head.pos.length / 3;

// ---------------------------------------------------------------- sliders
// Each slider is a displacement per vertex. Regions are picked by position:
// the mouth is the lower front, the brows the upper front, the eyes the
// upper front left and right. Small numbers, real movement.
const front = (i) => head.pos[i * 3 + 2] > 0.35;         // facing the camera (+z)
const yOf = (i) => head.pos[i * 3 + 1];
const xOf = (i) => head.pos[i * 3];
const lowerFace = (i) => front(i) && yOf(i) < -0.15 && yOf(i) > -0.75;
const mouthCornerL = (i) => lowerFace(i) && xOf(i) < -0.25 && xOf(i) > -0.6;
const mouthCornerR = (i) => lowerFace(i) && xOf(i) > 0.25 && xOf(i) < 0.6;
const jaw = (i) => front(i) && yOf(i) < -0.35;
const browL = (i) => front(i) && yOf(i) > 0.35 && yOf(i) < 0.6 && xOf(i) < -0.1;
const browR = (i) => front(i) && yOf(i) > 0.35 && yOf(i) < 0.6 && xOf(i) > 0.1;
const browInner = (i) => front(i) && yOf(i) > 0.35 && yOf(i) < 0.6 && Math.abs(xOf(i)) < 0.25;
const lidL = (i) => front(i) && yOf(i) > 0.15 && yOf(i) < 0.4 && xOf(i) < -0.15 && xOf(i) > -0.5;
const lidR = (i) => front(i) && yOf(i) > 0.15 && yOf(i) < 0.4 && xOf(i) > 0.15 && xOf(i) < 0.5;
const cheekL = (i) => front(i) && yOf(i) > -0.15 && yOf(i) < 0.15 && xOf(i) < -0.3;
const cheekR = (i) => front(i) && yOf(i) > -0.15 && yOf(i) < 0.15 && xOf(i) > 0.3;

function target(fn) {
  const d = new Array(vertexCount * 3).fill(0);
  for (let i = 0; i < vertexCount; i++) {
    const v = fn(i);
    if (v) { d[i * 3] = v[0]; d[i * 3 + 1] = v[1]; d[i * 3 + 2] = v[2]; }
  }
  return d;
}

const SLIDERS = {
  jawOpen: target((i) => (jaw(i) ? [0, -0.28, 0] : null)),
  mouthClose: target((i) => (lowerFace(i) ? [0, 0.04, 0] : null)),
  mouthFunnel: target((i) => (lowerFace(i) ? [xOf(i) > 0 ? -0.08 : 0.08, 0, 0.1] : null)),
  mouthPucker: target((i) => (lowerFace(i) ? [xOf(i) > 0 ? -0.12 : 0.12, 0, 0.14] : null)),
  mouthSmileLeft: target((i) => (mouthCornerL(i) ? [-0.06, 0.12, 0] : null)),
  mouthSmileRight: target((i) => (mouthCornerR(i) ? [0.06, 0.12, 0] : null)),
  mouthFrownLeft: target((i) => (mouthCornerL(i) ? [0, -0.1, 0] : null)),
  mouthFrownRight: target((i) => (mouthCornerR(i) ? [0, -0.1, 0] : null)),
  mouthStretchLeft: target((i) => (mouthCornerL(i) ? [-0.1, 0, 0] : null)),
  mouthStretchRight: target((i) => (mouthCornerR(i) ? [0.1, 0, 0] : null)),
  mouthPressLeft: target((i) => (mouthCornerL(i) ? [0, 0, -0.04] : null)),
  mouthPressRight: target((i) => (mouthCornerR(i) ? [0, 0, -0.04] : null)),
  mouthLowerDownLeft: target((i) => (jaw(i) && xOf(i) < 0 ? [0, -0.08, 0] : null)),
  mouthLowerDownRight: target((i) => (jaw(i) && xOf(i) > 0 ? [0, -0.08, 0] : null)),
  mouthUpperUpLeft: target((i) => (lowerFace(i) && !jaw(i) && xOf(i) < 0 ? [0, 0.06, 0] : null)),
  mouthUpperUpRight: target((i) => (lowerFace(i) && !jaw(i) && xOf(i) > 0 ? [0, 0.06, 0] : null)),
  mouthRollLower: target((i) => (jaw(i) ? [0, 0.03, -0.05] : null)),
  tongueOut: target((i) => (jaw(i) && Math.abs(xOf(i)) < 0.15 ? [0, 0, 0.1] : null)),
  browInnerUp: target((i) => (browInner(i) ? [0, 0.1, 0] : null)),
  browDownLeft: target((i) => (browL(i) ? [0, -0.08, 0] : null)),
  browDownRight: target((i) => (browR(i) ? [0, -0.08, 0] : null)),
  eyeBlinkLeft: target((i) => (lidL(i) ? [0, -0.12, 0.02] : null)),
  eyeBlinkRight: target((i) => (lidR(i) ? [0, -0.12, 0.02] : null)),
  eyeSquintLeft: target((i) => (lidL(i) ? [0, -0.05, 0] : null)),
  eyeSquintRight: target((i) => (lidR(i) ? [0, -0.05, 0] : null)),
  cheekSquintLeft: target((i) => (cheekL(i) ? [0, 0.06, 0.02] : null)),
  cheekSquintRight: target((i) => (cheekR(i) ? [0, 0.06, 0.02] : null)),
};
const sliderNames = Object.keys(SLIDERS);

// ---------------------------------------------------------------- glb
const chunks = [];
let byteLength = 0;
function push(arr, Ctor) {
  const typed = Ctor.from(arr);
  const bytes = new Uint8Array(typed.buffer);
  const offset = byteLength;
  chunks.push(bytes);
  byteLength += bytes.byteLength;
  const pad = (4 - (byteLength % 4)) % 4;
  if (pad) { chunks.push(new Uint8Array(pad)); byteLength += pad; }
  return { offset, length: bytes.byteLength };
}
const minMax = (arr) => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < arr.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], arr[i + k]); max[k] = Math.max(max[k], arr[i + k]); }
  return { min, max };
};

const bufferViews = [], accessors = [];
function accessor(arr, Ctor, componentType, type, target) {
  const { offset, length } = push(arr, Ctor);
  bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: length, ...(target ? { target } : {}) });
  const count = arr.length / (type === "VEC3" ? 3 : 1);
  const acc = { bufferView: bufferViews.length - 1, componentType, count, type };
  if (type === "VEC3") Object.assign(acc, minMax(arr));
  accessors.push(acc);
  return accessors.length - 1;
}

const FLOAT = 5126, USHORT = 5123, ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;

const headPos = accessor(head.pos, Float32Array, FLOAT, "VEC3", ARRAY_BUFFER);
const headNor = accessor(head.nor, Float32Array, FLOAT, "VEC3", ARRAY_BUFFER);
const headIdx = accessor(head.idx, Uint16Array, USHORT, "SCALAR", ELEMENT_ARRAY_BUFFER);
const targets = sliderNames.map((n) => ({ POSITION: accessor(SLIDERS[n], Float32Array, FLOAT, "VEC3", ARRAY_BUFFER) }));

const eyePos = accessor(eye.pos, Float32Array, FLOAT, "VEC3", ARRAY_BUFFER);
const eyeNor = accessor(eye.nor, Float32Array, FLOAT, "VEC3", ARRAY_BUFFER);
const eyeIdx = accessor(eye.idx, Uint16Array, USHORT, "SCALAR", ELEMENT_ARRAY_BUFFER);

const gltf = {
  asset: { version: "2.0", generator: "dingba test head" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [
    { name: "Head", mesh: 0, children: [1, 2] },
    { name: "LeftEye", mesh: 1, translation: [-0.32, 0.22, 0.86] },
    { name: "RightEye", mesh: 1, translation: [0.32, 0.22, 0.86] },
  ],
  meshes: [
    {
      name: "HeadMesh",
      primitives: [{ attributes: { POSITION: headPos, NORMAL: headNor }, indices: headIdx, material: 0, targets }],
      weights: sliderNames.map(() => 0),
      extras: { targetNames: sliderNames },
    },
    { name: "EyeMesh", primitives: [{ attributes: { POSITION: eyePos, NORMAL: eyeNor }, indices: eyeIdx, material: 1 }] },
  ],
  materials: [
    { name: "Skin", pbrMetallicRoughness: { baseColorFactor: [0.75, 0.52, 0.38, 1], metallicFactor: 0, roughnessFactor: 0.8 } },
    { name: "Eye", pbrMetallicRoughness: { baseColorFactor: [0.12, 0.1, 0.1, 1], metallicFactor: 0, roughnessFactor: 0.3 } },
  ],
  bufferViews,
  accessors,
  buffers: [{ byteLength }],
};

const json = Buffer.from(JSON.stringify(gltf));
const jsonPad = (4 - (json.length % 4)) % 4;
const jsonChunk = Buffer.concat([json, Buffer.alloc(jsonPad, 0x20)]);
const bin = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);                       // "glTF"
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonChunk.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);                   // "JSON"
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(bin.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);                    // "BIN\0"

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.concat([header, jsonHeader, jsonChunk, binHeader, bin]));
console.log(`wrote ${OUT}: ${vertexCount} vertices, ${sliderNames.length} sliders, ${(12 + 16 + jsonChunk.length + bin.length) / 1024 | 0} KB`);
