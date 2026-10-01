"use client";

/**
 * The app's own words in the learner's language.
 *
 * The tutor already teaches in 91 languages; this is for everything around
 * the tutor: buttons, labels, the status line, the home page. Keys are the
 * English sentences themselves, so the source stays readable and a missing
 * translation falls back to English rather than to a blank.
 *
 * Which language: the family's own choice (the switch in the app bar,
 * remembered on this device), else the language the tutor is teaching in,
 * else the browser's, and only ever a language whose translation has been
 * reviewed by a person who speaks it. A draft translation is never shown
 * to a child by accident: drafts appear in the switch only after
 * ?uiDrafts=1 has been opened once on the device, which is how a reviewer
 * reads them in place.
 */

import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LOCALES, type LocaleCode } from "./locales";
import { available, fill, pickLanguage, type Params } from "./pick";

export { available, fill, pickLanguage, type Params } from "./pick";

export type Dict = Record<string, string>;

const STORE_KEY = "dingba_ui_lang";
const DRAFTS_KEY = "dingba_ui_drafts";

interface Ctx {
  lang: LocaleCode;
  dir: "ltr" | "rtl";
  drafts: boolean;
  /** The family chose a language; null forgets the choice. */
  choose: (lang: LocaleCode | null) => void;
  /** The tutor is teaching in this language; follow it unless the family chose otherwise. */
  suggest: (lang: string | null) => void;
  t: (key: string, params?: Params) => string;
  /** A sentence with pieces of interface inside it: `tx("Agree to {terms}", { terms: <a/> })`. */
  tx: (key: string, parts: Record<string, ReactNode>) => ReactNode;
}

const identity: Ctx = {
  lang: "en",
  dir: "ltr",
  drafts: false,
  choose: () => {},
  suggest: () => {},
  t: (key, params) => fill(key, params),
  tx: (key, parts) => splice(key, parts),
};

const LangContext = createContext<Ctx>(identity);

function splice(text: string, parts: Record<string, ReactNode>): ReactNode {
  const pieces = text.split(/(\{\w+\})/);
  return pieces.map((p, i) => {
    const m = /^\{(\w+)\}$/.exec(p);
    return <Fragment key={i}>{m && m[1] in parts ? parts[m[1]] : p}</Fragment>;
  });
}

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* private mode: the choice lasts the visit */
  }
};

export function LangProvider({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState(false);
  const [stored, setStored] = useState<string | null>(null);
  const [teaching, setTeaching] = useState<string | null>(null);
  const [browser, setBrowser] = useState<string | null>(null);
  const [dicts, setDicts] = useState<Partial<Record<LocaleCode, Dict>>>({});

  // What this device knows, read after mount so the server and the first
  // paint agree (both English).
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("uiDrafts") === "1") write(DRAFTS_KEY, "1");
    if (url.searchParams.get("uiDrafts") === "0") write(DRAFTS_KEY, null);
    setDrafts(read(DRAFTS_KEY) === "1");
    setStored(read(STORE_KEY));
    setBrowser(navigator.language ?? null);
  }, []);

  const lang = useMemo(
    () => pickLanguage({ stored, teaching, browser, allowed: available(drafts) }),
    [stored, teaching, browser, drafts],
  );

  // The words themselves, fetched once per language, only when needed.
  useEffect(() => {
    if (lang === "en" || dicts[lang]) return;
    let alive = true;
    LOCALES[lang]
      .load()
      .then((d) => {
        if (alive) setDicts((all) => ({ ...all, [lang]: d }));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [lang, dicts]);

  // The document follows: screen readers, hyphenation and right-to-left.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = LOCALES[lang].dir;
  }, [lang]);

  const dict = lang === "en" ? null : dicts[lang] ?? null;
  const t = useCallback((key: string, params?: Params) => fill(dict?.[key] ?? key, params), [dict]);
  const tx = useCallback((key: string, parts: Record<string, ReactNode>) => splice(dict?.[key] ?? key, parts), [dict]);

  const value = useMemo<Ctx>(
    () => ({
      lang,
      dir: LOCALES[lang].dir,
      drafts,
      choose: (next) => {
        write(STORE_KEY, next);
        setStored(next);
      },
      suggest: (next) => setTeaching(next),
      t,
      tx,
    }),
    [lang, drafts, t, tx],
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): Ctx {
  return useContext(LangContext);
}

/** The switch in the app bar: English, every reviewed language, and drafts for a reviewer. */
export function LanguageSwitch() {
  const { lang, drafts, choose, t } = useLang();
  const codes = available(drafts);
  if (codes.length < 2) return null;
  return (
    <select
      className="lang-switch"
      aria-label={t("Language")}
      value={lang}
      onChange={(e) => choose(e.target.value as LocaleCode)}
    >
      {codes.map((c) => (
        <option key={c} value={c}>
          {LOCALES[c].native}
          {!LOCALES[c].reviewed && c !== "en" ? ` (${t("draft")})` : ""}
        </option>
      ))}
    </select>
  );
}
