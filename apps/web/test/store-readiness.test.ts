import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The web app must stay installable and store-wrappable: Google Play's
 * Trusted Web Activity path and both app shells read these files. A
 * regression here silently breaks store listings.
 */
const pub = join(__dirname, "../public");

describe("store readiness", () => {
  it("manifest carries what Play and the app shells require", () => {
    const m = JSON.parse(readFileSync(join(pub, "manifest.json"), "utf8"));
    for (const key of ["name", "short_name", "description", "start_url", "display", "id", "scope", "theme_color", "background_color", "icons"]) {
      expect(m, key).toHaveProperty(key);
    }
    expect(m.display).toBe("standalone");
    // A 512px maskable icon is a hard requirement for Play.
    const big = (m.icons as Array<{ sizes: string; purpose?: string }>).find((i) => i.sizes === "512x512");
    expect(big?.purpose ?? "").toContain("maskable");
    for (const icon of m.icons as Array<{ src: string }>) {
      expect(() => readFileSync(join(pub, icon.src))).not.toThrow();
    }
  });

  it("the Play ownership proof is valid JSON for the app id, awaiting the real fingerprint", () => {
    const links = JSON.parse(readFileSync(join(pub, ".well-known/assetlinks.json"), "utf8"));
    expect(links[0].target.package_name).toBe("ai.dingba.app");
    expect(links[0].relation).toContain("delegate_permission/common.handle_all_urls");
    expect(Array.isArray(links[0].target.sha256_cert_fingerprints)).toBe(true);
  });

  it("the app shell points at the live site under the same permanent app id", () => {
    const cfg = readFileSync(join(__dirname, "../../mobile/capacitor.config.ts"), "utf8");
    expect(cfg).toContain('appId: "ai.dingba.app"');
    expect(cfg).toContain('url: "https://dingba.ai"');
    expect(cfg).toContain("cleartext: false");
  });
});
