# The snag runbook: one paste, one fix

How we work when something breaks: you grab the evidence this page names,
paste it into our session, and the fix comes back grounded in your actual
logs instead of guesses. This captures what an "AI ops bot" would give you,
with one difference that matters: **nobody's AI holds your credentials.**
Not a third party's, and not this session either. You stay the only being
who can touch production.

Every snippet below is safe to paste. None of them contain secrets; where a
command could print one, the safe form is given.

---

## The two views that answer most questions

Before anything else, these two often tell the whole story:

1. **Your Ops tab** — `/command` → Ops. Failures with messages, slow
   routes, memory, event-loop lag. Screenshot it.
2. **The health line** — paste the output of:
   ```bash
   curl -s https://api.dingba.ai/health
   ```
   It names the store (postgres vs memory) and every AI provider in one line.

---

## Symptom → what to grab → paste here

### The site is down or showing 502
Grab, from the Railway dashboard, for the failing service:
- **Deployments** → the newest deployment → **Deploy Logs** → last ~50 lines
- **Settings → Networking**: the domain's target port, and the service's PORT variable
The 502s we hit in August were always a port mismatch or a crashed boot;
both are visible in exactly those two places.

### A deploy failed to build
- **Build Logs** → everything from the first line containing `error` to the end
- Say which service (api or web) and whether you changed any variable since
  the last green deploy. For web: remember `NEXT_PUBLIC_API_URL` is baked at
  build time; changing it requires a redeploy to take effect.

### The app is up but accounts/progress vanish on redeploy
`/health` says `"store":"memory"`. That means `DATABASE_URL` is missing or
wrong on the api service. Paste the health line and confirm whether the
variable exists (never paste its value).

### Migrations failed
Paste the exact `psql` error and which file it stopped on. All fifteen are
idempotent; re-running the loop after a fix is always safe.

### The tutor doesn't reply / voice doesn't work / images do nothing
The AI stack on Contabo. On that box:
```bash
docker compose -f deploy/docker-compose.contabo.yml ps
curl -s localhost:8080/health; curl -s localhost:8081/health; curl -s localhost:8090/health
docker compose -f deploy/docker-compose.contabo.yml logs --tail=40 <the unhealthy one>
```
Paste all of it. Also paste the api's `/health` line, which shows whether
the api can reach those services at all (a firewall rule that blocks
Railway's egress looks exactly like a dead model).

### Emails not arriving
- Send yourself a test (password reset is the easiest trigger) and check junk.
- Paste the api runtime logs filtered for `email` (Railway → the api
  service → **Logs**, search box: `email`).
- If they arrive in spam: the fix is SPF/DKIM/DMARC at your DNS, checklist 1.6.

### A payment happened but the plan didn't flip
- **Money tab** → the ledger. If the event shows with **NO** in matched, the
  payer's email doesn't match an account; if it's absent entirely, the
  webhook isn't reaching us.
- Processor dashboard → webhook delivery attempts → paste the response code
  and body for the failed delivery. 400 "bad signature" means the webhook
  secret variable doesn't match the processor's.

### The morning reminders or weekly digest didn't go out
Run the cron line by hand and paste the JSON it returns:
```bash
curl -s -X POST https://api.dingba.ai/admin/nudge-plans -H "x-admin-key: $ADMIN_KEY"
```
It reports sent / quiet / stale honestly. `{"sent":0,"quiet":N}` is not a
failure; it means every learner had a free day.

### Everything is slow
- Ops tab screenshot (event-loop lag and the route table are the tell), and
- on Contabo: `docker stats --no-stream` (one 7B saturating is the expected
  first bottleneck; the fix is a queue in front of llama.cpp, and that build
  is mine the day you show me this screenshot).

### Something looks wrong and none of the above fits
Paste: what you did, what you expected, what happened instead, the
`/health` line, and the last 30 runtime log lines of the service involved.
That combination has been enough every single time so far.

---

## If you ever want hands-on infra help from this session

The standing rule stays: no standing credentials. If a snag ever needs me
inside Railway rather than reading your pastes, the least-privilege shape is:

1. Railway → the **project** (never account) → Settings → **Tokens** →
   create a project-scoped token.
2. Hand it to a single session for that single fix.
3. Revoke it the same day, from the same screen.

A project token can see that project's variables, so treat handing it over
as exposing those values: rotate anything sensitive afterwards if in doubt.
This is the identical standard applied to any AI vendor's ops bot, and the
reason it is written down is so we never relax it by accident.
