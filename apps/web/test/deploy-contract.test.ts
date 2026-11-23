import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The web app's deploy contract. Each of these once broke, or would break,
 * silently: the site still loads, and a family just finds something missing.
 * Pinned here so CI catches it instead of a parent.
 */
const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const dockerfile = readFileSync(join(web, "Dockerfile"), "utf8");
const pkg = JSON.parse(readFileSync(join(web, "package.json"), "utf8")) as { scripts: Record<string, string> };

describe("the web deploy contract", () => {
  it("ships the public folder: manifest, service worker, icons and face model", () => {
    // Missing for months: the live site served no manifest, no service worker
    // (no offline shell, no push reminders) and no icons.
    expect(dockerfile).toMatch(/COPY --from=build \/repo\/apps\/web\/public \.\/apps\/web\/public/);
    expect(dockerfile).toMatch(/COPY --from=build \/repo\/apps\/web\/\.next\/static \.\/apps\/web\/\.next\/static/);
    for (const f of ["manifest.json", "sw.js", "icon-192.png", "icon-512.png"]) {
      expect(existsSync(join(web, "public", f)), f).toBe(true);
    }
  });

  it("prepares the face reader before every build, from our own site", () => {
    expect(pkg.scripts.build).toMatch(/^node scripts\/face-assets\.mjs && next build$/);
    expect(existsSync(join(web, "scripts", "face-assets.mjs"))).toBe(true);
  });

  it("carries the exact face model it was checked with", () => {
    const model = readFileSync(join(web, "public", "face", "face_landmarker.task"));
    const script = readFileSync(join(web, "scripts", "face-assets.mjs"), "utf8");
    const pinned = script.match(/MODEL_SHA256 = "([0-9a-f]{64})"/)?.[1];
    expect(pinned).toBeDefined();
    expect(createHash("sha256").update(model).digest("hex")).toBe(pinned);
  });
});
