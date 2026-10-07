import { describe, expect, it } from "vitest";
import { encodeVoice, pitchOf, rms, summarise, type Frame } from "../app/learn/voice/features";

const RATE = 48_000;
const SLICE = 2048;

/** A voiced slice: a fundamental with the overtones a real voice carries. */
function voice(hz: number, amp = 0.3, rate = RATE, n = SLICE): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    out[i] = amp * (Math.sin(2 * Math.PI * hz * t) + 0.5 * Math.sin(4 * Math.PI * hz * t) + 0.25 * Math.sin(6 * Math.PI * hz * t)) / 1.75;
  }
  return out;
}

/** Deterministic noise, so the test never flickers. */
function noise(amp: number, n = SLICE): Float32Array {
  let seed = 7;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    seed = (seed * 16807) % 2147483647;
    out[i] = amp * ((seed / 2147483647) * 2 - 1);
  }
  return out;
}

describe("hearing a voice on the device", () => {
  it("reads the pitch of a man, a woman and a small child, at any usual sample rate", () => {
    for (const hz of [95, 130, 210, 290, 420]) {
      for (const rate of [44_100, 48_000]) {
        const got = pitchOf(voice(hz, 0.3, rate), rate)!;
        expect(got).not.toBeNull();
        // Within a quarter of a semitone.
        expect(Math.abs(12 * Math.log2(got / hz))).toBeLessThan(0.25);
      }
    }
  });

  it("does not read an octave low because of the voice's own overtones", () => {
    const got = pitchOf(voice(200), RATE)!;
    expect(got).toBeGreaterThan(180);
    expect(got).toBeLessThan(220);
  });

  it("finds no pitch in silence, a hiss, or a hum below speech", () => {
    expect(pitchOf(new Float32Array(SLICE), RATE)).toBeNull();
    expect(pitchOf(noise(0.3), RATE)).toBeNull();
    expect(pitchOf(voice(200, 0.005), RATE)).toBeNull(); // too quiet to be them
    expect(pitchOf(voice(45), RATE)).toBeNull(); // mains hum, not a voice
  });

  it("measures loudness", () => {
    expect(rms(new Float32Array(10))).toBe(0);
    expect(rms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5, 5);
  });

  it("sums a turn into four numbers, skipping the pauses", () => {
    const frames: Frame[] = [
      ...Array.from({ length: 10 }, () => ({ level: 0.005, pitch: null })), // a pause
      ...[200, 210, 220, 230, 240, 220, 210, 220].map((p) => ({ level: 0.15, pitch: p })),
      { level: 0.12, pitch: null }, // a consonant: voiced, no pitch
    ];
    const t = summarise(frames)!;
    expect(t.voicedSec).toBeCloseTo(0.9, 5);
    expect(t.level).toBeCloseTo((0.15 * 8 + 0.12) / 9, 5);
    expect(t.pitchHz).toBe(220);
    expect(t.rangeSt).toBeGreaterThan(0.5);
    expect(t.rangeSt).toBeLessThan(2);
  });

  it("says nothing about a turn they hardly spoke in", () => {
    expect(summarise([{ level: 0.2, pitch: 200 }, { level: 0.2, pitch: 200 }])).toBeNull();
    // Voiced but pitch unreadable (a whisper): loudness and time only.
    const whisper = summarise(Array.from({ length: 12 }, () => ({ level: 0.05, pitch: null })))!;
    expect(whisper.pitchHz).toBeUndefined();
    expect(whisper.voicedSec).toBeCloseTo(1.2, 5);
  });

  it("writes the short header the server reads, and nothing more", () => {
    expect(encodeVoice({ pitchHz: 212.54, rangeSt: 3.126, level: 0.14231, voicedSec: 3.42 })).toBe("pitch=212.5;range=3.13;level=0.142;voiced=3.4");
    expect(encodeVoice({ level: 0.05, voicedSec: 1.2 })).toBe("level=0.050;voiced=1.2");
  });
});
