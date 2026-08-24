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

An affordable personal AI tutor platform — persistent tutor characters
(Amara/Kofi/Juno) with live sessions, voice, cross-session memory, verified
math, family accounts, safety layer, and business wiring. Self-hosted AI
stack, near-zero API spend by design. Competitor context, licensing rules,
and market research: `docs/RESEARCH.md`. Money model: `docs/MONETIZATION.md`.
Deploy guide (Railway + Contabo + mailcow): `deploy/DEPLOY.md`.
Founder idea parking lot (a living protocol — keep using it): `IDEAS.md`.

## State: what is DONE and VERIFIED

See the honesty table in `README.md` — it is the single source of truth and
you MUST keep it updated. Summary: Sprints 1–6a complete + 6b core
(billing, email verification). 54 API tests + 7 gateway tests + 7 mathcheck
pytest tests pass. The stack was live-verified
against Postgres 16 and a real Qwen 0.5B via llama.cpp (protocol-identical
to production). Billing (Stripe/Paystack), password reset, WhatsApp, and
full-duplex voice are NOT built (Sprint 6b+ / Phase 2 — see README roadmap).

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
7. **The name**: undecided. Everything is deliberately name-agnostic
   ("AI Tutor" placeholder). Verified-available candidates (as of 2026-08):
   Wibba, Tutorae, Nutor, Dinbo — founder is still choosing; may pick a warm
   human name (the Claude playbook). When they decide: single rebrand commit.
8. **Commit style**: imperative summary + honest body listing what was
   verified vs pending. Small, complete sprints.

## Architecture in 60 seconds

pnpm monorepo. `packages/ai-gateway` = provider abstraction (chat/planner/
premiumChat/stt/tts/vision/moderation) — config-driven via env, NOTHING
outside it may know which engine runs. `packages/db` = drizzle schema +
SQL migrations 0000–0005 (apply in order). `apps/api` = Fastify: sessions
(SSE streaming), voice turns, practice with SymPy verdicts + misconception
diagnosis, exam mode, auth (bcrypt + hashed tokens), family/org accounts,
entitlements (config/plans.json), usage metering, API keys, live-class
invites, safety gate + incidents, parent recap emails (mailcow SMTP).
`apps/web` = Next.js student app + account/dashboard + credits (KaTeX,
avatar v0, push-to-talk). `services/mathcheck` = FastAPI + SymPy (hardened).
`tools/curriculum/generate.py` = SymPy-verified problem-bank generator.
Mock providers let everything run with zero models installed.

## Next work, in order

1. ~~Push (step zero), then set up CI~~ DONE 2026-08-24: GitHub Actions
   (`.github/workflows/ci.yml`) runs typecheck + all three test suites on
   every push and PR.
2. ~~Sprint 6b core~~ BUILT 2026-08-24: Stripe/Paystack billing (checkout,
   signature-verified webhooks → plan flips, cancellation downgrade) and
   email verification. Needs live keys + a real checkout at deploy.
   Remaining 6b: study plans & scheduling, WhatsApp nudges,
   spaced-repetition warm-ups.
3. Deploy per `deploy/DEPLOY.md` (7B model minimum — 0.5B was only a
   protocol test; pedagogy quality demands the bigger model).
4. Phase 2: LiveKit full-duplex voice, whiteboard, homework camera, avatar
   v1, group voice classes, cartoon formats (IDEAS.md #001/#006).

Keep the energy: this project moves in decisive, fully-tested sprints with
honest reporting. The founder says "go" and means it.
