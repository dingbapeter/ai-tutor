import { describe, expect, it } from "vitest";
import { RTL_LANGUAGES, directionFor, isRtl } from "../app/learn/rtl";

/**
 * Six of the 91 teaching languages are written right to left. A child
 * reading their own language must not have it rendered sideways.
 */
describe("writing direction", () => {
  it("knows the right-to-left languages Dingba teaches", () => {
    expect([...RTL_LANGUAGES].sort()).toEqual(["ar", "fa", "he", "ku", "ps", "ur"]);
    for (const code of RTL_LANGUAGES) expect(isRtl(code)).toBe(true);
  });

  it("leaves every other language alone", () => {
    for (const code of ["en", "fr", "yo", "ig", "ha", "sw", "zh", "hi", "es"]) {
      expect(directionFor(code)).toBe("ltr");
    }
  });

  it("reads regional tags and odd casing, and never guesses without one", () => {
    expect(directionFor("ar-EG")).toBe("rtl");
    expect(directionFor("AR")).toBe("rtl");
    expect(directionFor("ur_PK")).toBe("rtl");
    expect(directionFor("")).toBe("ltr");
    expect(directionFor(null)).toBe("ltr");
    expect(directionFor(undefined)).toBe("ltr");
    // "arn" (Mapudungun) starts with "ar" but is not right to left.
    expect(directionFor("arn")).toBe("ltr");
  });
});
