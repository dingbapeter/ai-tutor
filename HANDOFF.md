# HANDOFF — Read This First

You are picking up a complete, working build. The founder (Dingba Peter
Williams, dingbapeter@gmail.com) built this over many sprints with a prior
Claude session that could NOT push to this repo (it was bound to a different
repository at creation — that was the mistake; this session exists to fix it).
Your first job is to push; your standing job is to keep building at the same
standard.

## Step zero — DONE (2026-08-24)

The full 17-commit history was pushed to github.com/dingbapeter/ai-tutor
(the one sanctioned force-push, replacing the remote's throwaway initial
commit). Standing rule from here: every piece of work ends with a commit AND
a push in the same step; never accumulate unpushed work; NEVER force-push.

## What this is

**Dingba (dingba.ai) — Your Personal A.I Tutor.** An affordable personal AI
tutor platform for all of life's learning — persistent tutor characters
(Amara/Kofi/Juno) with live sessions, voice, cross-session memory, verified
math, family accounts, safety layer, and business wiring. Self-hosted AI
stack, near-zero API spend by design. Competitor context, licensing rules,
and market research: `docs/RESEARCH.md`. Money model: `docs/MONETIZATION.md`.
Deploy guide (Railway + Contabo + mailcow): `deploy/DEPLOY.md`.
Founder idea parking lot (a living protocol — keep using it): `IDEAS.md`.

## State: what is DONE and VERIFIED

See the honesty table in `README.md` — it is the single source of truth and
you MUST keep it updated. Summary as of 2026-08-29: Sprints 1–29 complete.
On top of the original tutor stack (personas, voice, memory, verified math,
safety, billing, 91 languages) the platform now has: the Command Centre at
`/command` (RBAC with investors on the smallest capability surface, staff +
HR with an org chart, safety desk, platform controls that bite, audit trail,
CSV exports, the money ledger with failed payments and refunds), study plans
(deterministic weekly planner), plan-aware push reminders and a guardian
weekly digest (both cron-triggered), lessons (structured briefs the
personas deliver, problems only from the verified bank), sessions that
survive restarts and scale across instances (migration 0014), observability
(Ops tab + Prometheus at /admin/metrics), a load driver with honest numbers
in docs/PERF.md, a pedagogy eval harness (`pnpm evals`, binding against the
real model at deploy), and an evasion-hardened safety floor. 201 TypeScript
+ 7 Python tests (after the sprint-29 stub sweep, which closed the mock
exam's rubric-pack scoring hole), all CI-green on branch
`claude/ai-tutor-continuation-dwrohy`. Register items B, D, I and the
machine half of J are closed. WhatsApp and full-duplex LiveKit voice/video
are NOT built: WhatsApp needs credentials, LiveKit needs the founder's
interface code.

## House rules (the founder's standing instructions)

1. **Zero API spend by default.** Self-host open source; use paid APIs only
   where licenses forbid extraction (then credit them). The one sanctioned
   paid API: Claude for kid-safety moderation (`AI_MODERATION_PROVIDER=anthropic`).
2. **Licensing rulebook** in `docs/RESEARCH.md` governs every adoption.
   Never embed non-commercial-licensed work. Credit everything with joy:
   `config/credits.json` → `/credits` + the web credits page.
3. **No "done" without proof.** Tests green (`pnpm test`, `pytest`), builds
   clean, and live-verify anything critical. The founder explicitly refuses
   "bugs, stubs and toasts" — the honesty table exists so no one is fooled,
   including us.
4. **Park founder ideas** in `IDEAS.md` with date, analysis, and a
   bring-back trigger; graduate them when shipped.
5. **Safety is non-negotiable.** The moderation gate runs on every student
   message. Never weaken it; extend it. Kids' product = COPPA-class care.
6. **Never put model names/identifiers in commits, code, or docs pushed to
   the repo** beyond what already exists.
7. **The name: DINGBA.AI — settled 2026-08-24, rebrand landed.** Domain
   dingba.ai is founder-owned; tagline "Your Personal A.I Tutor". Brand
   accent: indigo #6C5CE7. Tutor characters keep their own names; Dingba
   is the platform and the brain. User-facing copy follows the no-AI-tells
   rule in `docs/VISION-DINGBA.md` (no em dashes, no assistant-isms).
8. **Commit style**: imperative summary + honest body listing what was
   verified vs pending. Small, complete sprints.
9. **This is a global build.** Founder's standing instruction (2026-08-28):
   resist the temptation to build for any one exam body or country. The
   market is the world: Africa, Europe, America and beyond as peers. Local
   audience tests come first, but curriculum, copy, currencies, names and
   defaults must never assume one region. Deepen curriculum wide (SAT,
   GCSE, IB, CFA, visa prep, WAEC/JAMB alongside, never instead).

## Architecture in 60 seconds

pnpm monorepo. `packages/ai-gateway` = provider abstraction (chat/planner/
premiumChat/stt/tts/vision/moderation) — config-driven via env, NOTHING
outside it may know which engine runs. `packages/db` = drizzle schema +
SQL migrations 0000–0009 (apply in order). `apps/api` = Fastify: sessions
(SSE streaming), voice turns, practice with SymPy verdicts + misconception
diagnosis, exam mode, auth (bcrypt + hashed tokens), family/org accounts,
entitlements (config/plans.json), usage metering, API keys, live-class
invites, safety gate + incidents, parent recap emails (mailcow SMTP).
`apps/web` = Next.js student app + account/dashboard + credits (KaTeX,
avatar v0, push-to-talk). `services/mathcheck` = FastAPI + SymPy (hardened).
`tools/curriculum/generate.py` = SymPy-verified problem-bank generator.
Mock providers let everything run with zero models installed.

## Next work, in order

**⭐ Founder's own pending work (every env var, every action only they can
take): `docs/FOUNDER-CHECKLIST.md`.**

**⭐ READ `docs/VISION-DINGBA.md` FIRST** — the founder's 2026-08-24 product
vision (the Dingba Brain, universal input, vision/voice tutor, adaptive
engine, diagnostic assessment) + homepage design template. It names the
product (Dingba.AI), supersedes the old UI, and sets the sprint sequence:
rebrand → new homepage → Brain v1 → adaptive engine v1 (the scoped
warm-ups/scheduling work folds in here) → Ask/Show Dingba. The founder's
infrastructure (Contabo, SMTP, etc.) is confirmed available.

1. ~~CI~~ DONE. ~~Sprint 6b core~~ DONE. ~~Command Centre~~ DONE
   (15–19). ~~Plans, reminders, digest, lessons~~ DONE (20–23).
   ~~Session survival, observability, load, evals, safety floor~~ DONE
   (24–28). ~~Full-platform stub sweep~~ DONE (29).
   ~~Curriculum depth: 272-problem verified bank, spread sampling~~ DONE (31).
   ~~AI request queue (32); rubric mock exams (33); conversation-mode voice (34); school portal (35); growth analytics (36)~~ DONE.
   Pile 2 (the founder's 'build the entire list') is complete: 31 through 36.
2. NEXT: the founder deploys per `deploy/DEPLOY.md` and
   `docs/FOUNDER-CHECKLIST.md` (migrations through 0013,
   COMMAND_OWNER_EMAILS, plan prices, two cron curls for
   /admin/nudge-plans and /admin/weekly-digest, 7B model minimum).
3. THEN: judge everything marked "quality rides the real model" against the
   deployed 7B (greeting, attunement, lesson narration, vision
   transcription) and iterate on prompts, not plumbing.
4. Phase 2, blocked on the founder: LiveKit full-duplex voice/video (needs
   their interface code), WhatsApp nudges (needs Business API credentials).
   Parked in IDEAS.md: whiteboard, avatar v1, cartoon formats (#001/#006).

Keep the energy: this project moves in decisive, fully-tested sprints with
honest reporting. The founder says "go" and means it.
