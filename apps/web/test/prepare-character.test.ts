import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkGlb } from "../app/studio/check";

/**
 * The preparation pipeline, through real headless Blender: a stand-in for
 * an Unreal export (lower levels of detail, a whole body, MetaHuman bone
 * names, Unreal slider names, an oversize texture, centimetres) becomes a
 * file that passes the rig checks. Runs wherever Blender is installed and
 * says so where it is not; CI has no Blender, the founder's machine does.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const blender = spawnSync("blender", ["--version"], { encoding: "utf8" });
const hasBlender = blender.status === 0 && /Blender \d/.test(blender.stdout);

describe("preparing a raw export", () => {
  it.skipIf(!hasBlender)("turns a stand-in Unreal export into a file that passes the rig checks", () => {
    const dir = mkdtempSync(join(tmpdir(), "prepare-"));
    const fbx = join(dir, "fake-unreal.fbx");
    const glb = join(dir, "out.glb");
    execFileSync("blender", ["-b", "-P", join(repo, "tools", "avatar", "make-fake-export.py"), "--", "--out", fbx], { encoding: "utf8", stdio: "pipe" });
    expect(existsSync(fbx)).toBe(true);
    const log = execFileSync("blender", ["-b", "-P", join(repo, "tools", "avatar", "prepare-character.py"), "--", "--in", fbx, "--out", glb], {
      encoding: "utf8",
      stdio: "pipe",
    });
    expect(log).toMatch(/dropped 4 lower level-of-detail object/);
    expect(log).toMatch(/treating as centimetres, scaling to metres/);
    expect(log).toMatch(/pelvis → Hips, spine_01 → Spine, neck_01 → Neck, head → Head, FACIAL_L_Eye → LeftEye, FACIAL_R_Eye → RightEye/);
    expect(log).toMatch(/cut 1 body mesh\(es\) to a bust below spine_03/);
    expect(log).toMatch(/sliders: 27 found, 27 renamed to the exact ARKit name, 0 unknown/);
    expect(log).toMatch(/textures: 1 shrunk to 2048 px or under/);

    const report = checkGlb(new Uint8Array(readFileSync(glb)), { lenient: true });
    const lines = report.lines.map((l) => `${l.level} ${l.text}`);
    expect(lines).toContain("ok skeleton and eye nodes present (Hips, Spine, Neck, Head, LeftEye, RightEye)");
    expect(lines).toContain("ok eyes are children of Head, so gaze moves with the head");
    expect(lines).toContain("ok every slider really moves vertices");
    expect(lines.some((l) => /^ok skinned/.test(l))).toBe(true);
    expect(lines.some((l) => /^ok largest texture 2048 px/.test(l))).toBe(true);
    expect(lines.some((l) => /^ok size .* metres: a bust at human scale/.test(l))).toBe(true);
    expect(report.pass).toBe(true);
  });

  it.skipIf(hasBlender)("is skipped here: Blender is not installed (run it where it is)", () => {
    expect(hasBlender).toBe(false);
  });
});
