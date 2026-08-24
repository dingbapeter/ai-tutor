"use client";

import { useEffect, useState } from "react";

/**
 * The Dingba cast: original in-house caricatures, one for each kind of
 * learner the platform serves. Drawn as SVG so they're licensing-clean,
 * theme-aware, and weightless; commissioned art can replace them later
 * without touching the pages that show them.
 */

type Character = { id: string; label: string; svg: (size: number) => React.ReactElement };

function Base({
  size,
  skin,
  shirt,
  children,
  hair,
}: {
  size: number;
  skin: string;
  shirt: string;
  hair: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <svg width={size} height={size * 1.2} viewBox="0 0 200 240" aria-hidden>
      <ellipse cx="100" cy="228" rx="62" ry="9" fill="currentColor" opacity="0.08" />
      {/* neck, then torso over it, then head over both */}
      <rect x="86" y="120" width="28" height="52" rx="10" fill={skin} />
      <path d="M 52 232 Q 52 160 100 160 Q 148 160 148 232 Z" fill={shirt} />
      {/* head, deliberately oversized: caricature proportions */}
      <circle cx="100" cy="88" r="56" fill={skin} />
      <circle cx="42" cy="92" r="10" fill={skin} />
      <circle cx="158" cy="92" r="10" fill={skin} />
      {hair}
      {/* eyes */}
      <circle cx="80" cy="92" r="7" fill="#191925" />
      <circle cx="120" cy="92" r="7" fill="#191925" />
      <circle cx="82.5" cy="89.5" r="2.4" fill="#fff" />
      <circle cx="122.5" cy="89.5" r="2.4" fill="#fff" />
      {/* brows */}
      <rect x="70" y="74" width="20" height="5" rx="2.5" fill="#191925" opacity="0.75" />
      <rect x="110" y="74" width="20" height="5" rx="2.5" fill="#191925" opacity="0.75" />
      {/* smile */}
      <path d="M 82 112 Q 100 128 118 112" stroke="#191925" strokeWidth="5" fill="none" strokeLinecap="round" />
      {/* cheeks */}
      <circle cx="66" cy="108" r="7" fill="#ff8f77" opacity="0.28" />
      <circle cx="134" cy="108" r="7" fill="#ff8f77" opacity="0.28" />
      {children}
    </svg>
  );
}

export const CARICATURES: Character[] = [
  {
    id: "kaito",
    label: "the schoolkid in the Dingba hoodie",
    svg: (size) => (
      <Base
        size={size}
        skin="#8d5a3b"
        shirt="#6C5CE7"
        hair={
          <path d="M 44 84 Q 46 30 100 28 Q 154 30 156 84 Q 152 52 100 50 Q 48 52 44 84 Z" fill="#241d16" />
        }
      >
        {/* hoodie details */}
        <path d="M 62 176 Q 100 196 138 176 L 138 186 Q 100 206 62 186 Z" fill="#fff" opacity="0.9" />
        <text x="100" y="222" textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff" fontFamily="inherit" letterSpacing="1">
          DINGBA
        </text>
        {/* the book under the arm */}
        <rect x="126" y="196" width="48" height="34" rx="4" fill="#43389f" transform="rotate(-8 150 213)" />
        <rect x="130" y="200" width="40" height="5" rx="2.5" fill="#fff" opacity="0.85" transform="rotate(-8 150 213)" />
      </Base>
    ),
  },
  {
    id: "amina",
    label: "the exam candidate with her notes",
    svg: (size) => (
      <Base
        size={size}
        skin="#6b4429"
        shirt="#2f7f6f"
        hair={
          <>
            {/* headwrap */}
            <path d="M 42 86 Q 40 26 100 24 Q 160 26 158 86 Q 150 44 100 42 Q 50 44 42 86 Z" fill="#e8875a" />
            <path d="M 58 44 Q 74 30 96 30 L 88 46 Z" fill="#c96b3f" />
            <circle cx="146" cy="40" r="10" fill="#e8875a" />
          </>
        }
      >
        {/* earrings */}
        <circle cx="42" cy="106" r="4" fill="#f2c14e" />
        <circle cx="158" cy="106" r="4" fill="#f2c14e" />
        {/* notes in hand */}
        <rect x="24" y="192" width="44" height="40" rx="4" fill="#fff" transform="rotate(7 46 212)" />
        <rect x="30" y="200" width="32" height="4" rx="2" fill="#9c9cb2" transform="rotate(7 46 212)" />
        <rect x="30" y="209" width="32" height="4" rx="2" fill="#9c9cb2" transform="rotate(7 46 212)" />
        <rect x="30" y="218" width="22" height="4" rx="2" fill="#9c9cb2" transform="rotate(7 46 212)" />
      </Base>
    ),
  },
  {
    id: "dele",
    label: "the professional chasing his charter",
    svg: (size) => (
      <Base
        size={size}
        skin="#a06a48"
        shirt="#3f6fb5"
        hair={
          <>
            <path d="M 46 78 Q 50 34 100 32 Q 150 34 154 78 Q 146 54 100 52 Q 54 54 46 78 Z" fill="#191410" />
            {/* glasses */}
            <circle cx="80" cy="92" r="14" fill="none" stroke="#191925" strokeWidth="4" />
            <circle cx="120" cy="92" r="14" fill="none" stroke="#191925" strokeWidth="4" />
            <path d="M 94 92 L 106 92" stroke="#191925" strokeWidth="4" />
          </>
        }
      >
        {/* collar + tie */}
        <path d="M 88 162 L 100 176 L 112 162 L 100 158 Z" fill="#fff" />
        <path d="M 96 176 L 104 176 L 102 212 L 100 218 L 98 212 Z" fill="#43389f" />
        {/* calculator */}
        <rect x="130" y="194" width="40" height="38" rx="5" fill="#191925" transform="rotate(6 150 213)" />
        <rect x="136" y="200" width="28" height="8" rx="2" fill="#9be8c5" transform="rotate(6 150 213)" />
        <circle cx="141" cy="218" r="3" fill="#fff" transform="rotate(6 150 213)" />
        <circle cx="151" cy="218" r="3" fill="#fff" transform="rotate(6 150 213)" />
        <circle cx="161" cy="218" r="3" fill="#fff" transform="rotate(6 150 213)" />
      </Base>
    ),
  },
  {
    id: "yusuf",
    label: "the traveler rehearsing his interview",
    svg: (size) => (
      <Base
        size={size}
        skin="#c68a5f"
        shirt="#8a4b2d"
        hair={
          <>
            <path d="M 48 74 Q 56 36 100 34 Q 144 36 152 74 Q 140 56 100 54 Q 60 56 48 74 Z" fill="#2b2118" />
            {/* beard line */}
            <path d="M 56 108 Q 60 140 100 142 Q 140 140 144 108 Q 138 128 100 130 Q 62 128 56 108 Z" fill="#2b2118" opacity="0.85" />
          </>
        }
      >
        {/* passport in hand */}
        <rect x="128" y="192" width="38" height="46" rx="5" fill="#1e8e5a" transform="rotate(-7 147 215)" />
        <circle cx="147" cy="208" r="8" fill="#f2c14e" opacity="0.9" transform="rotate(-7 147 215)" />
        <rect x="136" y="222" width="22" height="4" rx="2" fill="#fff" opacity="0.85" transform="rotate(-7 147 215)" />
      </Base>
    ),
  },
  {
    id: "mama-ruth",
    label: "the lifelong learner",
    svg: (size) => (
      <Base
        size={size}
        skin="#7a4a2e"
        shirt="#7b6bd6"
        hair={
          <>
            {/* silver curls */}
            <path d="M 44 86 Q 42 34 100 30 Q 158 34 156 86 Q 148 50 100 48 Q 52 50 44 86 Z" fill="#d9d7e6" />
            <circle cx="52" cy="56" r="9" fill="#d9d7e6" />
            <circle cx="148" cy="56" r="9" fill="#d9d7e6" />
            {/* round glasses */}
            <circle cx="80" cy="92" r="13" fill="none" stroke="#43389f" strokeWidth="4" />
            <circle cx="120" cy="92" r="13" fill="none" stroke="#43389f" strokeWidth="4" />
            <path d="M 93 92 L 107 92" stroke="#43389f" strokeWidth="4" />
          </>
        }
      >
        {/* phone with Dingba on screen */}
        <rect x="30" y="190" width="34" height="48" rx="6" fill="#191925" transform="rotate(8 47 214)" />
        <rect x="34" y="196" width="26" height="34" rx="3" fill="#6C5CE7" transform="rotate(8 47 214)" />
        <circle cx="47" cy="210" r="7" fill="#fff" opacity="0.9" transform="rotate(8 47 214)" />
      </Base>
    ),
  },
];

/**
 * Picks a character at random per visit. The first paint is deterministic
 * (no hydration mismatch); the shuffle lands right after mount. `slot`
 * offsets the pick so several slots on one page show different characters.
 * `bust` crops to head-and-shoulders and renders large, hero-style.
 */
export function RandomCaricature({ size = 180, slot = 0, bust = false }: { size?: number; slot?: number; bust?: boolean }) {
  const [pick, setPick] = useState(slot % CARICATURES.length);
  useEffect(() => {
    setPick((Math.floor(Math.random() * CARICATURES.length) + slot) % CARICATURES.length);
  }, [slot]);
  const c = CARICATURES[pick];
  if (!bust) return <span title={c.label}>{c.svg(size)}</span>;
  // Bust crop: the figure drawn large, container clipping below the chest.
  return (
    <span title={c.label} style={{ display: "inline-block", height: size * 1.14, overflow: "hidden" }}>
      {c.svg(size)}
    </span>
  );
}
