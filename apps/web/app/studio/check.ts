/**
 * The character check: does a glTF file meet the tutor contract?
 *
 * One set of rules, run in two places: in the artist's browser on the
 * Studio page, and from the command line (tools/avatar/validate-glb.ts).
 * Both import this file, so a character that passes in one passes in the
 * other. Plain arithmetic over the bytes, no 3D library, no Node, no DOM.
 *
 * Stricter than a name check: a morph target with the right name that
 * moves no vertices fails, because a slider that does nothing is a mouth
 * that does not move. Every line is written in the artist's own terms.
 */

export const ARKIT = [
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
] as const;
export const VISEMES = ["sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "ih", "oh", "ou"] as const;
/** The ones the engine leans on hardest; missing any of these is a real problem. */
export const ESSENTIAL = [
  "jawOpen", "mouthClose", "mouthFunnel", "mouthPucker", "mouthSmileLeft", "mouthSmileRight",
  "mouthStretchLeft", "mouthStretchRight", "browInnerUp", "browDownLeft", "browDownRight", "eyeBlinkLeft", "eyeBlinkRight",
] as const;
export const REQUIRED_NODES = ["Hips", "Spine", "Neck", "Head", "LeftEye", "RightEye"] as const;

export type Level = "ok" | "warn" | "fail" | "note";
export interface Line {
  level: Level;
  text: string;
}
export interface Report {
  lines: Line[];
  failures: number;
  warnings: number;
  pass: boolean;
  /** The facts behind the lines, for the Studio to build on. */
  facts: {
    sizeMb: number;
    triangles: number;
    vertices: number;
    /** Every morph target name the file carries, as written. */
    targets: string[];
    missingArkit: string[];
    missingEssential: string[];
    visemes: number;
    nodes: string[];
    images: number;
    largestTexturePx: number;
    width: number;
    height: number;
  };
}

export interface CheckOptions {
  /** Budgets (size, triangles, skeleton) warn instead of failing. Rig checks always count. */
  lenient?: boolean;
}

interface Accessor {
  type: keyof typeof NUM;
  componentType: number;
  count: number;
  bufferView?: number;
  byteOffset?: number;
  min?: number[];
  max?: number[];
  sparse?: {
    count: number;
    indices: { bufferView: number; byteOffset?: number; componentType: number };
    values: { bufferView: number; byteOffset?: number };
  };
}
interface BufferView {
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}
interface Primitive {
  mode?: number;
  indices?: number;
  attributes: { POSITION: number };
  targets?: Array<{ POSITION?: number }>;
}
interface Gltf {
  nodes?: Array<{ name?: string; children?: number[] }>;
  skins?: unknown[];
  meshes?: Array<{ name?: string; primitives?: Primitive[]; extras?: { targetNames?: string[] } }>;
  accessors?: Accessor[];
  bufferViews?: BufferView[];
  images?: Array<{ uri?: string; bufferView?: number }>;
  materials?: unknown[];
}

const COMP: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 } as const;

const MAGIC_GLTF = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export function checkGlb(bytes: Uint8Array, opts: CheckOptions = {}): Report {
  const lenient = Boolean(opts.lenient);
  const lines: Line[] = [];
  let failures = 0;
  let warnings = 0;
  const ok = (text: string) => lines.push({ level: "ok", text });
  const note = (text: string) => lines.push({ level: "note", text });
  const fail = (text: string) => {
    failures++;
    lines.push({ level: "fail", text });
  };
  const warn = (text: string) => {
    warnings++;
    lines.push({ level: "warn", text });
  };
  const budget = (cond: boolean, text: string) => (cond ? ok(text) : lenient ? warn(text) : fail(text));

  const facts: Report["facts"] = {
    sizeMb: bytes.byteLength / (1024 * 1024),
    triangles: 0,
    vertices: 0,
    targets: [],
    missingArkit: [],
    missingEssential: [],
    visemes: 0,
    nodes: [],
    images: 0,
    largestTexturePx: 0,
    width: 0,
    height: 0,
  };
  const finish = (): Report => ({ lines, failures, warnings, pass: failures === 0, facts });

  // ---------------------------------------------------------------- container
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || view.getUint32(0, true) !== MAGIC_GLTF) {
    fail("not a glTF binary (.glb): export as glTF Binary, not glTF Separate or FBX");
    return finish();
  }
  if (view.getUint32(4, true) !== 2) fail(`glTF version ${view.getUint32(4, true)}, expected 2`);
  if (view.getUint32(8, true) !== bytes.byteLength) {
    fail(`the file says it is ${view.getUint32(8, true)} bytes but is ${bytes.byteLength}: cut short or corrupted`);
  }
  let json: Gltf | null = null;
  let bin: Uint8Array | null = null;
  let off = 12;
  while (off + 8 <= bytes.byteLength) {
    const len = view.getUint32(off, true);
    const type = view.getUint32(off + 4, true);
    const data = bytes.subarray(off + 8, off + 8 + len);
    if (type === CHUNK_JSON) {
      try {
        json = JSON.parse(new TextDecoder().decode(data).replace(/\0+$/, "")) as Gltf;
      } catch {
        fail("the file's description is not readable JSON");
        return finish();
      }
    } else if (type === CHUNK_BIN) bin = data;
    off += 8 + len;
  }
  if (!json) {
    fail("no description chunk inside the file");
    return finish();
  }
  const binView = bin ? new DataView(bin.buffer, bin.byteOffset, bin.byteLength) : null;
  ok("valid glTF 2.0 binary container");
  budget(facts.sizeMb <= 15, `file size ${facts.sizeMb.toFixed(2)} MB (limit 15, target 8 to 12)`);
  if (facts.sizeMb < 0.5 && !lenient) warn("under half a megabyte: is this the real character or a test?");

  // ---------------------------------------------------------------- accessors
  const readComponent = (p: number, componentType: number): number => {
    if (!binView) return 0;
    switch (componentType) {
      case 5126: return binView.getFloat32(p, true);
      case 5123: return binView.getUint16(p, true);
      case 5125: return binView.getUint32(p, true);
      case 5121: return binView.getUint8(p);
      case 5122: return binView.getInt16(p, true);
      default: return binView.getInt8(p);
    }
  };
  /**
   * An accessor as plain numbers. Handles both forms real exporters use for
   * morph targets: a dense buffer, and "sparse" (zeros plus a short list of
   * the vertices that move). Blender writes morph targets sparse.
   */
  const readAccessor = (i: number) => {
    const a = json!.accessors![i];
    const n = NUM[a.type];
    const cs = COMP[a.componentType];
    const out = new Float64Array(a.count * n);
    if (a.bufferView !== undefined) {
      const bv = json!.bufferViews![a.bufferView];
      const stride = bv.byteStride ?? n * cs;
      const start = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
      for (let k = 0; k < a.count; k++) {
        for (let c = 0; c < n; c++) out[k * n + c] = readComponent(start + k * stride + c * cs, a.componentType);
      }
    }
    if (a.sparse) {
      const sp = a.sparse;
      const ibv = json!.bufferViews![sp.indices.bufferView];
      const vbv = json!.bufferViews![sp.values.bufferView];
      const ics = COMP[sp.indices.componentType];
      const iStart = (ibv.byteOffset ?? 0) + (sp.indices.byteOffset ?? 0);
      const vStart = (vbv.byteOffset ?? 0) + (sp.values.byteOffset ?? 0);
      for (let k = 0; k < sp.count; k++) {
        const idx = readComponent(iStart + k * ics, sp.indices.componentType);
        for (let c = 0; c < n; c++) out[idx * n + c] = readComponent(vStart + (k * n + c) * cs, a.componentType);
      }
    }
    return { data: out, n, count: a.count };
  };

  // ---------------------------------------------------------------- nodes
  const nodes = json.nodes ?? [];
  facts.nodes = nodes.map((n) => n.name ?? "");
  const missingNodes = REQUIRED_NODES.filter((r) => !facts.nodes.includes(r));
  budget(
    missingNodes.length === 0,
    missingNodes.length
      ? `missing nodes: ${missingNodes.join(", ")} (name the bones exactly Hips, Spine, Neck, Head, LeftEye, RightEye)`
      : "skeleton and eye nodes present (Hips, Spine, Neck, Head, LeftEye, RightEye)",
  );
  const byName = new Map<string, number>();
  nodes.forEach((n, i) => { if (n.name) byName.set(n.name, i); });
  const childOf = (parent: string, child: string) => {
    const p = byName.get(parent);
    const c = byName.get(child);
    return p !== undefined && c !== undefined && (nodes[p].children ?? []).includes(c);
  };
  if (byName.has("Head") && byName.has("LeftEye")) {
    budget(childOf("Head", "LeftEye") && childOf("Head", "RightEye"), "eyes are children of Head, so gaze moves with the head");
  }
  budget(Boolean(json.skins?.length), json.skins?.length ? `skinned: ${json.skins.length} skin(s)` : "no skin: the head cannot be posed by its bones");

  // ---------------------------------------------------------------- meshes
  const targetNamesAll = new Set<string>();
  const dead: string[] = [];
  let extent: { min: number[]; max: number[] } | null = null;
  for (const mesh of json.meshes ?? []) {
    const names = mesh.extras?.targetNames ?? [];
    for (const prim of mesh.primitives ?? []) {
      const mode = prim.mode ?? 4;
      const acc = json.accessors ?? [];
      const count = prim.indices !== undefined ? acc[prim.indices].count : acc[prim.attributes.POSITION].count;
      facts.triangles += mode === 4 ? Math.floor(count / 3) : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0;
      const pos = acc[prim.attributes.POSITION];
      if (pos.min && pos.max) {
        extent = extent ?? { min: [...pos.min], max: [...pos.max] };
        for (let k = 0; k < 3; k++) {
          extent.min[k] = Math.min(extent.min[k], pos.min[k]);
          extent.max[k] = Math.max(extent.max[k], pos.max[k]);
        }
      }
      const targets = prim.targets ?? [];
      if (targets.length) {
        facts.vertices = Math.max(facts.vertices, pos.count);
        if (names.length && names.length !== targets.length) {
          fail(`mesh "${mesh.name ?? "?"}": ${names.length} target names for ${targets.length} targets`);
        }
        const size = extent ? Math.max(...[0, 1, 2].map((k) => extent!.max[k] - extent!.min[k])) : 1;
        targets.forEach((t, ti) => {
          const name = names[ti] ?? `#${ti}`;
          targetNamesAll.add(name);
          if (t.POSITION === undefined) {
            dead.push(`${name} (no positions)`);
            return;
          }
          // Real deformation: the largest move of any vertex must be more
          // than numerical noise relative to the mesh's own size.
          const a = readAccessor(t.POSITION);
          let maxLen = 0;
          for (let k = 0; k < a.count; k++) {
            maxLen = Math.max(maxLen, Math.hypot(a.data[k * 3], a.data[k * 3 + 1], a.data[k * 3 + 2]));
          }
          if (maxLen < size * 1e-4) dead.push(`${name} (moves nothing)`);
        });
      }
    }
  }
  facts.targets = [...targetNamesAll];
  budget(facts.triangles >= 30_000 && facts.triangles <= 60_000, `${facts.triangles.toLocaleString()} triangles (30,000 to 60,000)`);
  if (facts.vertices === 0) fail("no morph targets on any mesh: the face cannot move (export shape keys / morph targets)");
  else ok(`morph targets on a ${facts.vertices.toLocaleString()}-vertex face mesh`);
  if (dead.length) fail(`sliders that move nothing: ${dead.slice(0, 8).join(", ")}${dead.length > 8 ? ` and ${dead.length - 8} more` : ""}`);
  else if (facts.vertices) ok("every slider really moves vertices");

  // ---------------------------------------------------------------- names
  const have = targetNamesAll;
  facts.missingArkit = ARKIT.filter((n) => !have.has(n));
  facts.missingEssential = ESSENTIAL.filter((n) => !have.has(n));
  if (facts.missingEssential.length) {
    fail(`essential sliders missing: ${facts.missingEssential.join(", ")} (names are case-sensitive)`);
  }
  if (facts.missingArkit.length === 0) ok("all 52 ARKit sliders present, named exactly");
  else if (facts.missingEssential.length === 0) {
    budget(false, `ARKit sliders missing (${facts.missingArkit.length}): ${facts.missingArkit.join(", ")}`);
  }
  facts.visemes = VISEMES.filter((v) => have.has(`viseme_${v}`) || have.has(v) || have.has(`v_${v}`)).length;
  if (facts.visemes === VISEMES.length) ok("all 15 visemes present as well");
  else if (facts.visemes) warn(`${facts.visemes}/15 visemes present; the engine blends the rest from ARKit`);
  else note("no viseme sliders: the engine blends mouth shapes from ARKit (fine)");
  const sideBad = [...have].filter(
    (n) => /Left$|Right$/.test(n) && !have.has(n.replace(/Left$/, "Right").replace(/Right$/, "Left")),
  );
  if (sideBad.length) warn(`one-sided sliders (no partner): ${sideBad.slice(0, 6).join(", ")}`);

  // ---------------------------------------------------------------- textures
  const images = json.images ?? [];
  facts.images = images.length;
  const external = images.filter((im) => im.uri && !im.uri.startsWith("data:"));
  budget(
    external.length === 0,
    external.length
      ? `textures referenced as separate files: ${external.map((e) => e.uri).join(", ")} (embed them)`
      : `${images.length} texture image(s), all embedded`,
  );
  const imageSize = (im: { bufferView?: number }) => {
    if (im.bufferView === undefined || !bin || !binView) return null;
    const bv = json!.bufferViews![im.bufferView];
    const start = bv.byteOffset ?? 0;
    const d = bin.subarray(start, start + bv.byteLength);
    if (d[0] === 0x89 && d[1] === 0x50) return { w: binView.getUint32(start + 16), h: binView.getUint32(start + 20) };
    if (d[0] === 0xff && d[1] === 0xd8) {
      let p = 2;
      while (p + 9 < d.length) {
        if (d[p] !== 0xff) { p++; continue; }
        const marker = d[p + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { h: binView.getUint16(start + p + 5), w: binView.getUint16(start + p + 7) };
        }
        p += 2 + binView.getUint16(start + p + 2);
      }
    }
    return { w: 0, h: 0 };
  };
  for (const im of images) {
    const s = imageSize(im);
    if (s) facts.largestTexturePx = Math.max(facts.largestTexturePx, s.w, s.h);
  }
  if (images.length) budget(facts.largestTexturePx <= 2048, `largest texture ${facts.largestTexturePx} px (limit 2048)`);
  const mats = json.materials ?? [];
  if (mats.length) ok(`${mats.length} material(s)`);
  else warn("no materials: the character will render flat grey");

  // ---------------------------------------------------------------- scale
  if (extent) {
    facts.height = extent.max[1] - extent.min[1];
    facts.width = extent.max[0] - extent.min[0];
    const h = facts.height;
    const w = facts.width;
    if (h > 0.15 && h < 1.2 && w > 0.1 && w < 1.0) ok(`size ${w.toFixed(2)} by ${h.toFixed(2)} metres: a bust at human scale`);
    else if (h > 15) warn(`size ${w.toFixed(0)} by ${h.toFixed(0)} units: this looks like centimetres; export in metres (the engine reframes, but check the scale)`);
    else warn(`size ${w.toFixed(2)} by ${h.toFixed(2)} units: expected a human-scale bust in metres (the engine reframes, but check the export scale)`);
  }

  return finish();
}

/** The report as the command line prints it. */
export function formatReport(report: Report): string {
  const mark: Record<Level, string> = { ok: "ok  ", warn: "warn", fail: "FAIL", note: "note" };
  const body = report.lines.map((l) => `  ${mark[l.level]}  ${l.text}`).join("\n");
  const tail = report.pass
    ? `RESULT: pass, ${report.warnings} warning(s)`
    : `RESULT: ${report.failures} failure(s), ${report.warnings} warning(s)`;
  return `${body}\n\n${tail}`;
}
