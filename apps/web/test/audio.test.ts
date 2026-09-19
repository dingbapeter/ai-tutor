import { describe, expect, it } from "vitest";
import { canAnalyse, hasWebAudio, resolveAudioContextCtor } from "../app/learn/audio";

/**
 * These rules are what keep iPhones working. Safari starts every audio
 * engine asleep and older versions only expose the webkit spelling; both
 * broke real behaviour before, so both are pinned here.
 */
describe("iPhone-safe audio rules", () => {
  const Fake = function () {} as unknown as new () => AudioContext;

  it("finds the engine under either spelling", () => {
    expect(resolveAudioContextCtor({ AudioContext: Fake })).toBe(Fake);
    // Older Safari / in-app browsers: only the webkit name exists.
    expect(resolveAudioContextCtor({ webkitAudioContext: Fake })).toBe(Fake);
    expect(resolveAudioContextCtor({})).toBeNull();
    expect(resolveAudioContextCtor(undefined)).toBeNull();
  });

  it("reports Web Audio support from either spelling, so the hands-free button shows on iPhones", () => {
    expect(hasWebAudio({ webkitAudioContext: Fake })).toBe(true);
    expect(hasWebAudio({ AudioContext: Fake })).toBe(true);
    expect(hasWebAudio({})).toBe(false);
  });

  it("only analyses a RUNNING engine, because routing through a sleeping one silences the tutor", () => {
    expect(canAnalyse({ state: "running" })).toBe(true);
    expect(canAnalyse({ state: "suspended" })).toBe(false);
    expect(canAnalyse({ state: "closed" })).toBe(false);
    expect(canAnalyse(null)).toBe(false);
    expect(canAnalyse(undefined)).toBe(false);
  });
});
