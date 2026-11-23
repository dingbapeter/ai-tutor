import { describe, expect, it } from "vitest";
import {
  blinkToArkit,
  compose,
  gazeToArkit,
  hasVisemeSliders,
  moodToArkit,
  mouthWeights,
  resolveSlider,
} from "../app/learn/avatar/blendshapes";

describe("from what the face should do to what the model can do", () => {
  it("finds a slider by meaning, whatever the artist's tool called it", () => {
    const names = ["Jaw_Open", "blendShape1.mouthSmileLeft", "CC_Base.MouthSmile_R", "EyeBlink_L", "v_aa", "vrc.v_oh", "viseme_PP"];
    expect(resolveSlider(names, "jawOpen")).toBe(0);
    expect(resolveSlider(names, "mouthSmileLeft")).toBe(1);
    expect(resolveSlider(names, "mouthSmileRight")).toBe(2);
    expect(resolveSlider(names, "eyeBlinkLeft")).toBe(3);
    expect(resolveSlider(names, "viseme_aa")).toBe(4);
    expect(resolveSlider(names, "viseme_oh")).toBe(5);
    expect(resolveSlider(names, "viseme_PP")).toBe(6);
    // Missing is a clear -1, never a wrong slider.
    expect(resolveSlider(names, "tongueOut")).toBe(-1);
  });

  it("knows whether a model brought its own mouth shapes", () => {
    expect(hasVisemeSliders(["viseme_aa", "viseme_oh", "viseme_PP", "viseme_sil"])).toBe(true);
    expect(hasVisemeSliders(["v_aa", "v_oh", "v_PP"])).toBe(true);
    expect(hasVisemeSliders(["jawOpen", "mouthFunnel"])).toBe(false);
  });

  it("blends the mouth through ARKit shapes when there are no viseme sliders", () => {
    const mid = mouthWeights("PP", "aa", 0.5, 1, false);
    // Halfway from closed lips to open jaw: some of each, neither at full.
    expect(mid.mouthClose).toBeCloseTo(0.45, 5);
    expect(mid.jawOpen).toBeCloseTo(0.05 * 0.5 + 0.75 * 0.5, 5);
    // Silence is silence: nothing to blend into.
    expect(mouthWeights("sil", "sil", 0.5, 1, false)).toEqual({});
    // No loudness means no shape, whatever the plan says.
    expect(Object.values(mouthWeights("aa", "oh", 0.3, 0, false)).every((v) => v === 0)).toBe(true);
  });

  it("uses the model's own viseme sliders when it has them", () => {
    const w = mouthWeights("aa", "oh", 0.25, 0.8, true);
    expect(w.viseme_aa).toBeCloseTo(0.6, 5);
    expect(w.viseme_oh).toBeCloseTo(0.2, 5);
    expect(w.jawOpen).toBeUndefined();
  });

  it("wears a mood on its face, scaled by how strongly", () => {
    expect(moodToArkit("joy").mouthSmileLeft).toBeGreaterThan(moodToArkit("warm").mouthSmileLeft!);
    expect(moodToArkit("concern").browInnerUp).toBeGreaterThan(0.5);
    expect(moodToArkit("focus").browDownLeft).toBeGreaterThan(0);
    expect(moodToArkit("neutral")).toEqual({});
    expect(moodToArkit("joy", 0.5).mouthSmileLeft).toBeCloseTo(0.375, 5);
    expect(moodToArkit("joy", 7).mouthSmileLeft).toBeCloseTo(0.75, 5); // clamped
  });

  it("blinks both eyes together and looks where it is told", () => {
    expect(blinkToArkit(1)).toEqual({ eyeBlinkLeft: 1, eyeBlinkRight: 1 });
    expect(blinkToArkit(-3)).toEqual({ eyeBlinkLeft: 0, eyeBlinkRight: 0 });
    // Looking to their right: left eye turns in, right eye turns out.
    const right = gazeToArkit(0.6, 0);
    expect(right.eyeLookInLeft).toBeCloseTo(0.6, 5);
    expect(right.eyeLookOutRight).toBeCloseTo(0.6, 5);
    expect(right.eyeLookOutLeft).toBeUndefined();
    const up = gazeToArkit(0, 1);
    expect(up.eyeLookUpLeft).toBe(1);
    expect(up.eyeLookUpRight).toBe(1);
  });

  it("layers add up and never exceed the slider's range", () => {
    const w = compose({ jawOpen: 0.7 }, { jawOpen: 0.6, mouthSmileLeft: 0.3 }, { mouthSmileLeft: -1 });
    expect(w.jawOpen).toBe(1);
    expect(w.mouthSmileLeft).toBe(0);
  });
});
