import type { ModerationProvider, ModerationVerdict } from "../types.js";

/**
 * Deterministic first-line safety filter: zero cost, zero latency, runs on
 * every message no matter which premium moderator is configured. Patterns are
 * deliberately conservative — a tutor session should never contain any of
 * this, so false positives are cheap and false negatives are expensive.
 *
 * This is a floor, not a ceiling: the `anthropic` provider layers a
 * classifier on top for everything rules can't catch.
 */

interface Rule {
  category: string;
  severity: "concern" | "danger";
  pattern: RegExp;
}

const RULES: Rule[] = [
  // A child in danger — highest priority, always alert a guardian.
  {
    category: "self-harm",
    severity: "danger",
    pattern:
      /\b(kill(ing)? myself|hurt(ing)? myself|end(ing)? my life|suicide|self[- ]?harm|cutting myself|want(ing)? to die)\b/i,
  },
  {
    category: "abuse-disclosure",
    severity: "danger",
    pattern: /\b(hits? me|beats? me|touch(es|ed|ing)? me (weird|badly|wrong)|abus(es|ing|ed) me|afraid of (my|going) home)\b/i,
  },
  // Grooming-adjacent: attempts to move contact off-platform or extract PII.
  {
    category: "contact-exchange",
    severity: "danger",
    pattern:
      /\b(what('?s| is) your (address|phone|number)|send (me )?(a )?(photo|picture) of (you|yourself)|meet (me|up) (in person|somewhere)|don'?t tell your (parents|mum|mom|dad))\b/i,
  },
  {
    category: "pii",
    severity: "concern",
    pattern:
      /\b(my (home )?address is|my phone number is|my password is|\d{1,4}\s+\w+\s+(street|avenue|road|close|crescent)\b)/i,
  },
  {
    category: "sexual-content",
    severity: "danger",
    pattern: /\b(sex|porn|nude|naked (photo|picture|pic)s?|nudes)\b/i,
  },
  {
    category: "violence",
    severity: "concern",
    pattern: /\b(how to (make|build) (a )?(bomb|gun|weapon)|kill (him|her|them|someone)|shoot up)\b/i,
  },
  // Jailbreak attempts against the tutor persona.
  {
    category: "jailbreak",
    severity: "concern",
    pattern:
      /\b(ignore (all |your |previous |the )+(instructions|rules)|you are no longer|pretend (you'?re|to be) (not )?(an? )?(ai|tutor)|system prompt|developer mode|DAN mode|forget (everything|(all |your |the )*(rules|instructions))|act as (an? )?(unrestricted|uncensored|jailbroken)|repeat (your|the) (instructions|prompt)|what (are|were) your instructions|roleplay as)\b/i,
  },
];

/**
 * Evasion-resistant views of the text. The patterns run against every view,
 * so writing "k!ll myself", "kiiiill myself", or "k i l l m y s e l f" lands
 * on the same rule as the plain words. Views are additive: the raw text is
 * always checked too, so normalization can only widen the net, never let
 * something through that plain matching would have caught.
 */
function viewsOf(text: string): string[] {
  // Zero-width characters and NFKC fold homoglyph tricks (ｋｉｌｌ, ᴋɪʟʟ partly)
  // before anything else looks at the text.
  const base = text.normalize("NFKC").replace(/[\u200b-\u200f\u2060\ufeff\u00ad]/g, "");
  const views = [text, base];

  // Leetspeak: digits and symbols standing in for letters, only mapped when
  // the character sits inside a word so "route 66" stays a route.
  const leet = base.replace(/[013457$@!|]/g, (ch, i) => {
    const table: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", $: "s", "@": "a", "!": "i", "|": "l" };
    // A leet character next to a letter OR another leet character sits
    // inside a word ("addre55"); a lone digit in "route 66" does not.
    const wordish = /[a-z013457$@!|]/i;
    const before = base[i - 1] ?? " ";
    const after = base[i + 1] ?? " ";
    return wordish.test(before) || wordish.test(after) ? table[ch] : ch;
  });
  if (leet !== base) views.push(leet);

  // Stretched letters: "kiiiill" collapses to "kill" (double letters kept,
  // so "cutting" survives as itself).
  const unstretched = base.replace(/([a-z])\1{2,}/gi, "$1");
  if (unstretched !== base) views.push(unstretched);

  // Spaced-out letters: a run of single letters ("k i l l  m y s e l f")
  // reads as evasion, never as prose; the run is joined and word breaks are
  // guessed at by re-inserting a space before known standalone words.
  if (/\b(?:[a-z] ){3,}[a-z]\b/i.test(base)) {
    const joined = base.replace(/\b((?:[a-z] ){3,}[a-z])\b/gi, (run) => run.replace(/ /g, ""));
    views.push(joined);
    // "killmyself" needs a seam for \b patterns; offer a seamed view too.
    views.push(joined.replace(/(myself|my life|me|you|yourself)/gi, " $1 "));
  }
  return views;
}

export class RulesModerationProvider implements ModerationProvider {
  readonly name = "rules";

  async moderate(text: string): Promise<ModerationVerdict> {
    const categories: string[] = [];
    let severity: ModerationVerdict["severity"] = "none";
    const views = viewsOf(text);
    for (const rule of RULES) {
      if (views.some((view) => rule.pattern.test(view))) {
        categories.push(rule.category);
        if (rule.severity === "danger") severity = "danger";
        else if (severity === "none") severity = "concern";
      }
    }
    return { flagged: categories.length > 0, categories, severity };
  }
}
