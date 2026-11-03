import { describe, expect, it } from "vitest";
import { approach, breath, gazeTarget, headSway, initialBlink, lidTarget, speechNod, stepBlink } from "../app/learn/avatar/life";

describe("the small signs of life", () => {
  it("blinks on a human clock: first within three seconds, then every two to six", () => {
    const fixed = (v: number) => () => v;
    const s0 = initialBlink(0, fixed(0.5));
    expect(s0.next).toBeGreaterThanOrEqual(800);
    expect(s0.next).toBeLessThanOrEqual(3000);
    const s1 = stepBlink(s0, s0.next, fixed(0.5));
    expect(s1.until).toBe(s0.next + 130);
    expect(s1.next - s0.next).toBeGreaterThanOrEqual(2200);
    expect(s1.next - s0.next).toBeLessThanOrEqual(6000);
    // Before its time, nothing changes.
    expect(stepBlink(s0, s0.next - 1, fixed(0.5))).toBe(s0);
  });

  it("sometimes blinks twice, as people do", () => {
    const s = stepBlink({ next: 1000, until: 0 }, 1000, () => 0.01);
    expect(s.next).toBe(1320);
  });

  it("shuts the lid during a blink and opens it after", () => {
    const s = { next: 9999, until: 1130 };
    expect(lidTarget(s, 1100)).toBe(1);
    expect(lidTarget(s, 1131)).toBe(0);
  });

  it("breathes about fifteen times a minute, within 0 and 1", () => {
    const vals = Array.from({ length: 200 }, (_, i) => breath(i * 50));
    expect(Math.max(...vals)).toBeLessThanOrEqual(1);
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(0);
    // One full cycle is four seconds at fifteen a minute.
    expect(breath(0)).toBeCloseTo(breath(4000), 5);
    expect(breath(1000)).toBeGreaterThan(breath(3000));
  });

  it("sways the head a little, never a lot, and never on a visible loop", () => {
    for (let t = 0; t < 60_000; t += 700) {
      const s = headSway(t);
      expect(Math.abs(s.yaw)).toBeLessThan(0.06);
      expect(Math.abs(s.pitch)).toBeLessThan(0.04);
      expect(Math.abs(s.roll)).toBeLessThan(0.02);
    }
    expect(headSway(1000)).not.toEqual(headSway(1000 + 17_000));
  });

  it("nods on a rising voice and stays still on a falling one", () => {
    expect(speechNod(0.6, 0.2)).toBeGreaterThan(0);
    expect(speechNod(0.6, 0.2)).toBeLessThanOrEqual(0.05);
    expect(speechNod(0.2, 0.6)).toBe(0);
  });

  it("looks up when thinking, at you when listening", () => {
    expect(gazeTarget("thinking", 0).y).toBeGreaterThan(0.4);
    const listen = gazeTarget("listening", 1234);
    expect(Math.abs(listen.x)).toBeLessThan(0.1);
    expect(Math.abs(listen.y)).toBeLessThan(0.1);
  });

  it("eases towards a target regardless of frame rate", () => {
    // Two 8ms frames land in the same place as one 16ms frame, near enough.
    const twice = approach(approach(0, 1, 8, 100), 1, 8, 100);
    const once = approach(0, 1, 16, 100);
    expect(twice).toBeCloseTo(once, 3);
    expect(approach(0, 1, 10_000, 100)).toBeCloseTo(1, 5);
  });
});
