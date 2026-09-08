# Dingba. The switch-on guide

Do the steps in order and tick them off. Each one is a couple of clicks or one paste. You cannot break anything: if a screen looks wrong, screenshot it, paste it into the build chat, and it gets fixed. This is the plain-language edition; [docs/FOUNDER-CHECKLIST.md](FOUNDER-CHECKLIST.md) stays the technical living copy and wins any disagreement.

**You will work in three places:**

| Place | What it is |
|---|---|
| **Railway** (railway.app) | The app lives here. You need exactly 3 things on it: **api**, **web**, and a **database**. No Workers service, nothing else. |
| **Contabo** | Your rented computer. The AI brain (talking, listening, maths checking) runs here. |
| **Your domain seller** | The website where you bought dingba.ai. You will paste a few address lines there. |

## Part A. Switch it on

Steps 1 to 13, in order. About one focused day.

### Step 1. Put the app on Railway

**Where:** Railway.
**Do:** Log in at railway.app with your GitHub account. Click New Project, then Deploy from GitHub repo, and pick **dingbapeter/ai-tutor**. A box appears; that box is a "service". Click it, open Settings, rename it **api**.
**Done when:** a box named api sits in your project. Its first build may fail; step 2 fixes that.

### Step 2. Tell api how to build itself

**Where:** Railway, the api box.
**Do:** Open Variables, add **RAILWAY_DOCKERFILE_PATH** = **apps/api/Dockerfile** (without this line Railway guesses how to build and guesses wrong). In Settings, set Healthcheck Path to **/health**. If Settings shows a "Config-as-code" box, leave it empty.
**Done when:** the api box builds and turns green.

### Step 3. Add the website as a second box

**Where:** Railway.
**Do:** Click + New, then GitHub Repo, pick the SAME repo again, rename it **web**, and add its variable **RAILWAY_DOCKERFILE_PATH** = **apps/web/Dockerfile**.
**Done when:** a second green box named web sits next to api.

### Step 4. Create the database (the app's permanent memory)

**Where:** Railway.
**Do:** Click + New, then Database, then **Add PostgreSQL**. Until this exists, every restart erases all accounts. Open the new PostgreSQL box's Variables and copy the long address called **DATABASE_URL**. Add it to the api box's Variables under the exact name **DATABASE_URL**.
**Done when:** your-api-address/health in a browser says "postgres". If it says "memory", paste that page into the chat.

### Step 5. Run the 15 setup files

**Where:** a terminal on your own computer, inside the project folder.
**Do:** Copy the line below, replace the CAPITALS part with the DATABASE_URL address from step 4, paste, press Enter. Safe to run twice.

```sh
for f in packages/db/migrations/*.sql; do psql "PASTE-YOUR-DATABASE-ADDRESS-HERE" -f "$f"; done
```

**Done when:** the terminal prints lines like CREATE TABLE with no red. Anything red: paste it all into the chat.

### Step 6. Make your two secret keys

**Where:** a terminal.
**Do:** Run the first line and save its output in api Variables as **ADMIN_KEY** (your master password). Run the second line; it prints a Public Key and a Private Key; save them as **VAPID_PUBLIC_KEY** and **VAPID_PRIVATE_KEY** (they let Dingba send phone reminders).

```sh
openssl rand -hex 32
npx web-push generate-vapid-keys
```

**Done when:** both keys sit in the api Variables list.

### Step 7. Paste in the rest of the settings

**Where:** Railway, the api box, Variables.
**Do:** Open [docs/FOUNDER-CHECKLIST.md](FOUNDER-CHECKLIST.md) section 1.2: it is one ready-made block; copy it in and fill the blanks. The one that locks YOU out if missed: **COMMAND_OWNER_EMAILS** = your own email (only that email can open the Command Centre). Also set your prices.
**Done when:** the Variables list matches the checklist block, with your real values.

### Step 8. Wake the AI brain on Contabo

**Where:** the Contabo computer's terminal, inside the project folder.
**Do:** Run the three lines below one at a time. Line 1 downloads the brain (about 5 GB). Line 2 starts everything. Line 3 asks "are you awake?" three times.

```sh
curl -L -o deploy/models/chat.gguf https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m.gguf
docker compose -f deploy/docker-compose.contabo.yml up -d
curl localhost:8080/health && curl localhost:8081/health && curl localhost:8090/health
```

**Done when:** each health line answers ok. Then back on Railway, fill the four brain addresses in api Variables (LLAMACPP_URL and friends, from the checklist) with your Contabo address.

### Step 9. Lock the brain's doors

**Where:** Contabo's control panel, the Firewall page.
**Do:** The brain answers on doors 8080 to 8090 and has no password. Make one rule: only Railway may reach doors 8080 to 8090; everyone else blocked. Otherwise strangers use your computer for free.
**Done when:** the rule is saved. Confused by the firewall page? Screenshot it into the chat; this one matters.

### Step 10. Connect the name dingba.ai

**Where:** Railway, then your domain seller.
**Do:** api box, Settings, Custom Domain: type **api.dingba.ai**. Railway shows one address line (a CNAME); copy it into the DNS page at your domain seller. Do the same on the web box for **dingba.ai** and **www.dingba.ai**. Update two settings to the real names, **WEB_ORIGIN** on api and **NEXT_PUBLIC_API_URL** on web, then press Deploy on BOTH boxes. The website bakes its address in at build time, so the web redeploy is not optional.
**Done when:** https://dingba.ai opens your app.

### Step 11. Stop your emails going to spam

**Where:** mailcow, then your domain seller.
**Do:** Your email server (mailcow) shows three ready-made address lines named SPF, DKIM and DMARC; they prove your emails really come from you. Copy all three into the same DNS page as step 10.
**Done when:** you email yourself a recap from the app and it lands in the inbox, not junk.

### Step 12. Set the three timers

**Where:** the Contabo terminal.
**Do:** Computers have a built-in alarm clock. Type `crontab -e`, paste the three lines below, save. Line 1 copies the database every night at 3am. Line 2 sends the morning study reminders. Line 3 sends parents their Sunday summary. Replace YOUR-ADMIN-KEY with the master password from step 6. And no, you do not need a "Workers" service anywhere: these three lines are the whole job.

```sh
0 3 * * * /root/ai-tutor/deploy/backup.sh >> /var/log/dingba-backup.log 2>&1
0 7 * * * curl -X POST https://api.dingba.ai/admin/nudge-plans -H "x-admin-key: YOUR-ADMIN-KEY"
0 18 * * 0 curl -X POST https://api.dingba.ai/admin/weekly-digest -H "x-admin-key: YOUR-ADMIN-KEY"
```

**Done when:** `crontab -l` shows the three lines.

### Step 13. Open one backup, once

**Where:** the Contabo terminal.
**Do:** A backup you have never opened is a hope, not a backup. Restore one night's copy into a scratch database and check the accounts are inside. [docs/RUNBOOK.md](RUNBOOK.md) walks you through it.
**Done when:** you have seen your own data inside a restored copy.

## Part B. Prove it works

### Step 14. Run the two automatic tests

**Where:** a terminal in the project folder.
**Do:** Line 1 is the teaching report card: it quizzes the live tutor and prints pass or fail per check. Line 2 pretends 30 people use Dingba at once. Swap in your Contabo address.

```sh
AI_CHAT_PROVIDER=llamacpp LLAMACPP_URL=http://YOUR-CONTABO-ADDRESS:8080 pnpm evals
pnpm load -- --base https://api.dingba.ai --vus 30
```

**Done when:** you have both printouts. Paste them into the chat.

### Step 15. Try it on two real phones

**Where:** an iPhone and a cheap Android.
**Do:** Hold the talk button, hear yourself back. Tap the speech-bubble button and just talk hands-free, then interrupt the tutor by talking over it. Point the camera at homework. Tap the care-call button; the dialler should open. Add to home screen, switch on airplane mode; it should still open.
**Done when:** all of it works on both phones and nothing looks squashed.

### Step 16. Open your Command Centre

**Where:** dingba.ai/command.
**Do:** Sign in with the boss email from step 7. Add your team and investors from the Team tab. Investors only ever see totals, never any child's data.
**Done when:** you can see the Overview, Growth, Safety and Money tabs.

## Part C. Money, when you want it

### Step 17. Connect a payment company

**Where:** Paystack (Nigerian cards) or Stripe (the rest).
**Do:** Create the two prices (Plus and Premium) in their dashboard, copy the secret keys into api Variables (the checklist names each one), and paste this where they ask for a webhook or notification URL (that address is just them ringing your app's doorbell to say "this person paid"):

```
https://api.dingba.ai/billing/webhook
```

**Done when:** the keys are in, the address is saved.

### Step 18. Pay yourself once with a real card

**Where:** dingba.ai.
**Do:** Buy a Plus plan with your own card, then cancel it.
**Done when:** your account page shows the plan, and the Money tab shows the payment AND the cancellation.

## Part D. Before real children use it

### Step 19. Have a lawyer read /terms and /privacy

**Do:** Ask them to check three things: children's data rules (strict in America, Europe and Nigeria alike), the newer rules about clearly disclosing the tutor is an AI, and the care-call feature, because it stores a trusted adult's phone number.
**Done when:** the lawyer signs off and the "draft" notes come off the pages.

### Step 20. Try to break the tutor, by hand

**Do:** Genuinely try to make the live tutor say something a child should never hear. Then have a friend who thinks differently try too. Write down anything that slips through and paste it into the chat.
**Done when:** you and one other person have each given it a serious try. This one is a habit, not a box.

## Part E. Things only you have

Send any of these whenever; each unlocks a build the same day.

- Your video-call code (unlocks live classes)
- WhatsApp business account (parent reminders)
- Your go-ahead on Nigerian-language voices
- One short email to NCAIR (Hausa speech permission)
- Character art, when you want it
- Your call on the two softened marketing lines
- Where to launch first

---

Stuck anywhere, at any step: screenshot it or copy the error, paste it into the build chat, and it gets fixed with you. One paste, one fix.
