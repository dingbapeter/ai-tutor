/**
 * The tutor appearance vocabulary, server side. These key lists MUST match
 * apps/web/app/learn/face-appearance.ts, which renders them; here we only
 * validate that a learner picked real options. A null clears back to the
 * persona's default look.
 */

export const SKIN_TONES = [
  "porcelain",
  "fair",
  "light",
  "tan",
  "golden",
  "brown",
  "deep",
  "dark",
  "ebony",
  "rich",
] as const;

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

export const HAIR_COLORS = [
  "black",
  "darkBrown",
  "brown",
  "auburn",
  "chestnut",
  "blonde",
  "sandy",
  "grey",
  "silver",
  "violet",
  "teal",
  "pink",
] as const;

export interface TutorLook {
  skin: string | null;
  hair: string | null;
  hairColor: string | null;
}

/**
 * Validate a requested look. Each field may be a known key or empty (which
 * clears it to the default). An unknown value is rejected with a reason, so
 * the client never silently paints a tutor a colour that does not exist.
 */
export function cleanLook(input: {
  skin?: unknown;
  hair?: unknown;
  hairColor?: unknown;
}): { ok: true; look: TutorLook } | { ok: false; error: string } {
  const field = (
    value: unknown,
    allowed: readonly string[],
    label: string,
  ): { value: string | null } | { error: string } => {
    if (value === undefined || value === null || value === "") return { value: null };
    if (typeof value !== "string" || !allowed.includes(value)) return { error: `unknown ${label}` };
    return { value };
  };
  const skin = field(input.skin, SKIN_TONES, "skin tone");
  if ("error" in skin) return { ok: false, error: skin.error };
  const hair = field(input.hair, HAIR_STYLES, "hair style");
  if ("error" in hair) return { ok: false, error: hair.error };
  const hairColor = field(input.hairColor, HAIR_COLORS, "hair colour");
  if ("error" in hairColor) return { ok: false, error: hairColor.error };
  return { ok: true, look: { skin: skin.value, hair: hair.value, hairColor: hairColor.value } };
}
