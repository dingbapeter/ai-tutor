import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HEADLINES } from "../app/headlines";
import { available, fill, pickLanguage } from "../app/i18n/pick";
import { LOCALES, type LocaleCode } from "../app/i18n/locales";
import { waitingLine } from "../app/learn/outbox";

const app = join(dirname(fileURLToPath(import.meta.url)), "..", "app");

/** Every sentence the app asks to have translated, read from the sources. */
function keysInUse(): Set<string> {
  const files: string[] = [];
  (function walk(d: string) {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f) && !p.includes("/i18n/")) files.push(p);
    }
  })(app);
  const keys = new Set<string>();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\btx?\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(JSON.parse(`"${m[1]}"`));
  }
  // Lists whose items pass through t() one by one.
  const home = readFileSync(join(app, "page.tsx"), "utf8");
  for (const m of home.matchAll(/^\s+"([^"]+)",?$/gm)) keys.add(m[1]);
  for (const m of home.matchAll(/\["[^"]+", "([^"]+)"\]/g)) keys.add(m[1]);
  for (const m of home.matchAll(/\["([A-Z][a-z]+)", \d+\]/g)) keys.add(m[1]);
  for (const m of home.matchAll(/\{\["([^\]]+)"\]\.map/g)) for (const k of m[1].split('", "')) keys.add(k);
  for (const h of HEADLINES) {
    keys.add(h.headline);
    keys.add(h.sub);
  }
  for (const label of ["New friend", "Study buddy", "Trusted guide", "Old friend"]) keys.add(label);
  keys.add(waitingLine(1));
  keys.add("{n} messages are waiting for the connection. They send themselves when you are back online.");
  return keys;
}

const tokens = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const codes = (Object.keys(LOCALES) as LocaleCode[]).filter((c) => c !== "en");
const headlineKeys = new Set(HEADLINES.map((h) => h.headline));

describe("the app's own words in other languages", () => {
  it("picks the family's choice first, then the teaching language, then the browser, only among what is allowed", () => {
    const allowed = ["en", "fr", "ar"];
    expect(pickLanguage({ stored: "fr", teaching: "ar", browser: "es", allowed })).toBe("fr");
    expect(pickLanguage({ stored: null, teaching: "ar", browser: "fr-CA", allowed })).toBe("ar");
    expect(pickLanguage({ stored: null, teaching: "sw", browser: "fr-CA", allowed })).toBe("fr");
    expect(pickLanguage({ stored: null, teaching: "sw", browser: "hi-IN", allowed })).toBe("en");
    expect(pickLanguage({ stored: "pt", teaching: null, browser: null, allowed })).toBe("en");
  });

  it("never offers a draft to a family, and offers every draft to a reviewer", () => {
    const families = available(false);
    expect(families).toContain("en");
    for (const c of families) expect(c === "en" || LOCALES[c].reviewed).toBe(true);
    expect(available(true)).toEqual(Object.keys(LOCALES));
  });

  it("fills the tokens and leaves the rest alone", () => {
    expect(fill("Call {name}", { name: "Bisi" })).toBe("Call Bisi");
    expect(fill("{tutor} sees {tutor}", { tutor: "Amara" })).toBe("Amara sees Amara");
    expect(fill("Become expert at {anything}.")).toBe("Become expert at {anything}.");
    expect(waitingLine(3)).toBe("3 messages are waiting for the connection. They send themselves when you are back online.");
  });

  for (const code of codes) {
    describe(`${LOCALES[code].native} (${code})`, async () => {
      const dict = await LOCALES[code].load();
      const used = keysInUse();

      it("translates every sentence the app uses, and nothing the app no longer uses", () => {
        const missing = [...used].filter((k) => !(k in dict));
        const stale = Object.keys(dict).filter((k) => !used.has(k) && !["Language", "draft"].includes(k));
        expect(missing, `missing: ${missing.join(" | ")}`).toEqual([]);
        expect(stale, `stale: ${stale.join(" | ")}`).toEqual([]);
      });

      it("keeps every token the sentence fills in, and highlights something in every headline", () => {
        for (const [key, value] of Object.entries(dict)) {
          if (headlineKeys.has(key)) expect(value, key).toMatch(/\{[^}]+\}/);
          else expect(tokens(value), key).toBe(tokens(key));
        }
      });

      it("has no empty lines, no untranslated long sentences, and no em dashes", () => {
        for (const [key, value] of Object.entries(dict)) {
          expect(value.trim().length, key).toBeGreaterThan(0);
          expect(value, key).not.toContain("—");
          if (key.length > 25) expect(value, key).not.toBe(key);
        }
      });
    });
  }
});
