# Deployment

Two boxes, one rule: **Railway runs the app, Contabo runs the AI.**
Everything self-hosted; the only recurring costs are servers you already pay for.

```
[student browser] ──► Railway: web (Next.js)
                 ──► Railway: api (Fastify) ──► Railway: Postgres
                                            ──► Contabo: llm / stt / tts / mathcheck
                                            ──► Contabo: mailcow (SMTP, existing)
```

## 1. Contabo — the AI stack

```bash
# on the Contabo VPS
git clone <this repo> && cd ai-tutor

# download a chat model once (pick ONE to start; ~5GB):
mkdir -p deploy/models
# Qwen2.5-7B-Instruct Q4 — good default:
curl -L -o deploy/models/chat.gguf \
  https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m.gguf

docker compose -f deploy/docker-compose.contabo.yml up -d
curl localhost:8080/health   # llm
curl localhost:8081/health   # stt
curl localhost:8090/health   # mathcheck
```

Then open ports 8080-8090 ONLY to your Railway app's egress (firewall/ufw), not
to the public internet — these services have no auth of their own.

## 2. Railway — the app

Create two services from this repo. **Railway does NOT auto-detect Dockerfiles
that live inside `apps/` — left alone it falls back to Railpack/Nixpacks,
which runs `pnpm --filter <app> build` without building the workspace
packages first, and the api build fails on unresolvable `@tutor/ai-gateway`
/ `@tutor/db`.** Point each service at its Dockerfile explicitly:

- Service → **Variables** → add
  `RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile` (api) resp.
  `RAILWAY_DOCKERFILE_PATH=apps/web/Dockerfile` (web).
- api service → Settings → Deploy → **Healthcheck Path** = `/health`, so a
  broken deploy never takes traffic.

(Railway deprecated its Config-as-code feature in 2026-08 — the UI warns
that existing config files stop working 2026-12-01 — so the
`deploy/railway-*.json` files kept here are historical; the env var above
is the supported path. Leave the Settings → Config-as-code field EMPTY.)

Keep each service's root directory at the repo root — the Dockerfiles COPY
workspace files from there.

| Service | Dockerfile | Port |
|---|---|---|
| api | `apps/api/Dockerfile` (root context) | 4000 |
| web | `apps/web/Dockerfile` (root context; set `NEXT_PUBLIC_API_URL=https://<api-domain>` as a service variable — Railway passes variables as build args) | 3000 |

Add a Railway **Postgres** plugin, then run the migrations once, in order:
```bash
for f in packages/db/migrations/*.sql; do psql $DATABASE_URL -f "$f"; done
```

### api environment
```
DATABASE_URL=<railway postgres url>
AI_CHAT_PROVIDER=llamacpp
AI_STT_PROVIDER=whisper
AI_TTS_PROVIDER=kokoro
AI_VISION_PROVIDER=mock          # until a VL model is loaded
LLAMACPP_URL=http://<contabo-ip>:8080
WHISPER_URL=http://<contabo-ip>:8081
TTS_URL=http://<contabo-ip>:8082
MATHCHECK_URL=http://<contabo-ip>:8090
WEB_ORIGIN=https://<web-domain>
# mailcow SMTP for parent recap emails
SMTP_HOST=<mailcow host>
SMTP_PORT=587
SMTP_USER=tutor@<your-domain>
SMTP_PASS=<mailbox password>
SMTP_FROM="Dingba" <tutor@dingba.ai>
# billing (Sprint 6b) — pick ONE provider; register the webhook as
# https://<api-domain>/billing/webhook in its dashboard first
BILLING_PROVIDER=paystack            # or stripe
PAYSTACK_SECRET_KEY=...              # + PAYSTACK_PLAN_PLUS / PAYSTACK_PLAN_PREMIUM
# STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... STRIPE_PRICE_PLUS=... STRIPE_PRICE_PREMIUM=...
```

## 3. Smoke test after deploy

```bash
curl https://<api-domain>/health
# expect: {"ok":true,"store":"postgres","providers":{"chat":"llamacpp",...}}
```

Open the web app → pick a tutor → run a session → end it → the parent email
arrives via mailcow, and a second session for the same student should report
`remembered > 0`.

## Scaling notes

- CPU VPS: keep `-c 8192 --parallel 4` modest; 7B Q4 ≈ 5-15 tok/s.
- Adding a GPU box later: move the `llm`/`stt`/`tts` services there, change
  three URLs in Railway env. Nothing else moves.
- Paying for a frontier model later (e.g. lesson planning only): set
  `AI_CHAT_PLANNER_PROVIDER` to a new adapter — conversation stays free.
