# Funding asks — the money map

A running list of everything that needs money, captured as it surfaced
during the build so the pitch decks (investors and grant-makers) can draw
on it directly. Nothing here is spending we have made; it is the case for
what capital unlocks.

**The discipline to lead with:** Dingba runs today at near-zero marginal
cost. The AI brain, speech-to-text, text-to-speech and maths checker are
all open-source models self-hosted on hardware we already pay for; the
only sanctioned paid API is Anthropic moderation, used sparingly for
child-safety. The platform is live, tested end to end, and works now.
Every ask below buys *scale, reach, or polish* on a product that already
functions — not a bet on whether it can be built.

Frame each ask two ways: for **investors**, as growth and moat; for
**grant-makers**, as access, equity, and child welfare (a global build,
never one exam board — House rule 9).

---

## One-time / capital

### The living persona — art and photoreal presence
Our moat is a tutor that feels alive. Today it is expressive vector art
(free, ships on any phone, any race, ages with the child, bonds over
time). Two upgrades need money:
- **Illustrated character cast** — commission a professional illustrator
  to paint over the existing five characters; we rig their drawings onto
  the animation engine we already built. One-time art cost.
- **Real-time photoreal / animated face** — a GPU-backed avatar service so
  the tutor has a lifelike face. Needs GPU compute plus per-minute
  streaming fees (see recurring). The viseme seam is already in the code,
  so this is a vendor swap, not a rebuild. This is the headline
  "investor-funded" item; it should not eat pre-funding runway.

### A bigger, dedicated AI brain
Today the brain shares one box with other products and runs a small model
(Phi-3.5-mini) so it fits. Launch needs a **dedicated GPU box running the
7B (or larger) model** for markedly better teaching quality. In the code
this is a model-file swap plus three URL changes; the cost is the
hardware.

### Nigerian and African-language voices
Go-ahead plus any recording/licensing to add first-language voices, so a
child learns in the language they think in. Direct equity/access story for
grant-makers.

## Recurring / operating

- **GPU compute + streaming fees** for the photoreal avatar, once adopted
  (per-minute, scales with usage).
- **Model-hosting scale** — more inference boxes as concurrent learners
  grow; the request queue already protects quality under load, but volume
  needs capacity.
- **Anthropic moderation API** — the one paid API, for child-safety
  screening; cost grows with message volume.
- **Infrastructure scale** — database, backups, and the Railway app tier
  as users grow (we already hit the custom-domain limit on the current
  plan; a static outbound IP for locking the brain doors is also a
  paid-tier feature).
- **Payment processing fees** — Paystack/Stripe percentages (offset by
  revenue, list for completeness).

## App stores (browser AND app)
- **Developer accounts:** Google Play (one-time registration fee) and
  Apple Developer Program (annual fee). The founder holds both; no AI does.
- **A Mac for iOS builds** (or a hosted Mac build service): Apple only
  allows App Store builds from Xcode on macOS. Android builds run anywhere.
- **Store assets:** screenshots per device size, a 1024px icon, splash art,
  feature graphic; folds into the character-art commission.
- **Children's-app compliance:** Play's Families policy and Apple's Kids
  category require a parental gate, no third-party ads, and completed data-
  safety / privacy-nutrition forms; the legal review below covers it.

## Non-engineering, still needs budget

- **Legal** — a lawyer to review /terms and /privacy: children's data
  rules, AI-disclosure rules, and the care-call feature (it stores a
  trusted adult's phone number). Do before real children use it.
- **Content breadth** — commissioning more verified curriculum across more
  subjects, boards and levels as we expand markets.
- **Go-to-market** — WhatsApp Business presence, character/brand art for
  marketing, launch-market outreach (e.g. an NCAIR introduction).

---

## Quick table for a deck slide

| Ask | Type | Buys |
| --- | --- | --- |
| Illustrated character art | one-time | a beloved, ownable cast |
| Photoreal/animated avatar | capital + recurring | the "feels human" moat |
| Dedicated 7B GPU box | capital | markedly better teaching |
| African-language voices | one-time | learn in your own language |
| GPU/model hosting at scale | recurring | serve many learners at once |
| Moderation API at scale | recurring | keep every child safe |
| Legal review | one-time | launch to children, compliantly |
| Curriculum breadth | one-time | more subjects, more markets |
| Go-to-market | one-time | reach the first cohorts |
| App store accounts + Mac build | one-time + annual | Dingba in Google Play and the App Store |

Keep this file updated as new money-needing items surface in the build.
