# Dingba. The switch-on guide, v2

This edition starts exactly where the founder is (Railway boxes and database created). Big change since v1: the app now does the technical steps ITSELF. It builds its own database tables at boot, makes its own secret keys, and sends the daily reminders and the Sunday parent emails on its own clock. The old "run the 15 setup files", "make your two secret keys" and two of the three timers are gone because they no longer exist. Almost everything left is a click on Railway or a paste into one PowerShell window logged into Contabo.

[docs/FOUNDER-CHECKLIST.md](FOUNDER-CHECKLIST.md) stays the technical living copy and wins any disagreement.

**Already done:** api box, web box, PostgreSQL database, database connected to api (DATABASE_URL).

## Part A. Three clicks on Railway

### Step 1. Point both boxes at the LIVE code

**Where:** Railway.
**Do:** Railway is currently building an old copy of the code (a branch called main). Click the **api** box, open Settings, find the **Branch** setting (under Source), and change it from main to:

```
claude/ai-tutor-continuation-dwrohy
```

Do the same on the **web** box. Both rebuild by themselves.
**Done when:** both boxes rebuild and turn green.

### Step 2. Watch the app build its own memory

**Where:** your browser.
**Do:** Nothing. When the api box finishes rebuilding, the app checks the database and builds every missing table itself (a `schema_migrations` ledger tracks what ran). Open your-api-address/health.
**Done when:** the page says "postgres". If it says "memory" or does not load, screenshot it into the chat.

### Step 3. Paste in the settings

**Where:** Railway, the api box, Variables.
**Do:** Open [docs/FOUNDER-CHECKLIST.md](FOUNDER-CHECKLIST.md) section 1.2: one ready-made block; copy it in, fill the blanks. The one that locks YOU out if missed: **COMMAND_OWNER_EMAILS** = your own email. Set your prices. Skip anything marked OPTIONAL: the app makes its own secret keys and shows the master one in Command Centre, Ops tab.
**Done when:** the Variables list has your real values. Leave the four brain addresses for step 7.

## Part B. The AI brain, in one PowerShell window

### Step 4. Open the window

**Where:** PowerShell.
**Do:** `ssh root@YOUR-CONTABO-IP`, then your Contabo password.
**Done when:** the prompt changes to the server's name.

### Step 5. Put the code on Contabo

**Where:** the same window.

```sh
git clone -b claude/ai-tutor-continuation-dwrohy https://github.com/dingbapeter/ai-tutor.git
cd ai-tutor
```

If it answers "git: command not found", run `apt install -y git` once and retry.
**Done when:** the prompt shows you are inside the ai-tutor folder.

### Step 6. Wake the brain

**Where:** the same window. Three lines, one at a time; line 1 downloads about 5 GB.

```sh
curl -L -o deploy/models/chat.gguf https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m.gguf
docker compose -f deploy/docker-compose.contabo.yml up -d
curl localhost:8080/health && curl localhost:8081/health && curl localhost:8090/health
```

**Done when:** each health check answers ok. Any red text: paste it all into the chat.

### Step 7. Tell Railway where the brain lives

**Where:** Railway, the api box, Variables.
**Do:** Fill the four brain addresses from the checklist (LLAMACPP_URL, WHISPER_URL, TTS_URL, MATHCHECK_URL), each with your Contabo address, like http://YOUR-CONTABO-IP:8080.
**Done when:** a tutor on the website answers in full sentences.

### Step 8. Lock the brain's doors

**Where:** Contabo's control panel, Firewall page.
**Do:** One rule: only Railway may reach doors 8080 to 8090; everyone else blocked. Confused? Screenshot it into the chat; this one matters.
**Done when:** the rule is saved.

### Step 9. Set the ONE timer

**Where:** the PowerShell window (on Contabo).
**Do:** Only the nightly backup needs a timer; reminders and the Sunday digest send themselves. Type `crontab -e` (press Enter if it asks about editors), paste, save (nano: Ctrl+O, Enter, Ctrl+X):

```sh
0 3 * * * /root/ai-tutor/deploy/backup.sh >> /var/log/dingba-backup.log 2>&1
```

**Done when:** `crontab -l` shows the line.

## Part C. Your name and your email

### Step 10. Connect dingba.ai

**Where:** Railway, then your domain seller.
**Do:** api box, Settings, Custom Domain: **api.dingba.ai**; copy the address line Railway shows into your domain seller's DNS page. Repeat on web for **dingba.ai** and **www.dingba.ai**. Update **WEB_ORIGIN** (api) and **NEXT_PUBLIC_API_URL** (web) to the real names, then Deploy BOTH boxes (the website bakes its address in while building).
**Done when:** https://dingba.ai opens your app.

### Step 11. Stop your emails going to spam

**Where:** mailcow, then your domain seller.
**Do:** Copy mailcow's three ready-made lines (SPF, DKIM, DMARC) into the same DNS page.
**Done when:** a recap you email yourself lands in the inbox, not junk.

## Part D. Prove it works

### Step 12. Open your Command Centre

**Where:** dingba.ai/command, with the boss email from step 3.
**Do:** Add team and investors from the Team tab (investors only ever see totals). In the Ops tab find **Your master key**: the app made it for you; treat it like a password.
**Done when:** you can see the Overview, Growth, Safety, Money and Ops tabs.

### Step 13. Try it on two real phones

**Do:** Hold-to-talk plays you back; the speech-bubble button holds a hands-free conversation you can interrupt by talking over it; camera reads homework; the care-call button opens the dialler; home-screen install opens in airplane mode; nothing squashed.

### Step 14. The two test printouts, together

**Do:** There are two automatic tests (a teaching report card and a pretend rush of 30 users). Do them WITH the build chat: say "ready for the test runs" and get walked through both, line by line.

## Part E. Money, when you want it

### Step 15. Connect a payment company

Paystack (Nigerian cards) or Stripe (the rest): create the two prices, copy their secret keys into api Variables (the checklist names each), and give them the webhook / notification URL:

```
https://api.dingba.ai/billing/webhook
```

### Step 16. Pay yourself once with a real card

Buy Plus, then cancel. **Done when:** the account page shows the plan and the Money tab shows both events.

## Part F. Before real children use it

### Step 17. Have a lawyer read /terms and /privacy

Children's data rules, the AI-disclosure rules, and the care-call feature (it stores a trusted adult's phone number).

### Step 18. Try to break the tutor, by hand

You, then a friend who thinks differently. Paste anything that slips through into the chat. A habit, not a box.

## Part G. Things only you have

Video-call code, WhatsApp business account, go-ahead on Nigerian-language voices, one short email to NCAIR, character art, the call on the two softened marketing lines, where to launch first.

---

Stuck at any step: screenshot it or copy the red text, paste it into the build chat, and it gets fixed with you. One paste, one fix.
