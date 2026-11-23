import { describe, expect, it } from "vitest";
import { buildTimeline, intensityFromLevel, shapeAt, wordToVisemes } from "../app/learn/avatar/visemes";

describe("lip sync from the words themselves", () => {
  it("turns letters into mouth shapes: lips close for m, round for oo, spread for ee", () => {
    expect(wordToVisemes("mama")).toEqual(["PP", "aa", "PP", "aa"]);
    expect(wordToVisemes("book")).toEqual(["PP", "ou", "kk"]);
    expect(wordToVisemes("see")).toEqual(["SS", "ih"]);
    expect(wordToVisemes("the")).toEqual(["TH", "E"]);
    expect(wordToVisemes("fish")).toEqual(["FF", "ih", "CH"]);
  });

  it("does not stutter on doubled consonants, and always moves the mouth at least once", () => {
    expect(wordToVisemes("letter")).toEqual(["nn", "E", "DD", "E", "RR"]);
    // No readable vowel: still one open shape, never a frozen mouth.
    expect(wordToVisemes("hmm")).toContain("ih");
    expect(wordToVisemes("")).toEqual([]);
  });

  it("gives a script it cannot spell a talking rhythm rather than silence", () => {
    // Arabic, Chinese, Hindi: one open-close beat per two characters.
    const arabic = wordToVisemes("مرحبا");
    expect(arabic.length).toBeGreaterThan(0);
    expect(arabic.every((v) => v === "aa" || v === "nn")).toBe(true);
    expect(wordToVisemes("你好")).toEqual(["aa"]);
  });

  it("lays the sentence across the audio's real length, with breaths at punctuation", () => {
    const tl = buildTimeline("Well done. Try the next one!", 3.0);
    expect(tl[0].viseme).toBe("sil");           // a breath before speaking
    expect(tl[0].start).toBe(0);
    expect(tl[tl.length - 1].end).toBe(3.0);     // ends exactly with the audio
    expect(tl[tl.length - 1].viseme).toBe("sil");
    // Every cue follows the last with no gap and no overlap.
    for (let i = 1; i < tl.length; i++) expect(tl[i].start).toBeCloseTo(tl[i - 1].end, 9);
    // The full stop after "done" is a longer pause than the space after "Try".
    const stop = tl.find((c, i) => c.viseme === "sil" && tl[i - 1]?.viseme === "E" && tl[i - 2]?.viseme === "nn");
    const space = tl.filter((c) => c.viseme === "sil");
    expect(stop).toBeDefined();
    expect(stop!.end - stop!.start).toBeGreaterThan(Math.min(...space.map((c) => c.end - c.start)));
  });

  it("vowels last longer than consonants, so the rhythm reads as speech", () => {
    const tl = buildTimeline("ba", 1);
    const b = tl.find((c) => c.viseme === "PP")!;
    const a = tl.find((c) => c.viseme === "aa")!;
    expect(a.end - a.start).toBeGreaterThan(b.end - b.start);
  });

  it("reads the mouth at any instant and glides into the next shape rather than snapping", () => {
    const tl = buildTimeline("ma", 2);
    const m = tl.find((c) => c.viseme === "PP")!;
    const early = shapeAt(tl, m.start + (m.end - m.start) * 0.1);
    expect(early.from).toBe("PP");
    expect(early.blend).toBe(0);
    const late = shapeAt(tl, m.start + (m.end - m.start) * 0.95);
    expect(late.from).toBe("PP");
    expect(late.to).toBe("aa");
    expect(late.blend).toBeGreaterThan(0.7);
    // Past the end, and before the start, the mouth is safely at rest.
    expect(shapeAt(tl, 99).from).toBe("sil");
    expect(shapeAt([], 1)).toEqual({ from: "sil", to: "sil", blend: 0 });
  });

  it("lets the real loudness decide how hard a shape is hit", () => {
    expect(intensityFromLevel(0)).toBe(0);       // a pause closes the mouth
    expect(intensityFromLevel(0.02)).toBe(0);
    expect(intensityFromLevel(0.14)).toBeCloseTo(0.5, 1);
    expect(intensityFromLevel(1)).toBe(1);
  });
});
