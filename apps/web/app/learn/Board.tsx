"use client";

import { useEffect, useRef, useState } from "react";
import {
  ERASER_WIDTH,
  MIN_STEP,
  PEN_WIDTH,
  exportSize,
  extendStroke,
  hasInk,
  toBoardPoint,
  undoLast,
  type Stroke,
} from "./board";

/** The board is always this many units wide; the screen decides the rest. */
const BOARD_WIDTH = 1000;
const BOARD_HEIGHT = 700;

interface Props {
  /** Hand the finished work to the tutor as a picture. */
  onShow(image: Blob): void;
  onClose(): void;
  busy: boolean;
}

/**
 * A place to work it out by hand.
 *
 * Pointer events, not mouse or touch events: one set of handlers that a
 * finger, a stylus and a mouse all speak, on every engine. `touch-action:
 * none` is what stops a drawing gesture scrolling the page away on a phone,
 * and pointer capture is what keeps a stroke attached to the board when the
 * finger wanders off its edge.
 */
export default function Board({ onShow, onClose, busy }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const drawing = useRef<Stroke | null>(null);
  const [erasing, setErasing] = useState(false);
  const [inked, setInked] = useState(false);

  /** Repaint from the strokes we hold: the strokes are the truth, not the pixels. */
  function repaint() {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cssWidth = el.clientWidth || 1;
    const cssHeight = Math.round((cssWidth * BOARD_HEIGHT) / BOARD_WIDTH);
    const want = { w: Math.round(cssWidth * dpr), h: Math.round(cssHeight * dpr) };
    if (el.width !== want.w || el.height !== want.h) {
      el.width = want.w;
      el.height = want.h;
      el.style.height = `${cssHeight}px`;
    }
    const scale = (cssWidth * dpr) / BOARD_WIDTH;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    // Paper first: a transparent picture reads as a black page to anything
    // that looks at it later, the tutor's eyes included.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of [...strokes.current, ...(drawing.current ? [drawing.current] : [])]) {
      if (stroke.points.length === 0) continue;
      ctx.strokeStyle = stroke.erase ? "#ffffff" : "#1a1a2e";
      ctx.lineWidth = stroke.width;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (const p of stroke.points.slice(1)) ctx.lineTo(p.x, p.y);
      // A dot is a tap: draw it as a mark rather than nothing at all.
      if (stroke.points.length === 1) ctx.lineTo(stroke.points[0].x + 0.01, stroke.points[0].y);
      ctx.stroke();
    }
  }

  useEffect(() => {
    repaint();
    const onResize = () => repaint();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pointFrom(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return toBoardPoint(e.clientX, e.clientY, rect, BOARD_WIDTH);
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawing.current = {
      points: [pointFrom(e)],
      width: erasing ? ERASER_WIDTH : PEN_WIDTH,
      erase: erasing,
    };
    repaint();
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    if (extendStroke(drawing.current, pointFrom(e), MIN_STEP)) repaint();
  }

  function up() {
    if (!drawing.current) return;
    strokes.current = [...strokes.current, drawing.current];
    drawing.current = null;
    setInked(hasInk(strokes.current));
    repaint();
  }

  function undo() {
    strokes.current = undoLast(strokes.current);
    setInked(hasInk(strokes.current));
    repaint();
  }

  function clear() {
    strokes.current = [];
    drawing.current = null;
    setInked(false);
    repaint();
  }

  /** Redraw at sending size and hand over a PNG. */
  function show() {
    const el = canvas.current;
    if (!el || !hasInk(strokes.current)) return;
    const out = document.createElement("canvas");
    const size = exportSize(BOARD_WIDTH * 1.6, BOARD_HEIGHT * 1.6);
    out.width = size.width;
    out.height = size.height;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    const scale = size.width / BOARD_WIDTH;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of strokes.current) {
      if (stroke.points.length === 0) continue;
      ctx.strokeStyle = stroke.erase ? "#ffffff" : "#1a1a2e";
      ctx.lineWidth = stroke.width;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (const p of stroke.points.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    out.toBlob((blob) => {
      if (blob) onShow(blob);
    }, "image/png");
  }

  return (
    <div className="board">
      <div className="board-tools">
        <button className={`chip${erasing ? "" : " on"}`} onClick={() => setErasing(false)} title="Write">
          ✏️ write
        </button>
        <button className={`chip${erasing ? " on" : ""}`} onClick={() => setErasing(true)} title="Rub out">
          🧽 rub out
        </button>
        <button className="chip" onClick={undo} title="Undo the last thing you drew">
          ↩︎ undo
        </button>
        <button className="chip" onClick={clear} title="Start the board again">
          ✕ clear
        </button>
        <span style={{ flex: 1 }} />
        <button className="chip" onClick={onClose} title="Put the board away">
          close
        </button>
      </div>
      <canvas
        ref={canvas}
        className="board-canvas"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        aria-label="Whiteboard: write or draw your working here"
      />
      <div className="board-foot">
        <span className="muted">Write it out by hand, then show your tutor.</span>
        <button className="btn" onClick={show} disabled={busy || !inked}>
          Show my tutor
        </button>
      </div>
    </div>
  );
}
