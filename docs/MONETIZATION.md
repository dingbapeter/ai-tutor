# Monetization Architecture — "Earned Inevitability"

The model to copy is Claude Code's: people pay premium monthly not for model
access but because the tool does real work, is embedded in their workflow,
and leaving costs them accumulated momentum. Formula:
**outcome + embeddedness + switching cost + metered scarcity.**

## The four locks

1. **Memory = switching cost.** Months of learner-model history make leaving
   feel like tutor amnesia. NEVER paywall memory itself — it's what makes
   everything else chargeable.
2. **Stakes = pricing power.** Premium owns everything with consequences:
   mock exams (WAEC/SAT/IGCSE), post-mortems, score trajectory reports,
   readiness verdicts. Anchor price against $40–60/hr human tutoring, never
   against other apps. Outcome data ("+X grades in Y months") converts this
   from software pricing to results pricing.
3. **Metered scarcity = compute.** Text is ~free → generous at every tier.
   Live voice minutes + homework-camera solves cost real compute → the
   metered dial. Premium also gets the frontier brain: planner/chat routed
   to a stronger model per plan (the gateway already supports this).
4. **Institutions buy compliance + visibility.** The safety layer, incident
   logs, mastery tracking = the B2B product. Teacher dashboards (class-wide
   mastery gaps), auditable logs, curriculum alignment, seat management,
   SLAs. Schools have no compliant alternative at our price point.

## Consumer tier sketch

| Tier | Price band | Gets |
|---|---|---|
| Free | 0 | Text tutoring (daily cap), 1 subject, full memory, taste of voice |
| Plus | ~$10–15 | Unlimited text, healthy voice minutes, all subjects, stories, parent dashboard |
| Premium | ~$25–40 | Abundant voice, homework camera, exam mode + reports, frontier-model routing, family seats, priority latency, (later) human-escalation minutes |

## API products (the Twilio move)

Three of four already exist as internal services:

1. **Tutor-as-a-Service** — sessions/chat/voice/memory by API key; metered
   per session-minute. For edtechs, publishers, white-label.
2. **Pedagogy API** — answer in → verified verdict + misconception diagnosis
   + mastery update out. Nobody else sells "why it's wrong."
3. **Kid-Safety API** — the moderation cascade + incident taxonomy as a
   standalone service for any children's product. Trojan horse: makes us the
   safety standard.
4. **Character API** (later) — persona + voice + memory as embeddable SDK.

API customers are the deepest lock: products built on our endpoints
re-architect to leave. Infrastructure gravity.

## Engineering roadmap (wiring)

- [ ] Usage metering: voice-seconds, messages, camera-solves, tokens per
      account (table + middleware). Prerequisite for everything.
- [ ] Entitlements engine: plan → limits enforced in routes (voice/day,
      seats, model routing, exam-mode). Config-driven.
- [ ] Org accounts: school → seats → students; teacher dashboard
      (generalized parent dashboard); CSV roster import; org incident view.
- [ ] API keys: scoped, quota'd, metered separately from user tokens.
- [ ] Premium model routing: per-plan provider selection via gateway config.
- [ ] Exam mode: timed mocks from exam packs (timing metadata exists),
      post-mortem session, score reports.
- [ ] Billing (deploy-gated): Stripe/Paystack — seats for orgs, metered for
      API, subscriptions for consumers.

Pure-code items (metering, entitlements, org accounts, API keys, exam mode)
are buildable pre-deploy. Billing lands with Sprint 6 env vars.

## Calibration

"No choice" is earned inevitability, not coercion: the child asks for the
tutor by name, the exam score moves, the teacher's gap closes, the partner
app depends on the endpoint. Wire those four and pricing power follows.
