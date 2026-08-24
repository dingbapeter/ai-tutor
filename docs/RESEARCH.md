# Market & Open-Source Research (2026-08)

Founder-requested research: competitive landscape + the free/open-source stack
that keeps burn rate near zero. Rule of the house: anything we adopt gets
**extracted and self-hosted/embedded**, never hot-linked — which makes the
LICENSE of each piece a build decision, not a footnote.

## The licensing rulebook (read before adopting anything)

| License | Can we embed it in a commercial platform? |
|---|---|
| MIT / Apache-2.0 / BSD / ISC / OFL / CC0 | ✅ Yes, freely. Keep the copyright notice in a LICENSES file. |
| CC BY | ✅ Yes, with visible attribution. |
| CC BY-SA | ✅ Yes with attribution, but adapted *content* must stay BY-SA (fine for curriculum text; keep it in content packs, not code). |
| LGPL | ✅ Use as an unmodified library/service. Don't fork it into our code. |
| AGPL | ⚠️ Run it as a separate self-hosted service (fine). If we modify its source, we must publish the modifications. Never paste AGPL code into our proprietary app code. |
| Llama community license | ✅ Commercial use fine below 700M MAU. |
| CC BY-NC / GeoGebra Non-Commercial / BSL / "sustainable use" (n8n) / Coqui CPML | ❌ Not for us (we are commercial). Do not extract. Find the ✅ alternative. |

Maintain `LICENSES/` in the repo root with one file per adopted project.

## Is there a platform like ours?

Pieces of it exist; the combination does not (checked 2026-08):

- **Khanmigo (Khan Academy)** — strongest pedagogy brand; Socratic; ~free for
  students / $30/teacher/yr; efficacy studies (SRI 2025: 23% faster algebra
  mastery). No persistent character, not voice-first, no family/PPP focus.
- **Frontier-lab study modes** — ChatGPT Study Mode (free), Gemini Guided
  Learning, Claude Learning Mode. In 2026 the labs compete on pedagogy, not
  just capability. These commoditize *text Q&A tutoring* — they are exactly
  why our moat must be character + memory + voice + family + price, not chat.
- **Synthesis Tutor** — K-8, gamified critical thinking, family plan. Narrow
  scope, no live voice character.
- **Squirrel AI (China)** — serious adaptive engine (fine-grained knowledge
  components — validates our skills-graph approach). Center-based, China.
- **Character.AI** — persistent characters + voice calls at scale. Zero
  pedagogy, zero parent loop; proves the emotional mechanic works.
- **Studeo AI Avatar Tutor** — 3D avatar tutor app; closest single overlap.
  No evident family model, learner-model memory, or emerging-market pricing.
- **D-ID / HeyGen agents** — avatar tech vendors, not tutor products.
- **Globutor / Preply / GoStudent** — human marketplaces; our cost-structure
  attack unchanged.

**Nobody combines**: persistent character + live voice + verified pedagogy +
parent dashboard/family + PPP-affordable self-hosted cost floor + local
curricula. That's the lane. The free study modes close the window for generic
chat tutoring — speed matters.

## Open-source & free-content inventory (by platform function)

### Already adopted (in the build)
llama.cpp (MIT) · Qwen weights (Apache-2.0) · faster-whisper/whisper.cpp (MIT)
· Kokoro-82M (Apache-2.0) · Piper (MIT) · SymPy (BSD) · Fastify/Next/Drizzle
(MIT) · Postgres (PostgreSQL license) · bcryptjs (MIT).

### Models (the burn-rate core)
- **DeepSeek** (MIT) — strong reasoning; candidate planner-slot model.
- **Llama 3.x** (community) — fallback family.
- **Qwen-VL** (Apache) — homework-photo vision.
- **Sesame CSM-1B** (Apache) — conversational speech gen; watch for full-duplex.
- **Mozilla Common Voice** (CC0) — accent data for STT fine-tuning later.

### Realtime & media
- **LiveKit** (Apache) — full-duplex voice rooms (Phase 2 core).
- **coturn** (BSD) — TURN server.
- **Rhubarb Lip Sync** (MIT) — phoneme timings → avatar mouth.
- **Three.js / pixi.js** (MIT) — richer avatar rendering.
- **Rive runtime** (MIT runtime) — rigged 2D characters.

### Math & content rendering
- **KaTeX** (MIT) — render LaTeX in chat/whiteboard. (Near-term win: the
  real models already emit `\( x \)`-style math; render it.)
- **JSXGraph** (LGPL/MIT dual) — interactive graphs/geometry. ✅ (GeoGebra ❌ NC.)
- **Manim CE** (MIT) — precomputed explainer animations for curriculum packs.
- **Excalidraw** (MIT) — shared whiteboard. (tldraw ⚠️ watermark license.)

### Curriculum content (the grinding-work shortcut)
- **Siyavula textbooks** (CC BY) — full math/science secondary curriculum,
  African-market aligned. Flagship source for our packs. ✅ attribution.
- **Illustrative Mathematics K-12** (CC BY) — complete, highly-rated US math
  curriculum. ✅ attribution.
- **PhET simulations** (HTML5 sims CC BY) — interactive science sims that can
  be embedded. ✅ attribution.
- **Oak National Academy** (OGL v3) — UK-curriculum lessons; commercial use OK.
- **OpenStax** (⚠️ mixed: many titles CC BY ✅, some CC BY-NC-SA ❌) — check
  per title before extraction.
- **African Storybook / StoryWeaver / Global Digital Library** (CC BY) —
  multilingual early literacy; feeds story-format tutoring.
- **Wikipedia/Wiktionary** (CC BY-SA) — factual grounding; share-alike applies
  to adapted text.
- ❌ **CK-12, MIT OCW, most Khan content, EngageNY/Eureka** — NC licenses.

### Ops, analytics, growth (self-host on Contabo)
- **PostHog** (MIT core) — product analytics, funnels, retention (the metric
  that decides everything), feature flags, session replay.
- **GlitchTip** (MIT, Sentry-compatible) — error tracking. (Sentry ⚠️ BSL.)
- **Umami** (MIT) — lightweight web analytics.
- **Grafana + Prometheus** (AGPL/Apache) — infra + GPU monitoring.
- **Uptime Kuma** (MIT) — uptime/status page.
- **Listmonk** (AGPL, standalone) — parent newsletters via mailcow SMTP.
- **Chatwoot** (MIT) — support inbox (email/WhatsApp) when users arrive.
- **Metabase** (AGPL, standalone) — BI dashboards on Postgres.
- **SeaweedFS** (Apache) — object storage for session audio/artifacts.
  (MinIO AGPL is fine self-hosted too.)
- ❌ **n8n** (sustainable-use) — use plain code/cron instead.

### Assets
- **DiceBear** (MIT) — generated avatar variants.
- **OpenMoji / Twemoji** (CC BY) — emoji art.
- **Kenney.nl / OpenGameArt CC0** — gamification art & sounds.
- **Google Fonts** (OFL) — typography.
- **Freesound CC0** — UI sounds.

## Gap list (what we're still missing — build order)

1. **Safety & moderation layer** ← biggest gap for a kids' product: input/output
   filters, jailbreak defenses, concerning-disclosure flags to guardians,
   reviewable session logs. Non-negotiable before real children use it.
2. Password reset + email verification (mailcow templates).
3. Diagnostic onboarding (placement quiz seeds the knowledge graph).
4. Curriculum authoring pipeline (turn Siyavula/IM/PhET into packs at scale —
   this is where "content moat" gets built).
5. ~~CI (GitHub Actions: typecheck+tests on every push)~~ ✅ done 2026-08-24.
6. Observability (PostHog + GlitchTip self-hosted).
7. Backups (nightly pg_dump to SeaweedFS + offsite).
8. KaTeX rendering in chat; TTS audio caching (hash(text+voice) → SeaweedFS).
9. PWA packaging (installable, push notifications) before native apps.
10. i18n scaffolding; admin panel; model-eval harness for pedagogy regressions;
    ToS/privacy/COPPA-style consent docs.
