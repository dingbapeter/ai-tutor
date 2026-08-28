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
| Dingba app shell: design system (indigo tokens, dark mode, Plus Jakarta Sans), app bar, immersive session, all pages restyled | ✅ built; light/dark/mobile/desktop screenshots verified against the running stack |
| Live tutor presence: tutor greets first (in character, safety-audited, deterministic fallback), voice-on-by-default replies, avatar idle presence | ✅ tested + live-verified (greeting in create response and history; real-model greeting quality checks at deploy) |
| Dingba homepage (hero + universal ask box routing into sessions, Socratic example, subject grid, profile showcase, learn-your-way, journey, CTA); app lives at /learn | ✅ built per the founder's template; ask-flow routing + light/dark/mobile/desktop screenshots verified |
| Homepage caricature cast: five original in-house SVG characters (schoolkid, exam candidate, professional, visa traveler, lifelong learner), randomly shuffled per visit across three slots | ✅ built + screenshot-verified; swappable for commissioned art later |
| Speaks your language: **91 languages** selectable per session, **52 with real voices today** (Kokoro Apache-2.0 + Piper MIT, routed automatically by voice id inside the gateway); the other 39 teach, read and listen while their voice is trained | ✅ tested + live-verified (`/languages`, Spanish session, honest degrade on Yorùbá, engine routing unit-tested). Licences verified against the registries: see `docs/LANGUAGES.md` |
| Rotating homepage headlines: 12 founder-written lines, one per visit, with brand-highlighted words | ✅ built + screenshot-verified across variants |
| Attunement: the tutor notices a learner sounding off (short/flat answers, self-criticism, giving up, mood mismatch), stops teaching, asks one real question, and lets the answer steer the session | ✅ built into the tutor contract (rule 8); works on typed text and voice transcripts. Real-model behavior gets judged at deploy |
| Care call: one trusted contact named in advance; on danger-severity distress the app offers a one-tap `tel:` call to that person, never dialing on its own; guardian-managed, removable, GDPR-wiped | ✅ tested + live-verified in a real browser (dial link `tel:+234…` confirmed) |
| Diagnostic assessment: in-session level check (verifiable problems across skills, sealed verdicts, per-skill percentages, weak-first recommendation, mastery seeded, tutor reacts in voice) | ✅ tested + live-verified in the browser |
| Routine upload: timetable/curriculum as photo, screenshot, or pasted text (vision transcription, planner structuring, raw text always preserved), tutor plans around it, dashboard shows the week | ✅ tested (image + text paths, replacement, owner gating); interpretation quality rides the real vision model at deploy |
| Show Dingba v1: photo upload in-session through the vision gateway slot (describe, safety-gate, teach with the explain/hint/concept ask), camera button in the composer, camera_solve metering | ✅ tested + live-verified with the mock vision provider; real Qwen-VL quality checks at deploy |
| Adaptive engine v1: SM-2-family spaced scheduling (both stores), mastery ladder stages, session warm-ups on due skills, /students/:id/review, dashboard stage labels + due badges | ✅ tested (interval growth/reset, ladder thresholds, warm-up prompt block, owner-gated review queue) |
| Dingba Brain v1: structured learner profile (goals/strengths/struggles/interests/preferences), merged after every session (verified practice outcomes + best-effort model extraction), injected into the system prompt, profile card on the dashboard | ✅ tested (merge semantics, deterministic build from wrong answers, owner-gated endpoint); model-extraction quality checks with the real model at deploy |
| Billing: Stripe + Paystack checkout, signature-verified webhooks → plan flips, cancellation downgrade, /me/billing, upgrade buttons | ✅ tested (17 cases incl. real HMAC schemes, tamper + replay rejection); ⚠ needs live keys + a real checkout at deploy — /admin/plan still bridges |
| Email verification at signup (token email, /verify page, resend, banner) | ✅ tested; email delivery goes live with SMTP at deploy |
| Command Centre: staff roles with a server-enforced capability matrix (owner/admin/finance/support/staff/investor), platform metrics with trend charts, revenue from live subscriptions, support desk (search, family view, plan changes), team management, and an append-only audit trail. Investors get the smallest surface in the system: counts and revenue totals, never a learner | ✅ tested + live-verified in a real browser across four roles (desktop + phone); 25 API tests cover the whole investor-containment surface. Set `COMMAND_OWNER_EMAILS` at deploy or nobody can open it |
| Safety desk: every flag on the platform in one view, danger separated from concern, 24h and 7-day counts, guardian one click away, tutor-side flags marked as ours rather than the learner's | ✅ tested + live-verified in a browser; refused to finance and investors, and reading it is itself written to the trail |
| Platform controls: pause new signups (with the wording people are shown) and carry a notice to everyone in the app, flipped from the Command Centre and honoured on the very next request without a deploy | ✅ tested + live-verified end to end: the switch flipped, the signup form said why and disabled itself, and a direct POST bypassing the UI still got 503 with the reason |
| CSV exports from every Command Centre view (metrics, plan mix, subscriptions, safety, roster, audit trail), each gated on exactly the capability its on-screen view needs, spreadsheet-formula injection defused, UTF-8 BOM so African names survive Excel, dated filenames, every download written to the trail | ✅ tested + live-verified in a browser: real files downloaded as owner, finance and support, an investor refused at the API even when calling it directly, and a hostile display name arrived defused |
| HR: each console account carries an employment record (legal name, how they are engaged, start and end dates, base, notes) plus a reporting line, an org chart drawn from those lines, tenure on the roster, and all of it in the roster export | ✅ tested + live-verified in a browser: the chart drew the real tree, a record edit saved and stuck, and a reporting loop was refused through the UI with a readable reason |
| The money ledger: every verified processor webhook recorded exactly once (activations, cancellations, failed renewals, refunds), Stripe and Paystack failure/refund events parsed under their real signature schemes, trouble tiles for everyone with finance access, the full feed and its export behind finance:detail, unmatched money flagged loudly | ✅ tested + live-verified: real signed webhooks through the endpoint, a retried event landing exactly once, an unknown account's refund flagged NO, and the investor seeing counts with no payer anywhere |
| Study plans v1: a deterministic week built from the spaced-repetition queue, weak skills, the uploaded timetable and its exam dates. Overdue review beats new practice, heavy school days get lighter plans, the exam eve and day carry revision only, and every item says why it earned its place | ✅ tested (11 planner-rule cases incl. an evening-clock exam regression) + live-verified on the dashboard, desktop and phone |
| Study reminders that know the plan: a daily admin-triggered run sends each subscribed family one notification per learner naming today's actual item (the review skill, or the exam), stays silent on free days, and prunes dead devices as it goes | ✅ tested (composed lines pinned word for word, gating, quiet days, stale-device cleanup proven against a real web-push attempt); needs a cron pointed at /admin/nudge-plans at deploy |
| Guardian weekly digest: one plain email per verified guardian with an active week (sessions, streak, skills due, safety flags, the week-ahead headline), quiet weeks and unverified emails skipped, cron-triggered | ✅ tested (wording pinned word for word incl. the no-em-dash rule, gating, quiet/unverified accounting); goes live with SMTP + a weekly cron at deploy |
| Lessons v1: a plan item taps open as a structured lesson the tutor persona delivers conversationally (recall from prerequisites, worked example and guided practice from the SymPy-verified bank, wrap-up), lessonSkillId on session create, lesson chip in the session header | ✅ tested (brief pinned against the real pack incl. that every problem and answer comes from the verified bank; unknown-skill 400; ordinary sessions untouched) + the dashboard-to-lesson loop live-verified in a browser. Narration quality rides the real model at deploy, like the greeting |
| Sessions survive: resume metadata persisted with every session (persona, language, plan, owner, guardian, API key), and a process that has never seen a session rebuilds it from the store on demand: history, system prompt, entitlements, B2B quota cap. A restart, a TTL eviction, or a second API instance behind the same database continues the conversation instead of losing it | ✅ tested with two app instances over one store: mid-conversation resume with history order intact, a voice turn served by the fresh process, metering attributed to the same owner, ended sessions staying ended. In-flight exam/diagnostic state and per-session practice tallies are process-local and reset, which degrades a recap, never a conversation |
| Observability: every request timed per route pattern (zero dependencies), event-loop lag, memory, an error ring that carries messages but never anyone's words, an Ops tab in the Command Centre (owner/admin) refreshing every 15s, and Prometheus text at /admin/metrics so any Grafana scrapes it with just the admin key | ✅ tested (histogram maths, cumulative buckets, 404-vs-500 semantics, ring bounds, route-pattern labels proven to never leak raw session ids, capability gating) |
| Load driver (`pnpm load`): zero-dependency virtual-user journeys with SSE fully drained, p50/p95/p99 per step, non-zero exit past 1% failures; honest numbers in docs/PERF.md (flat to 150 concurrent users at 414 req/s on one process, graceful queueing at 400, zero failures) | ✅ run at five load levels against the built stack |
| Pedagogy eval harness (`pnpm evals`): scripted learner scenarios judged deterministically, split honestly into plumbing judges (fail the run on any provider) and model judges (reported on mock, binding on the real stack or --strict). Covers socratic restraint under pressure, wrong-answer care, the house voice, language discipline, the safety redirect down to the transcript record, greeting, length discipline | ✅ 6/6 plumbing judges pass on mock; point AI_CHAT_PROVIDER at the deployed stack for the verdicts that matter |
| Safety fallback hardened against evasion: the rules moderator now matches across normalized views (zero-width strip, NFKC full-width folding, leetspeak, stretched letters, spaced-out letters), additive so plain matching can never get weaker; two real gaps the red-team suite found are fixed (stacked jailbreak qualifiers, consecutive leet characters); its honest limit (no paraphrase understanding) is a pinned test, which is exactly why production runs the classifier on top | ✅ 8 adversarial cases green, ordinary schoolwork asserted unflagged |
| WhatsApp nudges | ❌ later sprints |

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
- [ ] Sprint 6b remainder: study plans & scheduling, WhatsApp nudges
      (spaced-repetition warm-ups shipped with the adaptive engine)
- [ ] Phase 2: full-duplex live voice (LiveKit self-hosted), whiteboard, homework
      camera, image generation for cartoon panels (IDEAS.md #001 full version)

Language coverage, licence verdicts, and the Nigerian-language voice plan:
`docs/LANGUAGES.md`.

See `deploy/DEPLOY.md` for the Railway + Contabo deployment guide and
`IDEAS.md` for the founder idea parking lot.
