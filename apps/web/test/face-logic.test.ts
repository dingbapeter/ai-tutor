import { describe, expect, it } from "vitest";
import {
  approach,
  bondStage,
  expressionFor,
  maturityFromDays,
  moodFromText,
  voiceToneFromEnergy,
} from "../app/learn/face-logic";

describe("living persona: mood from the tutor's words", () => {
  it("reads care above celebration above warmth", () => {
    expect(moodFromText("You sound a bit flat today, is everything alright?")).toBe("concern");
    expect(moodFromText("Well done, you nailed it! 🎉")).toBe("joy");
    expect(moodFromText("Hi Ada, good to see you again.")).toBe("warm");
    expect(moodFromText("What do you think the next step is?")).toBe("focus");
    expect(moodFromText("The capital of France is Paris.")).toBe("neutral");
    expect(moodFromText(null)).toBe("neutral");
  });

  it("a question mark tips a plain line into focus", () => {
    expect(moodFromText("So how many are left?")).toBe("focus");
  });
});

describe("living persona: the bond grows and only grows", () => {
  it("crosses stages at the right session counts", () => {
    expect(bondStage(0)).toEqual({ stage: 0, label: "New friend" });
    expect(bondStage(2).stage).toBe(0);
    expect(bondStage(3).stage).toBe(1);
    expect(bondStage(14).stage).toBe(1);
    expect(bondStage(15).stage).toBe(2);
    expect(bondStage(39).stage).toBe(2);
    expect(bondStage(40).stage).toBe(3);
    expect(bondStage(500).stage).toBe(3);
  });

  it("is monotonic: more sessions never lowers the stage", () => {
    let prev = -1;
    for (let n = 0; n <= 120; n++) {
      const s = bondStage(n).stage;
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });
});

describe("living persona: the tutor grows up alongside the child", () => {
  it("starts young, matures with real days together, and never exceeds 1", () => {
    expect(maturityFromDays(0)).toBe(0);
    expect(maturityFromDays(-5)).toBe(0);
    const oneMonth = maturityFromDays(30);
    const oneYear = maturityFromDays(365);
    const twoYears = maturityFromDays(730);
    expect(oneMonth).toBeGreaterThan(0);
    expect(oneYear).toBeGreaterThan(oneMonth);
    expect(twoYears).toBeGreaterThan(oneYear);
    expect(maturityFromDays(100000)).toBeLessThanOrEqual(1);
  });

  it("is monotonic: more days never makes the tutor look younger", () => {
    let prev = -1;
    for (let d = 0; d <= 2000; d += 25) {
      const m = maturityFromDays(d);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });
});

describe("living persona: hearing how the student feels", () => {
  it("reads a quiet, flat voice as low", () => {
    expect(voiceToneFromEnergy([0.08, 0.07, 0.09, 0.08, 0.07, 0.08, 0.09])).toBe("low");
  });

  it("reads a loud or lively, varied voice as bright", () => {
    expect(voiceToneFromEnergy([0.05, 0.4, 0.1, 0.45, 0.08, 0.5, 0.12])).toBe("bright");
    expect(voiceToneFromEnergy([0.3, 0.32, 0.31, 0.33, 0.3, 0.34])).toBe("bright");
  });

  it("stays neutral in between, and when there's too little to judge", () => {
    expect(voiceToneFromEnergy([0.18, 0.2, 0.16, 0.19, 0.17, 0.2])).toBe("neutral");
    expect(voiceToneFromEnergy([0.5, 0.5])).toBe("neutral"); // too few voiced samples
    expect(voiceToneFromEnergy([])).toBe("neutral");
    // silence (below the voiced threshold) is not a judgement
    expect(voiceToneFromEnergy([0.001, 0.002, 0.0, 0.001, 0.0, 0.001])).toBe("neutral");
  });
});

describe("living persona: expressions and smoothing", () => {
  it("joy grins and lifts brows; concern furrows and frowns", () => {
    expect(expressionFor("joy").curve).toBeGreaterThan(0.5);
    expect(expressionFor("joy").brow).toBeGreaterThan(0.5);
    expect(expressionFor("concern").curve).toBeLessThan(0);
    expect(expressionFor("concern").brow).toBeLessThan(0);
  });

  it("approach moves toward the target and is frame-rate independent", () => {
    // One big step and two half-steps of the same total time land close.
    const oneStep = approach(0, 1, 32);
    const half = approach(approach(0, 1, 16), 1, 16);
    expect(Math.abs(oneStep - half)).toBeLessThan(0.05);
    // Never overshoots.
    expect(approach(0, 1, 1000)).toBeLessThanOrEqual(1);
    expect(approach(0.5, 0.5, 16)).toBeCloseTo(0.5, 5);
  });
});
