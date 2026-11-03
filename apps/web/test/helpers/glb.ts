/**
 * A small glTF binary writer for tests: builds characters with chosen
 * strengths and defects, so the check can be proven line by line without
 * committing large fixtures. Dense or sparse morph targets, as real
 * exporters write them.
 */

export interface BuildOptions {
  /** Segments of the sphere; triangles = 2 * seg * (seg / 2 - 1) roughly. */
  segments?: number;
  /** Morph target names to carry. */
  targets?: string[];
  /** Names whose targets move nothing. */
  dead?: string[];
  /** Write morph targets as sparse accessors (as Blender does). */
  sparse?: boolean;
  /** Overall size in metres (height of the head). */
  height?: number;
  nodes?: string[];
  eyesUnderHead?: boolean;
  skin?: boolean;
  /** Embedded textures by pixel size; 0 for none. */
  texturePx?: number[];
  externalTexture?: string;
  materials?: number;
  /** Declare the wrong length in the header. */
  corruptLength?: boolean;
  /** Leave out the target names. */
  dropTargetNames?: boolean;
}

const align4 = (n: number) => (n + 3) & ~3;

/** A PNG of the given square size, uncompressed, enough to carry a header. */
function png(px: number): Uint8Array {
  // Only the IHDR is read by the check; the rest can be any bytes.
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = new Uint8Array(25);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, 13);
  ihdr.set([0x49, 0x48, 0x44, 0x52], 4);
  dv.setUint32(8, px);
  dv.setUint32(12, px);
  ihdr.set([8, 2, 0, 0, 0], 16);
  return new Uint8Array([...sig, ...ihdr, 0, 0, 0, 0]);
}

export function buildGlb(opts: BuildOptions = {}): Uint8Array {
  const seg = opts.segments ?? 24;
  const rings = Math.max(3, Math.floor(seg / 2));
  const height = opts.height ?? 0.5;
  const r = height / 2;
  const targets = opts.targets ?? [];
  const dead = new Set(opts.dead ?? []);
  const nodes = opts.nodes ?? ["Hips", "Spine", "Neck", "Head", "LeftEye", "RightEye"];
  const eyesUnderHead = opts.eyesUnderHead ?? true;

  // ---- geometry: a UV sphere ----
  const positions: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const phi = (Math.PI * i) / rings;
    for (let j = 0; j <= seg; j++) {
      const theta = (2 * Math.PI * j) / seg;
      positions.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j;
      const b = a + seg + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const vcount = positions.length / 3;
  const min = [-r, -r, -r];
  const max = [r, r, r];

  // ---- the binary blob ----
  const chunks: Uint8Array[] = [];
  const bufferViews: Array<Record<string, unknown>> = [];
  const accessors: Array<Record<string, unknown>> = [];
  let offset = 0;
  const addView = (bytes: Uint8Array, extra: Record<string, unknown> = {}) => {
    const padded = new Uint8Array(align4(bytes.byteLength));
    padded.set(bytes);
    chunks.push(padded);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength, ...extra });
    offset += padded.byteLength;
    return bufferViews.length - 1;
  };
  const f32 = (arr: number[]) => new Uint8Array(new Float32Array(arr).buffer);
  const u32 = (arr: number[]) => new Uint8Array(new Uint32Array(arr).buffer);

  const posAcc = accessors.push({ bufferView: addView(f32(positions)), componentType: 5126, count: vcount, type: "VEC3", min, max }) - 1;
  const idxAcc = accessors.push({ bufferView: addView(u32(indices)), componentType: 5125, count: indices.length, type: "SCALAR" }) - 1;

  const targetAccs: Array<{ POSITION: number }> = [];
  targets.forEach((name, ti) => {
    // Each target pushes a different band of vertices outward a little.
    const moved: number[] = [];
    const disp: number[] = [];
    if (!dead.has(name)) {
      const band = ti % rings;
      for (let v = 0; v < vcount; v++) {
        if (Math.floor(v / (seg + 1)) === band) {
          moved.push(v);
          disp.push(positions[v * 3] * 0.08, positions[v * 3 + 1] * 0.08, positions[v * 3 + 2] * 0.08);
        }
      }
    }
    if (opts.sparse) {
      const acc: Record<string, unknown> = { componentType: 5126, count: vcount, type: "VEC3" };
      if (moved.length) {
        acc.sparse = {
          count: moved.length,
          indices: { bufferView: addView(u32(moved)), componentType: 5125 },
          values: { bufferView: addView(f32(disp)) },
        };
      }
      targetAccs.push({ POSITION: accessors.push(acc) - 1 });
    } else {
      const full = new Array(vcount * 3).fill(0);
      moved.forEach((v, k) => {
        full[v * 3] = disp[k * 3];
        full[v * 3 + 1] = disp[k * 3 + 1];
        full[v * 3 + 2] = disp[k * 3 + 2];
      });
      targetAccs.push({ POSITION: accessors.push({ bufferView: addView(f32(full)), componentType: 5126, count: vcount, type: "VEC3" }) - 1 });
    }
  });

  const images: Array<Record<string, unknown>> = [];
  for (const px of opts.texturePx ?? []) images.push({ mimeType: "image/png", bufferView: addView(png(px)) });
  if (opts.externalTexture) images.push({ uri: opts.externalTexture });

  // ---- nodes ----
  const nodeList: Array<Record<string, unknown>> = nodes.map((name) => ({ name }));
  const idx = (name: string) => nodes.indexOf(name);
  const link = (parent: string, child: string) => {
    if (idx(parent) < 0 || idx(child) < 0) return;
    const p = nodeList[idx(parent)];
    p.children = [...((p.children as number[] | undefined) ?? []), idx(child)];
  };
  link("Hips", "Spine");
  link("Spine", "Neck");
  link("Neck", "Head");
  if (eyesUnderHead) {
    link("Head", "LeftEye");
    link("Head", "RightEye");
  }
  const meshNode = nodeList.push({ name: "Face", mesh: 0, ...(opts.skin !== false ? { skin: 0 } : {}) }) - 1;
  const roots = nodeList.map((_, i) => i).filter((i) => !nodeList.some((n) => ((n.children as number[] | undefined) ?? []).includes(i)));
  void meshNode;

  const json: Record<string, unknown> = {
    asset: { version: "2.0", generator: "test builder" },
    scene: 0,
    scenes: [{ nodes: roots }],
    nodes: nodeList,
    meshes: [
      {
        name: "Face",
        primitives: [{ attributes: { POSITION: posAcc }, indices: idxAcc, ...(targetAccs.length ? { targets: targetAccs } : {}), ...(opts.materials === 0 ? {} : { material: 0 }) }],
        ...(targets.length && !opts.dropTargetNames ? { extras: { targetNames: targets } } : {}),
      },
    ],
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
    ...(opts.materials === 0 ? {} : { materials: Array.from({ length: opts.materials ?? 1 }, (_, i) => ({ name: `mat${i}` })) }),
    ...(images.length ? { images, textures: images.map((_, i) => ({ source: i })) } : {}),
    ...(opts.skin !== false && idx("Head") >= 0 ? { skins: [{ joints: nodes.map((_, i) => i) }] } : {}),
  };

  // ---- the container ----
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = new Uint8Array(align4(jsonBytes.byteLength)).fill(0x20);
  jsonPadded.set(jsonBytes);
  const bin = new Uint8Array(offset);
  let p = 0;
  for (const c of chunks) {
    bin.set(c, p);
    p += c.byteLength;
  }
  const total = 12 + 8 + jsonPadded.byteLength + 8 + bin.byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, opts.corruptLength ? total + 100 : total, true);
  dv.setUint32(12, jsonPadded.byteLength, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonPadded, 20);
  const binAt = 20 + jsonPadded.byteLength;
  dv.setUint32(binAt, bin.byteLength, true);
  dv.setUint32(binAt + 4, 0x004e4942, true);
  out.set(bin, binAt + 8);
  return out;
}
