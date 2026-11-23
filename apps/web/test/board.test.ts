import { describe, expect, it } from "vitest";
import {
  ERASER_WIDTH,
  PEN_WIDTH,
  exportSize,
  extendStroke,
  hasInk,
  toBoardPoint,
  undoLast,
  type Stroke,
} from "../app/learn/board";

const stroke = (points: Array<[number, number]>, erase = false): Stroke => ({
  points: points.map(([x, y]) => ({ x, y })),
  width: erase ? ERASER_WIDTH : PEN_WIDTH,
  erase,
});

describe("the whiteboard's rules", () => {
  it("ignores the tremor in a finger, keeps real movement", () => {
    const s = stroke([[0, 0]]);
    expect(extendStroke(s, { x: 0.4, y: 0.3 })).toBe(false);
    expect(s.points).toHaveLength(1);
    expect(extendStroke(s, { x: 8, y: 0 })).toBe(true);
    expect(s.points).toHaveLength(2);
  });

  it("undoes one stroke at a time, and an empty board stays empty", () => {
    const board = [stroke([[0, 0], [5, 5]]), stroke([[9, 9], [12, 12]])];
    expect(undoLast(board)).toHaveLength(1);
    expect(undoLast(undoLast(board))).toHaveLength(0);
    expect(undoLast([])).toEqual([]);
  });

  it("knows when there is nothing worth the tutor's time", () => {
    // Nothing, a single tap, and erasing alone are all a blank page: sending
    // one would spend a family's daily allowance on an empty picture.
    expect(hasInk([])).toBe(false);
    expect(hasInk([stroke([[3, 3]])])).toBe(false);
    expect(hasInk([stroke([[3, 3], [40, 40]], true)])).toBe(false);
    expect(hasInk([stroke([[3, 3], [40, 40]])])).toBe(true);
  });

  it("shrinks a big board to send, and never inflates a small one", () => {
    expect(exportSize(3200, 1600)).toEqual({ width: 1600, height: 800, scale: 0.5 });
    expect(exportSize(1600, 3200)).toEqual({ width: 800, height: 1600, scale: 0.5 });
    // Already small: left exactly as it is.
    expect(exportSize(900, 500)).toEqual({ width: 900, height: 500, scale: 1 });
  });

  it("places a touch in board units, so a phone and a laptop draw the same stroke", () => {
    const phone = { left: 0, top: 100, width: 360, height: 400 };
    const laptop = { left: 40, top: 0, width: 720, height: 800 };
    // The middle of the board on either device is the middle of the board.
    expect(toBoardPoint(180, 300, phone)).toEqual({ x: 500, y: 555.5555555555555 });
    expect(toBoardPoint(400, 400, laptop)).toEqual({ x: 500, y: 555.5555555555555 });
    // A zero-width element cannot divide by itself into nonsense.
    expect(toBoardPoint(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 10, y: 10 });
  });
});
