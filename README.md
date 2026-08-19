# AI Tutor

Affordable personal AI tutor platform — a persistent tutor **character** that runs live one-on-one sessions. Self-hosted AI stack, zero API spend by design.

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
| Parent dashboard (mastery bars, session recaps) | ✅ built + live-verified |
| Payments, parent dashboard, WhatsApp | ❌ later sprints |

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
- [ ] Sprint 5: payments (Stripe/Paystack), study plans & scheduling, WhatsApp
      nudges, spaced-repetition warm-ups
- [ ] Phase 2: full-duplex live voice (LiveKit self-hosted), whiteboard, homework
      camera, image generation for cartoon panels (IDEAS.md #001 full version)

See `deploy/DEPLOY.md` for the Railway + Contabo deployment guide and
`IDEAS.md` for the founder idea parking lot.
