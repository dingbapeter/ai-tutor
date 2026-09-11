import { describe, expect, it } from "vitest";
import { approach, bondStage, expressionFor, moodFromText } from "../app/learn/face-logic";

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
