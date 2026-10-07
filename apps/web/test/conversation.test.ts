import { describe, expect, it } from "vitest";
import { DEFAULT_TUNING, VadFsm, type VadEvent } from "../app/learn/conversation";

const T = { ...DEFAULT_TUNING };
const QUIET = 0.001;
const TALK = 0.03; // above speechRms, below bargeInRms
const LOUD = 0.09; // above bargeInRms

/** Feed a constant level for a duration, returning any events raised. */
function run(fsm: VadFsm, level: number, ms: number, tutorSpeaking = false): VadEvent[] {
  const out: VadEvent[] = [];
  for (let t = 0; t < ms; t += 50) {
    const evt = fsm.feed(level, tutorSpeaking, 50);
    if (evt) out.push(evt);
  }
  return out;
}

describe("conversation-mode voice activity FSM", () => {
  it("opens on sustained speech and closes after sustained silence", () => {
    const fsm = new VadFsm(T);
    expect(run(fsm, QUIET, 1000)).toEqual([]);
    const opened = run(fsm, TALK, 300);
    expect(opened).toEqual([{ kind: "open", bargeIn: false }]);
    expect(fsm.isCapturing()).toBe(true);
    expect(run(fsm, TALK, 2000)).toEqual([]); // keeps hearing while they talk
    const closed = run(fsm, QUIET, 1000);
    expect(closed).toEqual([{ kind: "close", voicedEnough: true }]);
    expect(fsm.isCapturing()).toBe(false);
  });

  it("ignores a blip shorter than the start threshold", () => {
    const fsm = new VadFsm(T);
    expect(run(fsm, TALK, 100)).toEqual([]); // a cough, under startMs
    expect(run(fsm, QUIET, 500)).toEqual([]);
    expect(fsm.isCapturing()).toBe(false);
  });

  it("discards an utterance with too little voiced time as noise", () => {
    const fsm = new VadFsm({ ...T, startMs: 100, minVoicedMs: 1000 });
    run(fsm, TALK, 150); // opens
    const closed = run(fsm, QUIET, 1200); // closes with only ~150ms voiced
    expect(closed).toEqual([{ kind: "close", voicedEnough: false }]);
  });

  it("holds a higher bar while the tutor is speaking, then barge-in interrupts", () => {
    const fsm = new VadFsm(T);
    // Normal talking volume while the tutor speaks: treated as bleed-through.
    expect(run(fsm, TALK, 2000, true)).toEqual([]);
    // Clearly louder, sustained: that is the learner interrupting.
    const opened = run(fsm, LOUD, 300, true);
    expect(opened).toEqual([{ kind: "open", bargeIn: true }]);
  });

  it("once capturing, normal volume keeps the utterance open even if the tutor is somehow talking", () => {
    const fsm = new VadFsm(T);
    run(fsm, LOUD, 300, true); // barge-in opened it
    expect(run(fsm, TALK, 1000, true)).toEqual([]); // no premature close
    const closed = run(fsm, QUIET, 1000, true);
    expect(closed).toEqual([{ kind: "close", voicedEnough: true }]);
  });

  it("caps a runaway utterance at the maximum length, then keeps listening", () => {
    const fsm = new VadFsm({ ...T, maxUtteranceMs: 2000 });
    run(fsm, TALK, 300);
    const events = run(fsm, TALK, 2500);
    // The cap closes the utterance; continued speech opens the next one.
    expect(events[0]).toEqual({ kind: "close", voicedEnough: true });
    expect(events[1]).toEqual({ kind: "open", bargeIn: false });
  });

  it("recycles the recorder during long quiet stretches so silence never piles up", () => {
    const fsm = new VadFsm({ ...T, idleRecycleMs: 1000 });
    const events = run(fsm, QUIET, 3200);
    expect(events.filter((e) => e.kind === "recycle").length).toBeGreaterThanOrEqual(3);
  });

  it("a recycle never fires mid-utterance", () => {
    const fsm = new VadFsm({ ...T, idleRecycleMs: 500 });
    run(fsm, TALK, 300); // open
    const during = run(fsm, TALK, 3000);
    expect(during.filter((e) => e.kind === "recycle")).toEqual([]);
  });
});
