/**
 * Right-to-left teaching languages.
 *
 * Dingba teaches in 91 languages, and six of them are written right to
 * left. Left alone, an Arabic or Urdu lesson renders in a left-to-right
 * container: the full stop lands on the wrong side, lines hug the wrong
 * edge, and a sentence with a number or a formula in it comes apart. The
 * rule is tiny and the fix is one attribute, so there is no excuse for a
 * child reading their own language sideways.
 *
 * Kept as data plus a pure function so it can be tested without a browser.
 */

/** Languages Dingba offers that are written right to left. */
export const RTL_LANGUAGES = ["ar", "fa", "he", "ku", "ur", "ps"] as const;

export type Direction = "rtl" | "ltr";

/** The writing direction for a language tag ("ar", "ar-EG", "AR" all count). */
export function directionFor(code: string | null | undefined): Direction {
  if (!code) return "ltr";
  const base = code.toLowerCase().split(/[-_]/)[0];
  return (RTL_LANGUAGES as readonly string[]).includes(base) ? "rtl" : "ltr";
}

export function isRtl(code: string | null | undefined): boolean {
  return directionFor(code) === "rtl";
}
