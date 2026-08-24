# Dingba — Your Personal A.I Tutor

**dingba.ai** — an affordable personal AI tutor for all of life's learning: a persistent tutor **character** that runs live one-on-one sessions, remembers you, and grows with you. Self-hosted AI stack, zero API spend by design.

## Architecture

```
apps/web        Next.js student app (tutor picker → live session → recap)
apps/api        Fastify API: sessions, SSE streaming chat, TTS voice notes
packages/
  ai-gateway    ★ Provider-abstraction layer. All AI goes through 4 interfaces:
                  chat / transcribe / speak / see. Engines chosen by env config.
  db            Drizzle schema + SQL migrations: learner model, knowledge graph,
                  mastery (FSRS-style), sessions, compressed memories
services/
  mathcheck     FastAPI + SymPy. Deterministic verification of every checkable
                  answer — the LLM never gets final say on math correctness.
curriculum/     Content packs (skills graph + problems + misconception library):
                  math-ms, exam-prep, language. Engine is subject-agnostic.
config/         Tutor personas (name, personality, voice, avatar rig)
```

### The non-negotiable rule

Nothing outside `packages/ai-gateway` may know which AI engine is in use.
Swapping self-hosted → paid (or routing one capability — e.g. lesson planning —
to a stronger model) is a change to `.env`, never a rewrite.

## Run it now (no models, no DB needed)

```bash
pnpm install
cp .env.example .env          # defaults to mock providers
pnpm dev:api                  # :4000
pnpm dev:web                  # :3000  → open, pick a tutor, chat end-to-end
```

## Run it for real (self-hosted, $0 API spend)

| Capability | Engine | Where |
|---|---|---|
| Chat LLM | llama.cpp `llama-server` / vLLM / Ollama with Qwen/Llama GGUF | Contabo |
| STT | faster-whisper-server (OpenAI-compatible) | Contabo |
| TTS | kokoro-fastapi (Kokoro-82M, Apache) or Piper | Contabo |
| Vision | llama.cpp with a Qwen-VL GGUF | Contabo |
| Math check | `services/mathcheck` (SymPy) | Contabo/Railway |
| App + DB | web, api, Postgres, Redis | Railway |
| Email | mailcow (existing) | Contabo |

```bash
# .env
AI_CHAT_PROVIDER=llamacpp
AI_STT_PROVIDER=whisper
AI_TTS_PROVIDER=kokoro
AI_VISION_PROVIDER=llamacpp
LLAMACPP_URL=http://<contabo-host>:8080
...
```

```bash
# mathcheck
cd services/mathcheck && pip install -r requirements.txt && uvicorn main:app --port 8090
```

## What's verified vs. what's pending

Honesty table — updated whenever it changes. "Verified" means exercised by the
automated test suite (`pnpm test`, `pytest`) or a live run, not just written.

| Piece | Status |
|---|---|
| Socratic session loop (SSE streaming, history, recovery on provider failure) | ✅ tested (12 API integration tests) |
| llama.cpp adapter against a REAL model (Qwen 2.5 0.5B, full session) | ✅ live-verified end-to-end |
| Adapter wire protocols (llama.cpp SSE incl. split chunks, whisper, kokoro) | ✅ tested (7 protocol tests) |
| Postgres persistence + cross-session memory | ✅ live-verified against Postgres 16 |
| Memory resilience with weak/refusing models (deterministic factual line) | ✅ regression-tested |
| SymPy verification incl. hostile input (exponent bombs, garbage) | ✅ tested (7 pytest cases) |
| Family-scoped student identity | ✅ tested |
| Rate limiting, input validation, payload caps, graceful shutdown | ✅ in place |
| Parent email (mailcow SMTP) | ⚠️ code-complete; needs a live SMTP run at deploy |
| Whisper STT / Kokoro TTS against real engines | ⚠️ protocol-tested; live run happens on Contabo at deploy |
| Push-to-talk voice turn (audio→STT→reply→TTS, one round trip) | ✅ tested + live-verified vs real LLM |
| Voice-note playback, avatar v0 (blink/talk states), practice UI, format chips | ✅ built; web build verified |
| Learning formats (story/comic/song) endpoint | ✅ tested (model compliance depends on deploy model size) |
| Auth: register/login (bcrypt + hashed tokens), family profiles, ownership | ✅ tested + live-verified on Postgres |
| Guest→account upgrade (claiming a parent email adopts guest-era students) | ✅ live-verified |
| Parent dashboard (mastery bars, session recaps, flagged moments) | ✅ built + live-verified |
| Safety gate: rules engine on every message, canned safe replies, incident log, guardian alerts | ✅ tested (danger/jailbreak/normal paths) |
| Claude API moderation adapter (rules floor + classifier, fail-safe merge) | ⚠️ code-complete; needs ANTHROPIC_API_KEY at deploy |
| Generated curriculum: 58 SymPy-verified problems with derived misconceptions | ✅ verified at build time |
| Credits system (/credits + page), KaTeX math rendering, TTS cache | ✅ built |
| Usage metering + plan entitlements (daily caps → 402 upsell, family seats) | ✅ tested + live-verified |
| Exam mode: timed mocks, sealed verdicts, post-mortem, premium-gated | ✅ tested + live-verified |
| Org/school accounts: seats, roster import, teacher dashboard | ✅ tested |
| B2B API keys (scoped, hashed, quota'd, metered) + Tutor-as-a-Service sessions | ✅ tested + live-verified |
| Premium-brain routing per plan (gateway slot) | ✅ wired; point AI_PREMIUM_CHAT_PROVIDER at a bigger model at deploy |
| Live classes: invite codes, guest class pass → upsell, per-member metering | ✅ tested + live-verified; full UI (invite card, join-by-code, speaker mode). Voice turns are host-only for now |
| Exam mode UI (start, lock-in answers, finish → score + post-mortem in chat) | ✅ built; web build verified |
| Usage meter on the account page (plan, today's messages/voice vs limits) | ✅ built + live-verified |
| API-key quota enforced mid-session (not just at creation); live-session TTL sweep | ✅ regression-tested / in place |
| PWA (manifest, icons, offline shell) + web push notifications (VAPID) | ✅ built; VAPID keys + real-device check at deploy |
| Password reset, logout-everywhere, 30-day token expiry, account deletion (GDPR path) | ✅ tested |
| Guardian transcript view, study streaks, placement-check onboarding, copy button | ✅ tested / built |
| Terms & Privacy pages + registration consent | ✅ drafted (needs counsel before launch) |
| Rolling 24h allowances, per-IP guest cap, error webhook, backup script | ✅ tested / in place |
| GitHub Actions CI (typecheck + all three suites on every push/PR) | ✅ run green on GitHub (2026-08-24) |
| All-of-life verticals: visa interview prep, CFA/ACCA foundations, career coaching packs + adult mentor personas (Nia, Obi) | ✅ tested (packs load, adult session end-to-end, numerics SymPy-verified incl. float-exactness) |
| Billing: Stripe + Paystack checkout, signature-verified webhooks → plan flips, cancellation downgrade, /me/billing, upgrade buttons | ✅ tested (17 cases incl. real HMAC schemes, tamper + replay rejection); ⚠ needs live keys + a real checkout at deploy — /admin/plan still bridges |
| Email verification at signup (token email, /verify page, resend, banner) | ✅ tested; email delivery goes live with SMTP at deploy |
| WhatsApp, study plans & scheduling | ❌ later sprints |

## Roadmap

- [x] Sprint 1: monorepo, ai-gateway, DB schema, end-to-end Socratic text loop
- [x] Sprint 2: Postgres persistence, learner memory read/write across sessions,
      SymPy verification in the live practice loop, parent recap email via
      mailcow (SMTP), deployment kit (Dockerfiles + Contabo compose + DEPLOY.md)
- [x] Sprint 3: TTS voice notes in UI, turn-based voice (push-to-talk), avatar v0
      (SVG rig: idle blink, talking mouth, per-persona palette), practice mode UI,
      "explain as story/comic/song" formats (IDEAS.md #001 text slice)
- [x] Sprint 4: accounts & auth (register/login, bearer tokens, bcrypt), family
      student profiles with ownership enforcement, guest→account upgrade path,
      parent dashboard (skill mastery bars + recent session recaps)
- [x] Sprint 5: safety & moderation layer (rules engine + optional Claude API
      classifier, incident log, guardian alert emails, dashboard visibility),
      curriculum generator (SymPy-verified problem banks with derived
      misconceptions), visible credits (/credits + ATTRIBUTIONS.md), KaTeX
      math rendering, TTS caching
- [x] Sprint 6a (the money wiring): usage metering, plan entitlements with
      daily allowances + 402 upsells, family seat caps, org/school accounts
      (seats, roster, teacher dashboard), scoped B2B API keys with monthly
      quotas, exam mode (timed mocks + post-mortem, premium-gated),
      premium-brain routing, /me/usage, /admin/plan bridge
- [x] Sprint 6b core (2026-08-24): billing — Stripe/Paystack checkout,
      signature-verified webhooks flipping plans, cancellation downgrades,
      upgrade buttons (needs live keys at deploy); email verification
      (password reset shipped earlier in the blind-spot sprint)
- [ ] Sprint 6b remainder: study plans & scheduling, WhatsApp nudges,
      spaced-repetition warm-ups
- [ ] Phase 2: full-duplex live voice (LiveKit self-hosted), whiteboard, homework
      camera, image generation for cartoon panels (IDEAS.md #001 full version)

See `deploy/DEPLOY.md` for the Railway + Contabo deployment guide and
`IDEAS.md` for the founder idea parking lot.
