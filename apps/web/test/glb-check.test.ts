import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ARKIT, VISEMES, checkGlb, formatReport } from "../app/studio/check";
import { plan, standInVoice, syllables } from "../app/studio/voice";
import { buildGlb } from "./helpers/glb";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");

/** A character that meets the whole contract. */
const good = () => buildGlb({ segments: 180, targets: [...ARKIT], texturePx: [2048], height: 0.5 });

const failing = (bytes: Uint8Array, lenient = false) => checkGlb(bytes, { lenient }).lines.filter((l) => l.level === "fail").map((l) => l.text);

describe("the character check", () => {
  it("passes a character that meets the contract, dense or sparse", () => {
    for (const sparse of [false, true]) {
      const report = checkGlb(buildGlb({ segments: 180, targets: [...ARKIT], texturePx: [2048], sparse }));
      expect(report.pass, formatReport(report)).toBe(true);
      expect(report.facts.triangles).toBeGreaterThanOrEqual(30_000);
      expect(report.facts.missingArkit).toEqual([]);
      expect(report.lines.map((l) => l.text)).toContain("all 52 ARKit sliders present, named exactly");
      expect(report.lines.map((l) => l.text)).toContain("every slider really moves vertices");
    }
  });

  it("names a slider that moves nothing, even when it is named correctly", () => {
    for (const sparse of [false, true]) {
      const bytes = buildGlb({ segments: 180, targets: [...ARKIT], dead: ["mouthPucker", "eyeBlinkLeft"], texturePx: [1024], sparse });
      const fails = failing(bytes);
      expect(fails.some((t) => t.includes("mouthPucker (moves nothing)") && t.includes("eyeBlinkLeft (moves nothing)"))).toBe(true);
    }
  });

  it("names the essential sliders that are missing", () => {
    const names = ARKIT.filter((n) => n !== "jawOpen" && n !== "mouthSmileLeft");
    const fails = failing(buildGlb({ segments: 180, targets: names, texturePx: [1024] }));
    expect(fails.some((t) => t.startsWith("essential sliders missing: jawOpen, mouthSmileLeft"))).toBe(true);
  });

  it("names the bones that are missing, and eyes not under the head", () => {
    const fails = failing(buildGlb({ segments: 180, targets: [...ARKIT], nodes: ["Head", "LeftEye", "RightEye"], texturePx: [1024] }));
    expect(fails.some((t) => t.startsWith("missing nodes: Hips, Spine, Neck"))).toBe(true);
    const loose = failing(buildGlb({ segments: 180, targets: [...ARKIT], eyesUnderHead: false, texturePx: [1024] }));
    expect(loose.some((t) => t.includes("eyes are children of Head"))).toBe(true);
  });

  it("holds the budgets, strictly or as warnings for work in progress", () => {
    const small = buildGlb({ segments: 24, targets: [...ARKIT], texturePx: [4096], height: 180 });
    const strict = failing(small);
    expect(strict.some((t) => /triangles \(30,000 to 60,000\)/.test(t))).toBe(true);
    expect(strict.some((t) => t.startsWith("largest texture 4096 px"))).toBe(true);
    const lenient = checkGlb(small, { lenient: true });
    expect(lenient.pass).toBe(true);
    expect(lenient.lines.filter((l) => l.level === "warn").map((l) => l.text).join("\n")).toMatch(/triangles[\s\S]*4096 px[\s\S]*looks like centimetres/);
  });

  it("refuses textures kept as separate files, and says how to fix it", () => {
    const fails = failing(buildGlb({ segments: 180, targets: [...ARKIT], externalTexture: "skin.png" }));
    expect(fails).toContain("textures referenced as separate files: skin.png (embed them)");
  });

  it("explains a file that is not a character at all", () => {
    expect(failing(new TextEncoder().encode("hello"))[0]).toMatch(/not a glTF binary/);
    expect(failing(buildGlb({ corruptLength: true })).some((t) => t.includes("cut short or corrupted"))).toBe(true);
    expect(failing(buildGlb({ segments: 180, targets: [] })).some((t) => t.startsWith("no morph targets on any mesh"))).toBe(true);
  });

  it("counts visemes under any of the three spellings", () => {
    const names = [...ARKIT, ...VISEMES.slice(0, 5).map((v) => `viseme_${v}`), ...VISEMES.slice(5, 10).map((v) => `v_${v}`), ...VISEMES.slice(10)];
    const report = checkGlb(buildGlb({ segments: 180, targets: names, texturePx: [1024] }));
    expect(report.facts.visemes).toBe(15);
    expect(report.lines.map((l) => l.text)).toContain("all 15 visemes present as well");
  });

  it("gives the same verdict on the committed test head as the command line does", () => {
    const bytes = new Uint8Array(readFileSync(join(here, "fixtures", "test-head.glb")));
    const report = checkGlb(bytes, { lenient: true });
    expect(report.pass).toBe(true);
    const cli = execFileSync(process.execPath, [join(repo, "tools", "avatar", "validate-glb.ts"), join(here, "fixtures", "test-head.glb"), "--lenient"], {
      encoding: "utf8",
    });
    expect(cli).toContain(formatReport(report));
  });

  it("fails on the command line for a file that fails here", () => {
    let code = 0;
    try {
      execFileSync(process.execPath, [join(repo, "tools", "avatar", "validate-glb.ts"), join(here, "fixtures", "test-head.glb")], { encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      code = (e as { status: number }).status;
    }
    expect(code).toBe(1);
  });
});

describe("the stand-in voice", () => {
  it("counts syllables well enough to time a line", () => {
    expect(syllables("hello")).toBe(2);
    expect(syllables("strength")).toBe(1);
    expect(syllables("together")).toBe(3);
  });

  it("pauses at punctuation and runs about as long as the words", () => {
    expect(plan("Hi now, friend.")).toEqual(["syllable", "syllable", "pause", "syllable", "pause"]);
    expect(plan("together")).toEqual(["syllable", "syllable", "syllable"]);
    const short = standInVoice("Hi.");
    const long = standInVoice("Hello! I'm so glad you came today. Shall we look at that problem together?");
    expect(long.duration).toBeGreaterThan(short.duration * 4);
    expect(long.duration).toBeLessThan(8);
    expect(long.samples.length).toBe(Math.ceil(long.duration * long.sampleRate));
  });

  it("is sound, not silence, and never clips", () => {
    const v = standInVoice("Shall we try again?");
    let peak = 0;
    let energy = 0;
    for (const s of v.samples) {
      peak = Math.max(peak, Math.abs(s));
      energy += s * s;
    }
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThanOrEqual(1);
    expect(energy / v.samples.length).toBeGreaterThan(0.001);
  });
});
