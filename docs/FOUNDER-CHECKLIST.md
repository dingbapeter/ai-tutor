# Founder checklist: every variable, every pending action

Written 2026-08-24. This is the complete list of what only you can do. The
code side is done and pushed; everything below needs your accounts, your
servers, your money, or your judgment.

Order matters: Part 1 makes the deploy real, Part 2 makes it good, Part 3 is
before real children use it, Part 4 is the horizon.

---

## Part 1: make the deploy real (an evening's work)

### 1.0 Migrations

Apply `packages/db/migrations/` in order, 0000 through 0014 (fifteen files).
The last five build the Command Centre and the scaling layer:
`0010_command_centre.sql` (staff and the audit trail),
`0011_platform_settings.sql` (the switches on the Controls tab),
`0012_staff_hr.sql` (employment records and reporting lines),
`0013_billing_events.sql` (the money ledger behind the Money tab),
`0014_session_resume.sql` (sessions survive restarts and scale across
instances; with more than one api instance, keep sticky sessions on for the
smoothest turns, though any instance can now serve any session).

### 1.1 Postgres on Railway — nothing persists without this

Right now every redeploy wipes accounts, learner profiles, mastery
schedules, routines and care contacts. This is the single highest-value hour
you can spend.

1. Railway project → **New** → **Database** → **PostgreSQL**.
2. Copy the connection string it gives you.
3. On the **api** service → Variables → `DATABASE_URL=<that string>`.
4. Run every migration once, in order:
   ```bash
   for f in packages/db/migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
   ```
   There are 15 (0000 through 0014). They are idempotent, safe to re-run.
5. Confirm: `https://<api-domain>/health` should now say `"store":"postgres"`
   instead of `"memory"`.

### 1.2 The variables, api service

Copy-paste block. Values you must fill are marked `<>`.

```bash
# --- Core ---
DATABASE_URL=<from Railway Postgres>
WEB_ORIGIN=https://<your web domain>
PORT=4000

# --- The AI stack on Contabo (see 1.4) ---
AI_CHAT_PROVIDER=llamacpp
AI_STT_PROVIDER=whisper
AI_TTS_PROVIDER=kokoro
AI_VISION_PROVIDER=llamacpp
LLAMACPP_URL=http://<contabo-ip>:8080
WHISPER_URL=http://<contabo-ip>:8081
TTS_URL=http://<contabo-ip>:8082
PIPER_TTS_URL=http://<contabo-ip>:8083   # unlocks 43 more speaking languages
MATHCHECK_URL=http://<contabo-ip>:8090

# The line in front of the model box (optional; these are the defaults).
# Match AI_MAX_CONCURRENT to llama.cpp's parallel slots (-np).
AI_MAX_CONCURRENT=4
AI_QUEUE_DEPTH=32
AI_QUEUE_TIMEOUT_MS=30000

# --- Email, your existing mailcow ---
SMTP_HOST=<mail.yourdomain>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=tutor@dingba.ai
SMTP_PASS=<mailbox password>
SMTP_FROM="Dingba" <tutor@dingba.ai>

# --- Safety classifier (the one sanctioned paid API) ---
AI_MODERATION_PROVIDER=anthropic
ANTHROPIC_API_KEY=<your key>

# --- Push notifications (generate: npx web-push generate-vapid-keys) ---
VAPID_PUBLIC_KEY=<generated>
VAPID_PRIVATE_KEY=<generated>
VAPID_SUBJECT=mailto:you@dingba.ai

# --- Command Centre (the backend of everything) ---
# Your email, and any co-founder who should have full control. Comma separated.
# Nobody can open the console until at least one address is here; every other
# person (finance, support, staff, investors) is added from inside it.
COMMAND_OWNER_EMAILS=dingbapeter@gmail.com
# Monthly price per paid plan, for the finance view. Blank means the console
# shows subscriber counts and says the prices are unset, rather than a made-up
# revenue number in front of an investor.
PRICE_PLUS_MONTHLY=<e.g. 9>
PRICE_PREMIUM_MONTHLY=<e.g. 19>
PRICE_CURRENCY=USD

# --- Ops ---
ADMIN_KEY=<long random string, for /admin endpoints>
# Daily study reminders: point any cron (Railway cron, GitHub Actions, or
# crontab on Contabo) at this once a morning, e.g. 7:00 in your users' zone:
#   curl -X POST https://<api-domain>/admin/nudge-plans -H "x-admin-key: $ADMIN_KEY"
# Each subscribed family gets one notification per learner who actually has
# something to do today, with the specific item. Free days stay silent.
# Weekly guardian digest: same idea, once a week (Sunday evening works well):
#   curl -X POST https://<api-domain>/admin/weekly-digest -H "x-admin-key: $ADMIN_KEY"
# Verified guardians with an active week get one plain email: sessions,
# streak, what is due, safety flags, and the week ahead. Quiet weeks send nothing.
ERROR_WEBHOOK_URL=<optional: Slack/Discord webhook for 5xx alerts>
```

Optional tuning, defaults are sensible: `RATE_LIMIT_MAX=120`,
`AUTH_RATE_LIMIT=10`, `GUEST_IP_CAP=8`.

### 1.3 The variables, web service

```bash
NEXT_PUBLIC_API_URL=https://<your api domain>
PORT=3000
```

**This one bites people:** Next.js bakes `NEXT_PUBLIC_API_URL` in at BUILD
time. Set it before the web service builds, and redeploy web after any change.

### 1.4 Contabo: the AI stack

```bash
git clone https://github.com/dingbapeter/ai-tutor && cd ai-tutor
mkdir -p deploy/models

# The brain. 7B minimum: the 0.5B we tested with was a protocol test only,
# pedagogy quality needs the bigger model.
curl -L -o deploy/models/chat.gguf \
  https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m.gguf

docker compose -f deploy/docker-compose.contabo.yml up -d
curl localhost:8080/health && curl localhost:8081/health && curl localhost:8090/health
```

Then **firewall ports 8080-8090 to Railway's egress only**. These services
have no auth of their own; open to the internet means anyone can use your GPU.

Add Piper as a second TTS container on 8083 to turn on Swahili, Arabic,
Urdu, Telugu, Vietnamese and 38 more. Voices route automatically by id.

### 1.5 DNS: point dingba.ai

- api service → Settings → Networking → Custom Domain → `api.dingba.ai`
- web service → Custom Domain → `dingba.ai` and `www.dingba.ai`
- Railway shows the CNAME records; add them at your registrar.
- Then update `WEB_ORIGIN` and `NEXT_PUBLIC_API_URL` to the real domains and
  redeploy both.

### 1.6 Email deliverability (before any parent email goes out)

On mailcow for dingba.ai: **SPF**, **DKIM**, **DMARC** records. Without
these, recap emails and safety alerts land in spam, which for a safety alert
is a real failure. Send yourself a test recap and check it arrives in the
inbox, not the junk folder.

### 1.7 Backups

`deploy/backup.sh` exists and rotates 14 days. It needs its cron entry:
```bash
0 3 * * * /path/to/ai-tutor/deploy/backup.sh >> /var/log/dingba-backup.log 2>&1
```
Then **restore once into a scratch database** to prove the backup works. An
untested backup is not a backup.

---

## Part 2: make it good (the week after)

### 2.1 Billing, when you want money

```bash
BILLING_PROVIDER=stripe          # or paystack for Nigeria
STRIPE_SECRET_KEY=<sk_live_...>
STRIPE_WEBHOOK_SECRET=<whsec_...>
STRIPE_PRICE_PLUS=<price_...>
STRIPE_PRICE_PREMIUM=<price_...>
# or:
PAYSTACK_SECRET_KEY=<sk_live_...>
PAYSTACK_PLAN_PLUS=<plan code>
PAYSTACK_PLAN_PREMIUM=<plan code>
```
Create the products/prices in the dashboard first, point the webhook at
`https://api.dingba.ai/billing/webhook`, then **run one real checkout with a
real card** and confirm the plan flips on the account page. Paystack is the
right default for Nigerian cards.

### 2.2 Real-device testing (register item A)

Nothing substitutes for this. On an actual iPhone and an actual budget
Android:
- hold-to-talk voice: does it record, does it play back
- the care call button: does it open the dialer
- camera capture in Show Dingba
- install to home screen, then use it offline
- layouts at 360px width

### 2.3 Observability (register item D) — ops half BUILT 2026-08-29

Ops observability is in the product now: the Ops tab in the Command Centre
(request rates, latency, failures, memory, event loop) and a Prometheus feed
at `/admin/metrics` any Grafana can scrape with your admin key. What remains
yours: PRODUCT analytics. Retention is the metric that decides everything
about this business, and the Ops tab does not show it. PostHog self-hosted
on Contabo (MIT) is the plan when you want that lens.

### 2.4 Load testing (register item B) — driver BUILT 2026-08-29; see docs/PERF.md

The platform numbers are measured (flat to 150 concurrent users on one
process). Your half: run the driver against the DEPLOYED stack before any
launch push — `pnpm load -- --base https://api.dingba.ai --vus 30` — because
that run measures the GPU box too, and one 7B serving many concurrent
sessions will be the first bottleneck. Expect to add a request queue in
front of llama.cpp when it is.

---

## Part 3: before real children use it

### 3.1 Legal review (register item E) — do not skip

`/terms` and `/privacy` are **drafts** and marked as such in the UI. A lawyer
must review before launch, specifically:
- children's data (COPPA-class, and Nigeria's NDPA)
- the AI-disclosure requirements now live in several markets
- the care-call feature: you are storing a third party's phone number

### 3.2 Red-teaming the safety layer (register item J) — machine half BUILT 2026-08-29

The deterministic floor now resists leetspeak, stretched and spaced-out
letters, zero-width characters and full-width forms, with an adversarial
test suite pinning it. What remains is the human half: a person trying to
break the REAL classifier and the tutor prompt in a live session, which no
suite replaces.

Sit down with the app and genuinely try to make the tutor say something it
shouldn't. Then have someone who is not you do it. This is never "done", and
it is the thing that ends companies in this category.

### 3.3 Pedagogy eval harness (register item I) — BUILT 2026-08-29

Run it against the live stack the day the 7B is up; this is the checklist:

```bash
AI_CHAT_PROVIDER=llamacpp LLAMACPP_URL=http://<contabo-ip>:8080 pnpm evals
```

Every judge is a deterministic string check you can argue with. Model judges
(socratic restraint, language discipline, assistant-isms, greeting by name,
length) become binding automatically on a real provider.

Before and after every model swap: a fixed set of student messages, and a
human judging whether the tutor taught well. Without it you will swap a model
and silently ship worse teaching.

---

## Part 4: the horizon (your calls to make)

| Decision | Why it needs you |
|---|---|
| **Video interface code** | You built it. Send the archive or repo name and it gets wired onto the live-class layer with LiveKit. |
| **Nigerian-language voices** | The plan is in `docs/LANGUAGES.md`: train on CC-BY-SA NaijaVoices with Piper's MIT pipeline, roughly a day per language on the GPU box. Needs your go-ahead and the GPU. |
| **NCAIR email** | Their Hausa ASR has no licence attached. A Nigerian company asking a Nigerian government body for a licence grant is a short email with a good chance. |
| **Commissioned character art** | The caricature cast is original and owned, but it is SVG. A real illustrator swaps into one file. |
| **The two marketing lines** | I reworded "knows better than all your human teachers combined" and "100x better than their classmates" because they are unverifiable claims about children's education. Your call: say the word and they go back. |
| **GPU box** | Gates full-duplex voice, cartoon panels, voice-tone attunement, and the Nigerian voices. The single biggest capability unlock left. |
| **Launch market** | You said local test first. That decides which languages get voices first and which curriculum packs get built next. |

---

## What is already done, for your peace of mind

Pushed, tested, CI-green: 203 TypeScript + 7 Python tests, twenty-plus
consecutive green CI runs, and a full stub sweep behind it.

Sessions with a tutor who greets you first and speaks, and that survive
restarts and scale across instances. Cross-session memory and the Dingba
Brain. Adaptive spaced repetition, diagnostic level checks, verified maths,
lessons the personas deliver from the verified bank. Show Dingba (photos).
Routine upload. Study plans, plan-aware push reminders, the guardian weekly
digest. Attunement and the care call. 91 languages, 52 speaking. Safety gate
hardened against evasion, incident log, guardian alerts. The Command Centre:
roles with investors on the smallest surface, staff and HR with an org
chart, safety desk, money ledger, platform controls, audit trail, CSV
exports, the Ops tab. Accounts, family profiles, parent dashboard, org
accounts, API keys, exam mode, live classes, metering, entitlements,
billing wiring, PWA, push notifications, password reset, email
verification, GDPR deletion. A load driver and a pedagogy eval harness
waiting for your deployed model.

The gap between this list and a live product is the list above, not more code.
