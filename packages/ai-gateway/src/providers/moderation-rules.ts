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
      /\b(ignore (all|your|previous) (instructions|rules)|you are no longer|pretend (you'?re|to be) (not )?(an? )?(ai|tutor)|system prompt|developer mode|DAN mode)\b/i,
  },
];

export class RulesModerationProvider implements ModerationProvider {
  readonly name = "rules";

  async moderate(text: string): Promise<ModerationVerdict> {
    const categories: string[] = [];
    let severity: ModerationVerdict["severity"] = "none";
    for (const rule of RULES) {
      if (rule.pattern.test(text)) {
        categories.push(rule.category);
        if (rule.severity === "danger") severity = "danger";
        else if (severity === "none") severity = "concern";
      }
    }
    return { flagged: categories.length > 0, categories, severity };
  }
}
