import { describe, expect, it } from "vitest";
import { canAnalyse, canCaptureVoice, hasWebAudio, pickRecordingFormat, resolveAudioContextCtor } from "../app/learn/audio";

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

describe("voice capture: never offer what the browser cannot do", () => {
  const rec = function () {} as unknown as typeof MediaRecorder;
  const mic = { mediaDevices: { getUserMedia: () => {} } };

  it("needs BOTH a microphone and a recorder", () => {
    expect(canCaptureVoice({ MediaRecorder: rec, navigator: mic })).toBe(true);
    // Some in-app browsers and older Safari open a microphone but have no
    // recorder: asking a child for their microphone then failing is worse
    // than not offering.
    expect(canCaptureVoice({ navigator: mic })).toBe(false);
    expect(canCaptureVoice({ MediaRecorder: rec, navigator: {} })).toBe(false);
    expect(canCaptureVoice({})).toBe(false);
    expect(canCaptureVoice(undefined)).toBe(false);
  });

  it("picks the first format the browser admits to, iPhone included", () => {
    // Chrome and Firefox: webm/opus.
    expect(pickRecordingFormat((t) => t.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus");
    // iOS Safari: mp4 only.
    expect(pickRecordingFormat((t) => t === "audio/mp4")).toBe("audio/mp4");
    // A browser that admits to nothing, and one with no opinion at all.
    expect(pickRecordingFormat(() => false)).toBe("");
    expect(pickRecordingFormat(undefined)).toBe("");
  });
});
