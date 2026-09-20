/**
 * The whiteboard: working a problem out by hand and showing it to the tutor.
 *
 * Typing is a poor way to do long division, an equation, a diagram or a
 * sentence you are still learning to spell. A child with a finger and a
 * phone can just write it. What the board produces is an image, which goes
 * down the same road a photo already takes (the vision slot, the safety
 * gate, the tutor's eyes), so nothing new is asked of the backend.
 *
 * Everything that can be decided without a browser lives here and is
 * tested: what counts as a new point, what undo means, whether the board is
 * blank, and how big an exported picture may be. The component around it
 * only does canvas work.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Stroke {
  points: Point[];
  /** Line thickness in board units. */
  width: number;
  /** An eraser stroke clears what it crosses instead of adding ink. */
  erase: boolean;
}

/** Pen and eraser sizes, in board units (a board is 1000 units wide). */
export const PEN_WIDTH = 4;
export const ERASER_WIDTH = 28;

/**
 * Points closer together than this are the same point as far as the board
 * is concerned. A finger reports dozens of positions per second and most of
 * them are tremor; keeping them all makes a heavier picture, not a better
 * one.
 */
export const MIN_STEP = 1.2;

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Add a point to a stroke, unless it is too close to the last one to matter.
 * Returns the stroke (mutated) so callers can chain, and says whether the
 * point was kept.
 */
export function extendStroke(stroke: Stroke, point: Point, minStep: number = MIN_STEP): boolean {
  const last = stroke.points[stroke.points.length - 1];
  if (last && distance(last, point) < minStep) return false;
  stroke.points.push(point);
  return true;
}

/** Undo the last stroke. Undoing an empty board is simply an empty board. */
export function undoLast(strokes: Stroke[]): Stroke[] {
  return strokes.slice(0, Math.max(0, strokes.length - 1));
}

/**
 * Is there anything for the tutor to look at?
 *
 * Eraser strokes are not ink, and a single tap is not writing, so neither
 * counts. This is what stops us sending a blank page to the tutor and
 * spending the family's daily allowance on it.
 */
export function hasInk(strokes: Stroke[]): boolean {
  return strokes.some((s) => !s.erase && s.points.length > 1);
}

/**
 * The size to export at.
 *
 * Big enough that handwriting stays readable, small enough that a phone on
 * a slow connection can still send it. The aspect ratio of the board is
 * kept, and we never scale a board UP: inventing pixels helps nobody.
 */
export function exportSize(
  width: number,
  height: number,
  maxSide = 1600,
): { width: number; height: number; scale: number } {
  const longest = Math.max(width, height);
  const scale = longest > maxSide ? maxSide / longest : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/**
 * Where a pointer landed, in board units.
 *
 * The board is always 1000 units wide whatever the screen is, so a stroke
 * drawn on a phone and the same stroke drawn on a laptop are the same
 * stroke. The caller passes the element's own rectangle.
 */
export function toBoardPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  boardWidth = 1000,
): Point {
  const scale = rect.width > 0 ? boardWidth / rect.width : 1;
  return {
    x: (clientX - rect.left) * scale,
    y: (clientY - rect.top) * scale,
  };
}
