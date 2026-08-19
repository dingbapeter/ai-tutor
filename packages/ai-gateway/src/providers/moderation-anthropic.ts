import Anthropic from "@anthropic-ai/sdk";
import type { ModerationProvider, ModerationVerdict } from "../types.js";
import { RulesModerationProvider } from "./moderation-rules.js";

const SYSTEM = `You are the safety classifier for a children's tutoring platform. Classify the given message from a tutoring session.

Categories (use only these): self-harm, abuse-disclosure, contact-exchange, pii, sexual-content, violence, bullying, jailbreak, drugs, hate.

Severity:
- "none": normal tutoring content, however off-topic.
- "concern": inappropriate for a tutoring session, or a mild policy probe.
- "danger": a child may be at risk (self-harm signals, abuse disclosure, grooming patterns, sexual content involving the student) — a guardian will be alerted.

Respond with ONLY a JSON object, no other text:
{"flagged": boolean, "categories": string[], "severity": "none"|"concern"|"danger"}`;

/**
 * Premium moderation: the free rules engine runs first (deterministic floor),
 * then Claude classifies anything the rules didn't already flag — catching
 * phrasing, context, and languages that regexes never will.
 *
 * Fails SAFE-OPEN by design for availability (a tutoring session shouldn't
 * die because the moderation API hiccuped) but the failure is logged loudly;
 * the rules verdict still applies regardless.
 */
export class AnthropicModerationProvider implements ModerationProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  private rules = new RulesModerationProvider();

  constructor(
    apiKey?: string,
    private model = process.env.ANTHROPIC_MODERATION_MODEL ?? "claude-opus-5",
  ) {
    this.client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  }

  async moderate(text: string, direction: "student" | "tutor"): Promise<ModerationVerdict> {
    const ruled = await this.rules.moderate(text);
    if (ruled.severity === "danger") return ruled; // no API call needed

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 256,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `Message from the ${direction === "student" ? "student (a minor)" : "AI tutor"}:\n\n${text.slice(0, 4000)}`,
          },
        ],
      });
      const raw = response.content.find((b) => b.type === "text")?.text ?? "";
      const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as ModerationVerdict;
      // Merge with the rules verdict — the stricter of the two wins.
      const categories = [...new Set([...ruled.categories, ...(parsed.categories ?? [])])];
      const rank = { none: 0, concern: 1, danger: 2 } as const;
      const severity =
        rank[parsed.severity] >= rank[ruled.severity] ? parsed.severity : ruled.severity;
      return { flagged: ruled.flagged || Boolean(parsed.flagged), categories, severity };
    } catch (err) {
      console.error("[moderation] anthropic classifier unavailable, rules verdict applies:", err);
      return ruled;
    }
  }
}
