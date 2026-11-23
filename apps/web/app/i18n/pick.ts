/**
 * The language decision, as plain functions with no interface attached,
 * so they can be tested on their own and read in one sitting.
 */
import { LOCALES, type LocaleCode } from "./locales";

export type Params = Record<string, string | number>;

/** Fill {tokens} in a sentence. A token with no value stays as it is. */
export function fill(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

/** The languages a device may show: reviewed ones, plus drafts for a reviewer. */
export function available(drafts: boolean): LocaleCode[] {
  return (Object.keys(LOCALES) as LocaleCode[]).filter((c) => c === "en" || LOCALES[c].reviewed || drafts);
}

/** The first of the family's choice, the teaching language and the browser's that is available. */
export function pickLanguage(opts: {
  stored?: string | null;
  teaching?: string | null;
  browser?: string | null;
  allowed: readonly string[];
}): LocaleCode {
  for (const raw of [opts.stored, opts.teaching, opts.browser]) {
    if (!raw) continue;
    const base = raw.toLowerCase().split(/[-_]/)[0];
    if (opts.allowed.includes(base)) return base as LocaleCode;
  }
  return "en";
}
