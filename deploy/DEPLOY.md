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

# the brain-door password (the gate rejects requests without it):
echo "BRAIN_KEY=$(openssl rand -hex 24)" > deploy/.env
cat deploy/.env   # put the SAME value in the Railway api's BRAIN_KEY variable

docker compose -f deploy/docker-compose.contabo.yml up -d
curl localhost:8080/health   # llm
curl localhost:8081/health   # stt
curl localhost:8090/health   # mathcheck
```

### Sharing the box with other products (e.g. mailcow) on ~8 GB RAM

The 7B needs ~5 GB by itself and does not fit next to mailcow on an 8 GB
box. The recipe that does fit (and stays licensing-clean, MIT):

```bash
# Phi-3.5-mini-instruct Q4 (~2.4 GB) instead of the 7B — same filename,
# nothing else changes:
curl -L -o deploy/models/chat.gguf \
  https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf

# A swap safety net so a memory spike can never let the kernel kill a
# neighbour (one-time):
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Every Dingba container in the compose file carries `mem_limit` + `cpus`
caps for exactly this case: Dingba can slow itself down, never the
neighbours. The llm runs `--parallel 2` here; set `AI_MAX_CONCURRENT=2`
on the Railway api so the app-side queue matches the model server's
slots. Move to the 7B on a dedicated box at launch: it is a model file
swap plus three URL changes, nothing else.

### The gate (auth on every AI door)

The AI services themselves have no auth, so none of them is published
directly. The `gate` service (nginx) owns ports 8080/8081/8082/8090 and
turns away any request whose `x-brain-key` header does not equal
`BRAIN_KEY` from `deploy/.env` (401). `GET /health` stays open per door
for uptime checks. The Railway api presents the key automatically once
its `BRAIN_KEY` variable is set to the same value.

Defence in depth, if your Railway plan has a static egress IP: also
firewall ports 8080-8090 to that IP only. Docker bypasses ufw, so use the
`DOCKER-USER` iptables chain (allow the Railway IP, drop the rest) and
persist with `netfilter-persistent save`. The key alone is enough to keep
strangers out; the firewall on top hides the doors entirely.

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

Add a Railway **Postgres** plugin and set `DATABASE_URL` on the api. The
api applies migrations ITSELF at boot (schema_migrations ledger; failed
migration = failed boot, so the healthcheck keeps the old deploy live).
The manual loop still works if ever needed:
```bash
for f in packages/db/migrations/*.sql; do psql $DATABASE_URL -f "$f"; done
```

**Branch**: Railway builds `main` by default; the live code is on the
working branch. Service → Settings → Source → set the branch accordingly.

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
