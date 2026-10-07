/**
 * The tutor can look like anyone. A shared vocabulary of skin tones, hair
 * styles and hair colours the learner picks from, so a child anywhere sees
 * a face like theirs — or like whoever they want to learn from.
 *
 * These KEYS are the contract with the API (apps/api/src/tutor/look.ts),
 * which validates against the same names. Keep the two in step.
 */

export interface Tone {
  skin: string;
  shade: string;
  light: string;
}

/** A global range, fair to deep. Order is the swatch order in the picker. */
export const SKIN_TONES: Record<string, Tone> = {
  porcelain: { skin: "#f1d2b6", shade: "#d3ac86", light: "#f9e4cf" },
  fair: { skin: "#ecc19c", shade: "#cd9d72", light: "#f6d7ba" },
  light: { skin: "#e0a878", shade: "#bd8250", light: "#eec39a" },
  tan: { skin: "#cf9560", shade: "#a06b3c", light: "#e0ac78" },
  golden: { skin: "#c1834a", shade: "#97602f", light: "#d69f6a" },
  brown: { skin: "#b06f3e", shade: "#8a4b2d", light: "#c98a56" },
  deep: { skin: "#935a30", shade: "#6f4120", light: "#ab7345" },
  dark: { skin: "#754321", shade: "#532c12", light: "#8f5a30" },
  ebony: { skin: "#5a3418", shade: "#3d220e", light: "#744628" },
  rich: { skin: "#472811", shade: "#2e1908", light: "#5e3a1d" },
};

/** Hair silhouettes. The renderer draws each; the API only checks the key. */
export const HAIR_STYLES = [
  "afro",
  "coily",
  "curls",
  "waves",
  "straight",
  "bob",
  "buns",
  "flattop",
  "fade",
  "buzz",
  "locs",
  "hijab",
  "turban",
] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

export const HAIR_COLORS: Record<string, string> = {
  black: "#141010",
  darkBrown: "#2b1b12",
  brown: "#4a2f1c",
  auburn: "#6b2f1a",
  chestnut: "#7a4a2a",
  blonde: "#c69a5b",
  sandy: "#d8b57a",
  grey: "#9a938a",
  silver: "#cfcac2",
  violet: "#6a4bc0",
  teal: "#2f8f8f",
  pink: "#d05a8f",
} as const;

export interface Look {
  skin?: string | null;
  hair?: string | null;
  hairColor?: string | null;
}

export const isSkinTone = (k: string | null | undefined): k is string => !!k && k in SKIN_TONES;
export const isHairStyle = (k: string | null | undefined): k is HairStyle =>
  !!k && (HAIR_STYLES as readonly string[]).includes(k);
export const isHairColor = (k: string | null | undefined): k is string => !!k && k in HAIR_COLORS;
