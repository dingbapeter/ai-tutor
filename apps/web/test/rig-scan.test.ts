import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { headBox } from "../app/learn/avatar/frame";
import { settleMouth } from "../app/learn/avatar/blendshapes";
import { ARKIT, checkGlb } from "../app/studio/check";

/**
 * The scan rigger, through real headless Blender, on a stand-in head with
 * a face's proportions and no face: an egg on shoulders, with the
 * landmarks supplied instead of read from a picture. It proves what the
 * rigger builds (bones that rest unrotated, the lips cut apart, 52
 * controls that each move the right part of the face the right way)
 * wherever Blender is installed. Finding a face in a picture is the face
 * model's job and is exercised by running the tool on a real scan.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const blender = spawnSync("blender", ["--version"], { encoding: "utf8" });
const hasBlender = blender.status === 0 && /Blender \d/.test(blender.stdout);

interface Gltf {
  nodes: Array<{ name?: string; rotation?: number[]; children?: number[] }>;
  meshes: Array<{ primitives: Array<{ attributes: { POSITION: number }; targets?: Array<{ POSITION?: number }>; material?: number }>; extras?: { targetNames?: string[] } }>;
  materials: Array<{ name: string }>;
  accessors: Array<{ bufferView?: number; byteOffset?: number; count: number; sparse?: { count: number; indices: { bufferView: number; byteOffset?: number; componentType: number }; values: { bufferView: number; byteOffset?: number } } }>;
  bufferViews: Array<{ byteOffset?: number; byteLength: number }>;
}

function openGlb(path: string) {
  const bytes = readFileSync(path);
  const jsonLen = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLen).toString("utf8")) as Gltf;
  const bin = bytes.subarray(20 + jsonLen + 8);
  /** Three floats per vertex, whether the file stored them densely or only where they are not zero. */
  const vec3 = (index: number): Float32Array => {
    const a = gltf.accessors[index];
    const out = new Float32Array(a.count * 3);
    if (a.bufferView !== undefined) {
      const at = (gltf.bufferViews[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0);
      for (let i = 0; i < out.length; i++) out[i] = bin.readFloatLE(at + i * 4);
    }
    if (a.sparse) {
      const ia = (gltf.bufferViews[a.sparse.indices.bufferView].byteOffset ?? 0) + (a.sparse.indices.byteOffset ?? 0);
      const va = (gltf.bufferViews[a.sparse.values.bufferView].byteOffset ?? 0) + (a.sparse.values.byteOffset ?? 0);
      const wide = a.sparse.indices.componentType === 5125 ? 4 : a.sparse.indices.componentType === 5123 ? 2 : 1;
      for (let k = 0; k < a.sparse.count; k++) {
        const i = wide === 4 ? bin.readUInt32LE(ia + k * 4) : wide === 2 ? bin.readUInt16LE(ia + k * 2) : bin.readUInt8(ia + k);
        for (let c = 0; c < 3; c++) out[i * 3 + c] = bin.readFloatLE(va + (k * 3 + c) * 4);
      }
    }
    return out;
  };
  return { gltf, vec3 };
}

describe("rigging a scan", () => {
  it.skipIf(!hasBlender)("turns a statue into a character that meets the contract, each control moving the right part the right way", () => {
    const dir = mkdtempSync(join(tmpdir(), "rig-scan-"));
    const scan = join(dir, "scan.glb");
    const points = join(dir, "points.json");
    const out = join(dir, "out.glb");
    execFileSync("blender", ["-b", "-P", join(repo, "tools", "avatar", "rig", "make-test-scan.py"), "--", "--out", scan, "--points", points], { encoding: "utf8", stdio: "pipe" });
    // The statue alone fails every rig line: that is the starting point.
    const statue = checkGlb(new Uint8Array(readFileSync(scan)));
    expect(statue.pass).toBe(false);
    expect(statue.lines.map((l) => l.text).join("\n")).toContain("no morph targets on any mesh");

    const log = execFileSync(
      "blender",
      ["-b", "--python", join(repo, "tools", "avatar", "rig", "rig_scan.py"), "--", "--step", "build", "--in", scan, "--points", points, "--out", out, "--triangles", "40000", "--rest-smile", "0.7"],
      { encoding: "utf8", stdio: "pipe" },
    );
    expect(log).toMatch(/joined loose triangles at their seams/);
    expect(log).toMatch(/after: [\d,]+ triangles on the face, [\d,]+ elsewhere/);
    expect(log).toMatch(/lips cut apart along \d+ edges/);
    expect(log).toMatch(/the scan was smiling \(the face reader scored it 0\.70\); 0\.50 of a smile taken out of the resting face/);
    expect(log).toMatch(/52 controls built/);

    const report = checkGlb(new Uint8Array(readFileSync(out)));
    expect(report.lines.filter((l) => l.level === "fail").map((l) => l.text)).toEqual([]);
    expect(report.pass).toBe(true);
    expect(report.facts.triangles).toBeGreaterThanOrEqual(30_000);
    expect(report.facts.triangles).toBeLessThanOrEqual(42_000);
    expect([...report.facts.targets].sort()).toEqual([...ARKIT].sort());

    const { gltf, vec3 } = openGlb(out);
    // The engine sets the head's and the eyes' rotation outright, so they must rest with none of their own.
    for (const name of ["Head", "LeftEye", "RightEye", "Neck"]) {
      const node = gltf.nodes.find((n) => n.name === name)!;
      const r = node.rotation ?? [0, 0, 0, 1];
      expect(Math.abs(r[0]) + Math.abs(r[1]) + Math.abs(r[2]), name).toBeLessThan(1e-5);
    }
    const head = gltf.nodes.find((n) => n.name === "Head")!;
    expect((head.children ?? []).map((i) => gltf.nodes[i].name).sort()).toEqual(["LeftEye", "RightEye"]);
    // Skin, the dark inside of the mouth, teeth and a tongue.
    expect(gltf.materials.map((m) => m.name)).toEqual(expect.arrayContaining(["MouthInside", "Teeth", "Tongue"]));

    // What each control does to the skin (the first primitive), in the file's own axes:
    // x towards the person's left, y up, z out of the face.
    const mesh = gltf.meshes[0];
    const skin = mesh.primitives[0];
    const rest = vec3(skin.attributes.POSITION);
    const names = mesh.extras!.targetNames!;
    let front = -Infinity;
    for (let i = 2; i < rest.length; i += 3) front = Math.max(front, rest[i]);
    const moved = (name: string, where: (z: number) => boolean = () => true) => {
      const d = vec3(skin.targets![names.indexOf(name)].POSITION!);
      let n = 0, x = 0, dx = 0, dy = 0, dz = 0, left = 0, right = 0;
      for (let i = 0; i < d.length / 3; i++) {
        const len = Math.hypot(d[i * 3], d[i * 3 + 1], d[i * 3 + 2]);
        if (len < 1e-5 || !where(rest[i * 3 + 2])) continue;
        n++;
        x += rest[i * 3];
        dx += d[i * 3];
        dy += d[i * 3 + 1];
        dz += d[i * 3 + 2];
        if (rest[i * 3] > 0.004) left++;
        if (rest[i * 3] < -0.004) right++;
      }
      return { n, x: x / n, dx: dx / n, dy: dy / n, dz: dz / n, left, right };
    };
    const jaw = moved("jawOpen");
    expect(jaw.n).toBeGreaterThan(500);
    expect(jaw.dz).toBeLessThan(0); // the jaw swings back, as a hinge takes it
    expect(Math.abs(jaw.x)).toBeLessThan(0.004); // evenly on both sides
    // The chin, at the front of the face, goes down. (Under the ears the same swing lifts the jaw's corner a little.)
    const chin = moved("jawOpen", (z) => z > front * 0.6);
    expect(chin.n).toBeGreaterThan(200);
    expect(chin.dy).toBeLessThan(-0.0005);

    // Left is the person's left, and stays on its side.
    for (const [name, up] of [["eyeBlinkLeft", false], ["mouthSmileLeft", true], ["browOuterUpLeft", true], ["browDownLeft", false]] as const) {
      const m = moved(name);
      expect(m.left, name).toBeGreaterThan(20);
      expect(m.right, `${name} reaches the wrong side`).toBeLessThan(m.left * 0.25);
      if (up) expect(m.dy, name).toBeGreaterThan(0);
      else expect(m.dy, name).toBeLessThan(0);
    }
    const blinkR = moved("eyeBlinkRight");
    expect(blinkR.right).toBeGreaterThan(20);
    expect(blinkR.left).toBe(0);
    expect(moved("eyeBlinkLeft").right).toBe(0);
    expect(moved("mouthSmileLeft").dx).toBeGreaterThan(0); // the corner goes out, towards that side
    expect(moved("mouthSmileRight").dx).toBeLessThan(0);
    expect(moved("browInnerUp").dy).toBeGreaterThan(0);
    expect(moved("mouthPucker").dz).toBeGreaterThan(0); // lips forward
    expect(moved("jawLeft").dx).toBeGreaterThan(0);
    expect(moved("jawRight").dx).toBeLessThan(0);

    // The lips were cut: on the mouth's own line there are points that follow the jaw fully and points that do not at all.
    const jawD = vec3(skin.targets![names.indexOf("jawOpen")].POSITION!);
    const closeD = vec3(skin.targets![names.indexOf("mouthClose")].POSITION!);
    let undone = 0;
    for (let i = 0; i < jawD.length / 3; i++) {
      const j = Math.hypot(jawD[i * 3], jawD[i * 3 + 1], jawD[i * 3 + 2]);
      const both = Math.hypot(jawD[i * 3] + closeD[i * 3], jawD[i * 3 + 1] + closeD[i * 3 + 1], jawD[i * 3 + 2] + closeD[i * 3 + 2]);
      if (j > 0.004 && both < 1e-5) undone++;
    }
    // mouthClose with the jaw open brings the lower lip's edge exactly back to the upper one.
    expect(undone).toBeGreaterThan(20);
  }, 300_000);

  it.skipIf(hasBlender)("is skipped here: Blender is not installed (run it where it is)", () => {
    expect(hasBlender).toBe(false);
  });
});

describe("what the engine needs from a boned head", () => {
  it("frames a head that is a bone by the skin that follows it, not by the whole figure", () => {
    // A tall figure: a body from 0 to 1, a head from 1 to 1.3, skinned to two bones.
    const geometry = new THREE.BufferGeometry();
    const pos: number[] = [];
    const idx: number[] = [];
    const wts: number[] = [];
    for (let i = 0; i < 40; i++) {
      const y = (i / 39) * 1.3;
      pos.push(i % 2 ? 0.1 : -0.1, y, i % 3 ? 0.1 : -0.1);
      const onHead = y >= 1 ? 1 : 0;
      idx.push(0, 1, 0, 0);
      wts.push(1 - onHead, onHead, 0, 0);
    }
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(idx, 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(wts, 4));
    const hips = new THREE.Bone();
    const head = new THREE.Bone();
    head.name = "Head";
    head.position.y = 1;
    hips.add(head);
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    const root = new THREE.Group();
    root.add(hips, mesh);
    root.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton([hips, head]));

    // A bone has no geometry: measured the old way, its box is empty.
    expect(new THREE.Box3().setFromObject(head).isEmpty()).toBe(true);
    const box = headBox(root, head);
    expect(box.min.y).toBeGreaterThanOrEqual(1);
    expect(box.max.y).toBeCloseTo(1.3, 5);
    // No head at all: the whole figure.
    expect(headBox(root, null).min.y).toBeCloseTo(0, 5);
    // A head with a mesh of its own is measured by that mesh.
    const lump = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2));
    const node = new THREE.Group();
    node.position.y = 5;
    node.add(lump);
    root.add(node);
    root.updateMatrixWorld(true);
    expect(headBox(root, node).min.y).toBeCloseTo(4.9, 5);
  });

  it("never closes the lips further than the jaw is open", () => {
    // The "p" of the lip-sync table: lips shut on a jaw that is nearly shut.
    expect(settleMouth({ mouthClose: 0.9, mouthPressLeft: 0.5, jawOpen: 0.05 })).toEqual({ mouthClose: 0.05, mouthPressLeft: 0.5, jawOpen: 0.05 });
    expect(settleMouth({ mouthClose: 0.3, jawOpen: 0.6 })).toEqual({ mouthClose: 0.3, jawOpen: 0.6 });
    expect(settleMouth({ mouthClose: 0.4 })).toEqual({ mouthClose: 0 });
    expect(settleMouth({ jawOpen: 0.5 })).toEqual({ jawOpen: 0.5 });
  });
});
