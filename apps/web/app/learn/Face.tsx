"use client";

import { useEffect, useRef, useState } from "react";
import { approach, expressionFor, type Mood } from "./face-logic";

/**
 * The living persona: a character face rendered as pure SVG, animated at
 * frame rate. No videos, no downloads, runs on any phone.
 *
 * What makes it feel alive:
 * - the mouth is driven by the ACTUAL loudness of the tutor's voice
 *   (an analyser on the playing audio), not a canned loop
 * - eyes make small human saccades, look up while thinking, widen and
 *   settle on you while you're talking, glance down while you type
 * - blinks arrive on a human schedule (randomised, occasional double)
 * - expressions (brows, mouth curve, blush) follow the tutor's own words
 * - the bond the student has built shows on the character: a pin, then a
 *   halo, then the old-friend glow — it grows with the child, and only grows
 *
 * And one thing it never does: pretend to be a live human. It's a beloved
 * character that is openly an AI tutor.
 */

interface Rig {
  skin: string;
  skinShade: string;
  hair: string;
  /** hairstyle key — which hair paths to draw */
  style: "puff" | "flattop" | "buns" | "bob" | "fade";
  beard?: boolean;
}

const RIGS: Record<string, Rig> = {
  amara: { skin: "#a9683a", skinShade: "#8a4b2d", hair: "#2b1b12", style: "puff" },
  kofi: { skin: "#7c4a26", skinShade: "#5f3517", hair: "#161210", style: "flattop", beard: true },
  juno: { skin: "#c98e58", skinShade: "#a06b3c", hair: "#4a3e99", style: "buns" },
  nia: { skin: "#94592f", skinShade: "#734120", hair: "#1d1a2e", style: "bob" },
  obi: { skin: "#6d3f1f", skinShade: "#532c12", hair: "#141414", style: "fade" },
};

function rigFor(personaId: string | undefined, accent?: string): Rig {
  const known = personaId ? RIGS[personaId] : undefined;
  return known ?? { skin: "#a9683a", skinShade: "#8a4b2d", hair: accent ?? "#2b1b12", style: "puff" };
}

function Hair({ rig }: { rig: Rig }) {
  switch (rig.style) {
    case "flattop":
      return <path d="M 22 34 L 22 22 Q 50 12 78 22 L 78 34 Q 50 24 22 34 Z" fill={rig.hair} />;
    case "buns":
      return (
        <>
          <circle cx="22" cy="22" r="11" fill={rig.hair} />
          <circle cx="78" cy="22" r="11" fill={rig.hair} />
          <path d="M 20 38 Q 50 14 80 38 Q 50 28 20 38 Z" fill={rig.hair} />
        </>
      );
    case "bob":
      return (
        <>
          <path d="M 18 62 Q 12 24 50 16 Q 88 24 82 62 L 74 60 Q 78 30 50 26 Q 22 30 26 60 Z" fill={rig.hair} />
          <path d="M 20 40 Q 50 16 80 40 Q 50 30 20 40 Z" fill={rig.hair} />
        </>
      );
    case "fade":
      return <path d="M 24 36 Q 26 20 50 18 Q 74 20 76 36 Q 50 26 24 36 Z" fill={rig.hair} />;
    default:
      // puff: a proud rounded afro
      return (
        <>
          <circle cx="35" cy="22" r="13" fill={rig.hair} />
          <circle cx="65" cy="22" r="13" fill={rig.hair} />
          <circle cx="50" cy="17" r="14" fill={rig.hair} />
          <path d="M 20 40 Q 50 18 80 40 Q 50 30 20 40 Z" fill={rig.hair} />
        </>
      );
  }
}

export default function Face({
  personaId,
  accent,
  color,
  speaking,
  thinking = false,
  listening = false,
  attentive = false,
  mood = "neutral",
  bond = 0,
  getLevel,
  size = 84,
  live = true,
}: {
  personaId?: string;
  accent?: string;
  color?: string;
  speaking: boolean;
  thinking?: boolean;
  listening?: boolean;
  /** The student is typing: glance toward their words. */
  attentive?: boolean;
  mood?: Mood;
  /** Bond stage 0..3 — the friendship the character visibly wears. */
  bond?: number;
  /** Live loudness of the tutor's voice, 0..1. Falls back to a natural wave. */
  getLevel?: () => number;
  size?: number;
  /** false = a still portrait (picker tiles), no animation loop. */
  live?: boolean;
}) {
  const rig = rigFor(personaId, accent);
  const iris = color ?? "#5b4632";

  const [f, setF] = useState({ open: 0, curve: 0.3, brow: 0, gazeX: 0, gazeY: 0, lid: 0 });
  const anim = useRef({ open: 0, curve: 0.3, brow: 0, gazeX: 0, gazeY: 0, lid: 0 });
  const sacc = useRef({ x: 0, y: 0, next: 0 });
  const blink = useRef({ next: 800 + Math.random() * 2000, until: 0 });
  const stateRef = useRef({ speaking, thinking, listening, attentive, mood });
  stateRef.current = { speaking, thinking, listening, attentive, mood };
  const levelRef = useRef<typeof getLevel>(getLevel);
  levelRef.current = getLevel;

  useEffect(() => {
    if (!live) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(now - last, 50);
      last = now;
      const s = stateRef.current;
      const a = anim.current;
      const expr = expressionFor(s.mood);

      // Mouth: real voice loudness when available, a natural wave otherwise.
      let openTarget = 0;
      if (s.speaking) {
        const level = levelRef.current?.();
        openTarget =
          level !== undefined && level > 0.01
            ? Math.min(1, level * 1.6)
            : 0.35 + 0.3 * Math.abs(Math.sin(now / 90)) * Math.abs(Math.sin(now / 260));
      } else if (s.thinking) {
        openTarget = 0.08;
      }
      a.open = approach(a.open, openTarget, dt, s.speaking ? 45 : 140);

      // Expression follows the tutor's words, softly.
      a.curve = approach(a.curve, expr.curve, dt, 350);
      a.brow = approach(a.brow, s.listening ? Math.max(expr.brow, 0.55) : expr.brow, dt, 350);

      // Gaze: saccades while idle, up while thinking, on you while listening,
      // toward the composer while you type.
      if (now > sacc.current.next) {
        sacc.current = { x: (Math.random() - 0.5) * 3.4, y: (Math.random() - 0.5) * 2, next: now + 1200 + Math.random() * 2400 };
      }
      const gaze = s.listening
        ? { x: 0, y: 0.4 }
        : s.thinking
          ? { x: 2.2, y: -3.2 }
          : s.attentive
            ? { x: -1.5, y: 2.6 }
            : { x: sacc.current.x, y: sacc.current.y };
      a.gazeX = approach(a.gazeX, gaze.x, dt, 120);
      a.gazeY = approach(a.gazeY, gaze.y, dt, 120);

      // Blinks on a human schedule; eyes stay open while wide-listening.
      if (now > blink.current.next) {
        blink.current.until = now + 130;
        blink.current.next = now + 2200 + Math.random() * 3800 + (Math.random() < 0.15 ? -1900 : 0);
      }
      a.lid = approach(a.lid, now < blink.current.until ? 1 : 0, dt, 40);

      setF({ ...a });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live]);

  const v = live ? f : { open: 0, curve: expressionFor(mood).curve, brow: 0, gazeX: 0, gazeY: 0, lid: 0 };
  const mw = 9 + v.curve * 1.5; // mouth half-width
  const openPx = v.open * 9;
  const curvePx = v.curve * 6;
  const browY = 37.5 - v.brow * 2.2;
  const browTilt = v.brow < 0 ? -v.brow * 4 : 0; // furrow: inner ends dip
  const eyeOpen = 1 - v.lid;
  const glow = bond >= 3 ? "#e8b34b" : bond >= 2 ? (color ?? "#e8875a") : null;

  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden style={{ overflow: "visible" }}>
      {glow && <circle cx="50" cy="52" r="46" fill="none" stroke={glow} strokeWidth={bond >= 3 ? 2.5 : 1.5} opacity="0.5" />}
      {/* ears, head, hair */}
      <circle cx="14" cy="52" r="6" fill={rig.skin} />
      <circle cx="86" cy="52" r="6" fill={rig.skin} />
      <ellipse cx="50" cy="52" rx="38" ry="40" fill={rig.skin} />
      <Hair rig={rig} />
      {rig.beard && <path d="M 22 58 Q 26 84 50 86 Q 74 84 78 58 Q 74 76 50 78 Q 26 76 22 58 Z" fill={rig.hair} opacity="0.9" />}
      {/* brows */}
      <path d={`M 29 ${browY + browTilt} Q 37 ${browY - 2.5} 45 ${browY + (v.brow < 0 ? 0 : -0.5)}`} stroke={rig.hair} strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d={`M 55 ${browY + (v.brow < 0 ? 0 : -0.5)} Q 63 ${browY - 2.5} 71 ${browY + browTilt}`} stroke={rig.hair} strokeWidth="3" fill="none" strokeLinecap="round" />
      {/* eyes: whites, iris follows the gaze, lids blink */}
      <g>
        <ellipse cx="37" cy="47" rx="7.5" ry={6 * Math.max(eyeOpen, 0.06)} fill="#fdf6ee" />
        <ellipse cx="63" cy="47" rx="7.5" ry={6 * Math.max(eyeOpen, 0.06)} fill="#fdf6ee" />
        {eyeOpen > 0.25 && (
          <>
            <circle cx={37 + v.gazeX} cy={47 + v.gazeY} r={listening ? 4 : 3.4} fill={iris} />
            <circle cx={63 + v.gazeX} cy={47 + v.gazeY} r={listening ? 4 : 3.4} fill={iris} />
            <circle cx={37 + v.gazeX} cy={47 + v.gazeY} r="1.7" fill="#1a1a2e" />
            <circle cx={63 + v.gazeX} cy={47 + v.gazeY} r="1.7" fill="#1a1a2e" />
            <circle cx={38.2 + v.gazeX} cy={45.8 + v.gazeY} r="0.9" fill="#fff" />
            <circle cx={64.2 + v.gazeX} cy={45.8 + v.gazeY} r="0.9" fill="#fff" />
          </>
        )}
      </g>
      {/* nose */}
      <path d="M 50 52 Q 47.5 58 50 60.5 Q 52.5 58 50 52" fill={rig.skinShade} opacity="0.7" />
      {/* blush when joyful */}
      {v.curve > 0.7 && (
        <>
          <ellipse cx="27" cy="60" rx="5" ry="3" fill="#e8674b" opacity="0.25" />
          <ellipse cx="73" cy="60" rx="5" ry="3" fill="#e8674b" opacity="0.25" />
        </>
      )}
      {/* mouth: loudness opens it, mood curves it */}
      {openPx > 1 ? (
        <path
          d={`M ${50 - mw} 68 Q 50 ${68 - openPx * 0.35 - curvePx * 0.4} ${50 + mw} 68 Q 50 ${68 + openPx} ${50 - mw} 68 Z`}
          fill="#33201a"
        />
      ) : (
        <path
          d={`M ${50 - mw} ${68 - curvePx * 0.15} Q 50 ${68 + curvePx} ${50 + mw} ${68 - curvePx * 0.15}`}
          stroke="#33201a"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
      )}
      {openPx > 4 && <ellipse cx="50" cy={68 + openPx * 0.65} rx={mw * 0.45} ry={openPx * 0.28} fill="#c25a4a" />}
      {/* the bond, worn proudly: pin -> halo -> old-friend glow with a cap */}
      {bond >= 1 && (
        <g transform="translate(72 82)">
          <path d="M 0 -5 L 1.5 -1.5 L 5.4 -1.5 L 2.2 0.9 L 3.4 4.6 L 0 2.4 L -3.4 4.6 L -2.2 0.9 L -5.4 -1.5 L -1.5 -1.5 Z" fill={bond >= 3 ? "#e8b34b" : "#fdf6ee"} stroke={rig.skinShade} strokeWidth="0.6" />
        </g>
      )}
      {bond >= 3 && (
        <g transform="translate(76 20) rotate(12)">
          <rect x="-7" y="-2" width="14" height="4" rx="1" fill="#1a1a2e" />
          <path d="M -9 -2 L 0 -7 L 9 -2 L 0 2 Z" fill="#1a1a2e" />
          <line x1="7" y1="-2" x2="9" y2="4" stroke="#e8b34b" strokeWidth="1.2" />
          <circle cx="9" cy="5" r="1.4" fill="#e8b34b" />
        </g>
      )}
    </svg>
  );
}
