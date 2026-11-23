import { describe, expect, it } from "vitest";
import { HAIR_COLORS, HAIR_STYLES, SKIN_TONES, isHairColor, isHairStyle, isSkinTone } from "../app/learn/face-appearance";
import { visemeFromLevel } from "../app/learn/face-logic";

describe("tutor appearance vocabulary", () => {
  it("spans a global range of skin tones, each a complete shade set", () => {
    expect(Object.keys(SKIN_TONES).length).toBeGreaterThanOrEqual(8);
    for (const t of Object.values(SKIN_TONES)) {
      expect(t.skin).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.shade).toMatch(/^#[0-9a-f]{6}$/i);
      expect(t.light).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("offers many hair styles and colours, including textured and covered", () => {
    for (const s of ["coily", "curls", "locs", "straight", "hijab", "turban"]) {
      expect(HAIR_STYLES).toContain(s);
    }
    expect(Object.keys(HAIR_COLORS).length).toBeGreaterThanOrEqual(10);
  });

  it("validates keys and rejects anything unknown", () => {
    expect(isSkinTone("brown")).toBe(true);
    expect(isSkinTone("chartreuse")).toBe(false);
    expect(isSkinTone(null)).toBe(false);
    expect(isHairStyle("locs")).toBe(true);
    expect(isHairStyle("mohawk")).toBe(false);
    expect(isHairColor("violet")).toBe(true);
    expect(isHairColor("#fff")).toBe(false);
  });
});

describe("viseme seam for a future photoreal driver", () => {
  it("maps loudness to a coarse mouth shape, monotonically opening", () => {
    expect(visemeFromLevel(0)).toBe("rest");
    expect(visemeFromLevel(0.1)).toBe("slight");
    expect(visemeFromLevel(0.35)).toBe("open");
    expect(visemeFromLevel(0.8)).toBe("wide");
    const order = ["rest", "slight", "open", "wide"];
    let prev = -1;
    for (let l = 0; l <= 1; l += 0.05) {
      const idx = order.indexOf(visemeFromLevel(l));
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
  });
});
