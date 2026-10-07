import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ARKIT } from "../app/studio/check";
import { buildGlb } from "./helpers/glb";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const tool = join(repo, "tools", "avatar", "install-character.ts");

/** A throwaway checkout with just the pieces the tool touches. */
function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), "install-"));
  mkdirSync(join(dir, "config"), { recursive: true });
  mkdirSync(join(dir, "apps", "web", "public"), { recursive: true });
  cpSync(join(repo, "config", "personas.json"), join(dir, "config", "personas.json"));
  return dir;
}

describe("putting a character live", () => {
  it("refuses a file that fails the contract, and changes nothing", () => {
    const dir = scratchRepo();
    const bad = join(dir, "bad.glb");
    writeFileSync(bad, buildGlb({ segments: 24, targets: ARKIT.slice(5) }));
    const before = readFileSync(join(dir, "config", "personas.json"), "utf8");
    const run = spawnSync(process.execPath, [tool, "amara", bad, "--repo", dir], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("not installed: fix the lines marked FAIL first");
    expect(existsSync(join(dir, "apps", "web", "public", "tutors", "amara.glb"))).toBe(false);
    expect(readFileSync(join(dir, "config", "personas.json"), "utf8")).toBe(before);
  });

  it("installs a passing file and names it on the persona", () => {
    const dir = scratchRepo();
    const good = join(dir, "amara-final.glb");
    writeFileSync(good, buildGlb({ segments: 180, targets: [...ARKIT], texturePx: [2048], sparse: true }));
    const out = execFileSync(process.execPath, [tool, "amara", good, "--repo", dir], { encoding: "utf8" });
    expect(out).toContain("installed apps/web/public/tutors/amara.glb");
    expect(out).toContain('Amara now carries model "/tutors/amara.glb"');
    expect(readFileSync(join(dir, "apps", "web", "public", "tutors", "amara.glb")).equals(readFileSync(good))).toBe(true);
    const personas = JSON.parse(readFileSync(join(dir, "config", "personas.json"), "utf8")) as { personas: Array<{ id: string; model?: string }> };
    expect(personas.personas.find((p) => p.id === "amara")?.model).toBe("/tutors/amara.glb");
    expect(personas.personas.find((p) => p.id === "kofi")?.model).toBeUndefined();
  });

  it("refuses an unknown tutor", () => {
    const dir = scratchRepo();
    const run = spawnSync(process.execPath, [tool, "nobody", join(dir, "x.glb"), "--repo", dir], { encoding: "utf8" });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('no persona "nobody"');
  });
});
