/**
 * The languages the app's own words come in.
 *
 * `reviewed` is the switch that puts a language in front of families: it
 * is flipped by a person who speaks the language after reading the whole
 * dictionary in place (open any page with ?uiDrafts=1, pick the language
 * from the switch, and read). Until then a language is a draft: present
 * for reviewers, never chosen for a child automatically.
 */

export type LocaleCode = "en" | "fr" | "es" | "pt" | "ar" | "sw" | "hi";

export interface Locale {
  /** The language's own name for itself. */
  native: string;
  dir: "ltr" | "rtl";
  reviewed: boolean;
  load: () => Promise<Record<string, string>>;
}

export const LOCALES: Record<LocaleCode, Locale> = {
  en: { native: "English", dir: "ltr", reviewed: true, load: async () => ({}) },
  fr: { native: "Français", dir: "ltr", reviewed: false, load: () => import("./dict/fr").then((m) => m.default) },
  es: { native: "Español", dir: "ltr", reviewed: false, load: () => import("./dict/es").then((m) => m.default) },
  pt: { native: "Português", dir: "ltr", reviewed: false, load: () => import("./dict/pt").then((m) => m.default) },
  ar: { native: "العربية", dir: "rtl", reviewed: false, load: () => import("./dict/ar").then((m) => m.default) },
  sw: { native: "Kiswahili", dir: "ltr", reviewed: false, load: () => import("./dict/sw").then((m) => m.default) },
  hi: { native: "हिन्दी", dir: "ltr", reviewed: false, load: () => import("./dict/hi").then((m) => m.default) },
};
