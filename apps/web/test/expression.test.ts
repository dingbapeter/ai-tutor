import { describe, expect, it } from "vitest";
import {
  HOLD_MS,
  REPEAT_AFTER_MS,
  headTurn,
  hintToSend,
  labelFrame,
  prune,
  steadyLabel,
  type Label,
  type Sample,
} from "../app/learn/face/expression";

const face = (scores: Record<string, number> = {}, turn = 0) => ({ present: true, scores, turn });

/** A steady stream of one label, sampled four times a second, ending at `end`. */
function stream(label: Label, ms: number, end: number, every = 250): Sample[] {
  const out: Sample[] = [];
  for (let t = end - ms; t <= end; t += every) out.push({ at: t, label });
  return out;
}

describe("reading a face into one plain word", () => {
  it("knows where the head is pointing from three points, at any distance", () => {
    expect(headTurn({ x: 0.5 }, { x: 0.3 }, { x: 0.7 })).toBeCloseTo(0, 5);   // facing
    expect(headTurn({ x: 0.66 }, { x: 0.3 }, { x: 0.7 })).toBeCloseTo(0.8, 5); // turned well aside
    // Twice as far from the camera, same pose, same answer.
    expect(headTurn({ x: 0.55 }, { x: 0.45 }, { x: 0.65 })).toBeCloseTo(0, 5);
    expect(headTurn({ x: 0.5 }, { x: 0.5 }, { x: 0.5 })).toBe(1);             // cheeks collapsed: side on
  });

  it("labels one frame by what is visible", () => {
    expect(labelFrame({ present: false, scores: {}, turn: 0 })).toBe("away");
    expect(labelFrame(face({}, 0.8))).toBe("away");
    expect(labelFrame(face({ mouthSmileLeft: 0.8, mouthSmileRight: 0.7 }))).toBe("smiling");
    expect(labelFrame(face({ mouthFrownLeft: 0.5, mouthFrownRight: 0.4 }))).toBe("frowning");
    expect(labelFrame(face({ browDownLeft: 0.6, browDownRight: 0.6 }))).toBe("furrowed");
    expect(labelFrame(face({ eyeBlinkLeft: 0.7, eyeBlinkRight: 0.7 }))).toBe("drowsy");
    expect(labelFrame(face({ mouthSmileLeft: 0.2 }))).toBe("none");
  });

  it("does not call a blink drowsy, or a glance away", () => {
    const now = 60_000;
    // Eyes open, with a one-frame blink every three seconds.
    const blinks = stream("none", HOLD_MS.drowsy, now).map((s, i) => (i % 12 === 0 ? { ...s, label: "drowsy" as Label } : s));
    expect(steadyLabel(blinks, now)).toBe("none");
    // Five seconds looking at the window, inside twenty looking at the lesson.
    const glance = [...stream("none", 15_000, now - 5_000), ...stream("away", 5_000, now)];
    expect(steadyLabel(glance, now)).toBe("none");
  });

  it("speaks only once a look has lasted its own time", () => {
    const now = 60_000;
    expect(steadyLabel(stream("smiling", 2_000, now), now)).toBe("none");        // too brief
    expect(steadyLabel(stream("smiling", 4_000, now), now)).toBe("smiling");
    expect(steadyLabel(stream("away", 10_000, now), now)).toBe("none");         // away needs twenty seconds
    expect(steadyLabel(stream("away", 20_000, now), now)).toBe("away");
  });

  it("needs most of the window to agree, not just a few frames", () => {
    const now = 60_000;
    const mixed = stream("smiling", 4_000, now).map((s, i) => (i % 2 === 0 ? { ...s, label: "none" as Label } : s));
    expect(steadyLabel(mixed, now)).toBe("none");
  });

  it("puts what matters most to a tutor first", () => {
    const now = 60_000;
    // Drooping eyes for twelve seconds, and a smile within the last four:
    // the drowsiness is the thing a caring tutor would notice.
    const both = stream("drowsy", HOLD_MS.drowsy, now);
    expect(steadyLabel(both, now)).toBe("drowsy");
  });

  it("forgets what no window could need", () => {
    const now = 100_000;
    const old = [{ at: 1_000, label: "smiling" as Label }, { at: now - 1_000, label: "none" as Label }];
    expect(prune(old, now)).toHaveLength(1);
  });

  it("tells the tutor only what is news", () => {
    const now = 1_000_000;
    expect(hintToSend("none", { hint: null, at: 0 }, now)).toBeNull();
    expect(hintToSend("smiling", { hint: null, at: 0 }, now)).toBe("smiling");
    // Still smiling a minute later: not news.
    expect(hintToSend("smiling", { hint: "smiling", at: now - 60_000 }, now)).toBeNull();
    // Still smiling after a long while: worth another word.
    expect(hintToSend("smiling", { hint: "smiling", at: now - REPEAT_AFTER_MS }, now)).toBe("smiling");
    // A change is always news.
    expect(hintToSend("frowning", { hint: "smiling", at: now - 1_000 }, now)).toBe("frowning");
  });
});
