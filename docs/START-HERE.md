# Dingba. Your to-do list, in plain English

The app itself is finished and tested. What is left are the steps only you can do: turning it on for the world, connecting your name and your money, and a few decisions. Every step below says what the thing is, where to click, and how you know it worked. Nothing here can break the code.

This is the plain-language edition of [docs/FOUNDER-CHECKLIST.md](FOUNDER-CHECKLIST.md), which stays the technical living copy. If anything here disagrees with the checklist, the checklist wins.

**Five words you will meet, explained once:**

- **Railway**: the company whose website (railway.app) runs the Dingba app for you. You click buttons there; no typing needed for most steps.
- **Contabo**: the computer you rent that runs the AI brain: the part that talks, listens, speaks, and checks maths.
- **Terminal**: the black typing window on a computer. When a step says "paste this line", this is where you paste it, then press Enter.
- **Database**: the app's permanent filing cabinet. Accounts, lessons, progress: everything that must survive a restart lives here.
- **Deploy / redeploy**: putting the app live, or restarting it so a new setting takes effect. On Railway it is one button called Deploy.

## Part 1. Give Dingba a permanent memory, then turn everything on

About one evening of clicking and pasting. Step 1 matters most: until it is done, every restart wipes all accounts.

### 1. Create the filing cabinet (a database) on Railway

Right now Dingba keeps everything in short-term memory, like a shop with no record book: close the shop, lose the customers. This step gives it a real record book.

**Do this:** open railway.app, open your Dingba project, click the "+ New" button, choose "Database", then "Add PostgreSQL" (PostgreSQL is just the brand of database we use). Wait until its light turns green.

**Then connect it to the app:** click the new PostgreSQL box, open its "Variables" tab, and copy the long address named DATABASE_URL (it starts with `postgresql://`). Now click your **api** service, open ITS "Variables" tab, click "New Variable", name it exactly `DATABASE_URL`, paste the address as the value, save. Railway restarts the app by itself.

**You know it worked when:** you open `https://your-api-address/health` in a browser and the page says "postgres". If it still says "memory", the app cannot see the database yet. Paste the /health page into our chat.

### 2. Build the shelves inside the cabinet (run the 15 setup files)

An empty database is an empty cabinet. The project folder contains 15 small instruction files (techies call them "migrations") that build the shelves: a place for accounts, a place for lessons, and so on. They must run once, in order, and they are safe to run twice by accident.

**Do this:** on your own computer, open a terminal inside the project folder, and paste the line below. First replace the part between the quotes with the DATABASE_URL address you copied in step 1.

```sh
for f in packages/db/migrations/*.sql; do psql "PASTE-YOUR-DATABASE-ADDRESS-HERE" -f "$f"; done
```

**You know it worked when:** the terminal prints a stream of lines like "CREATE TABLE" with no red errors. If anything looks red, copy the whole output into our chat.

### 3. Fill in the app's settings card

The app reads its settings from a list of named values, like a contact card: each line is a NAME and a value. Techies call these "environment variables". You add them in the same place as step 1: api service, "Variables" tab.

The complete ready-to-paste block is in [docs/FOUNDER-CHECKLIST.md](FOUNDER-CHECKLIST.md), section 1.2. In plain words, the settings tell the app:

- **Where its memory is** (`DATABASE_URL`, from step 1) and **what its own web address is** (`WEB_ORIGIN`).
- **Where the AI brain lives**: the addresses of your Contabo computer (set these after step 5).
- **Which email account it sends from**, so weekly recaps and safety alerts to parents actually go out.
- **Your email address as the boss key**: the setting `COMMAND_OWNER_EMAILS`. Only accounts on this list can open the Command Centre. Without it, even you are locked out.
- **Your prices**: what Plus and Premium cost, and in which currency.
- **Two secret keys you create yourself**, below.

### 4. Create your two secret keys

First, a master password called `ADMIN_KEY`. It guards the app's staff-only doors. Make a long random one by pasting this in a terminal, then save the result as the ADMIN_KEY setting:

```sh
openssl rand -hex 32
```

Second, a pair of notification keys. These let Dingba send reminders to phones even when the app is closed. Paste this in a terminal; it prints a Public Key and a Private Key. Save them as the settings `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`.

```sh
npx web-push generate-vapid-keys
```

### 5. Turn on the AI brain (your Contabo computer)

Railway runs the app; Contabo runs the brain. The brain is one big file (about 4 GB) plus a few helper programs that all start together with one line.

**Do this:** log into your Contabo machine's terminal, go into the project folder, then run the three lines below in order. Line 1 downloads the brain file (this takes a while). Line 2 starts everything. Line 3 asks the three helpers "are you awake?"; each should answer ok.

```sh
curl -L -o deploy/models/chat.gguf https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m.gguf
docker compose -f deploy/docker-compose.contabo.yml up -d
curl localhost:8080/health && curl localhost:8081/health && curl localhost:8090/health
```

**Then:** back on Railway, fill in the "where the brain lives" settings from step 3 with your Contabo address. **You know it worked when** you chat with the tutor on the website and it answers in full sentences.

### 6. Lock the brain's doors

The brain's helper programs answer on numbered doors (doors 8080 to 8090) and they have no password of their own. Left open, strangers on the internet can use your rented AI computer for free until it falls over.

**Do this:** in Contabo's control panel, find the Firewall page and make one rule: only Railway's addresses may reach doors 8080 to 8090; everyone else is blocked. If the firewall page confuses you, take a screenshot and paste it into our chat. This one is worth getting right.

### 7. Connect your name: dingba.ai

The internet has an address book (techies call it DNS). It turns a name like dingba.ai into the address of the machine that answers. You will add two entries to it at your registrar, which is the website where you bought the name dingba.ai.

**Do this:** on Railway, click the **api** service, then Settings, then "Custom Domain", and type `api.dingba.ai`. Railway then shows you the exact address-book entry to add (it is called a CNAME, an entry that says "this name points at that name"). Copy it into your registrar's DNS page. Repeat for the **web** service with `dingba.ai` and `www.dingba.ai`.

**Then:** update two settings to the real names, `WEB_ORIGIN` on the api service and `NEXT_PUBLIC_API_URL` on the web service, then press Deploy on both. One catch worth knowing: the website bakes its settings in when it is built, like an address printed on flyers. Changing `NEXT_PUBLIC_API_URL` only counts after you redeploy the web service.

**You know it worked when:** https://dingba.ai opens your app.

### 8. Make your emails land in the inbox, not spam

Email providers trust senders who can prove who they are. The proof is three more entries in the same address book from step 7. Their names are SPF, DKIM and DMARC, and you never need to remember that; they are simply "the three lines that prove Dingba's emails are really from Dingba". Without them, a safety alert to a parent lands in junk mail, which is a real failure.

**Do this:** your email server (mailcow) has a page that shows the exact three entries, ready to copy. Add them at your registrar next to the entries from step 7.

**You know it worked when:** you email yourself a weekly recap from the app and it arrives in your normal inbox, not the spam folder.

### 9. Nightly copies of the cabinet (backups)

A backup is a copy of your database made every night, so a disaster costs you one day, not everything. Computers have a built-in alarm clock (techies call it cron): you give it one line and a time, and it runs that line for you every day.

**Do this:** on the Contabo machine, type `crontab -e` (this opens the alarm-clock list), paste the line below on its own row, save. It runs the copy at 3 a.m. every night.

```sh
0 3 * * * /path/to/ai-tutor/deploy/backup.sh >> /var/log/dingba-backup.log 2>&1
```

**The golden rule:** a backup you have never opened is a hope, not a backup. Once, on purpose, restore one copy into a scratch database and check the accounts are inside. [docs/RUNBOOK.md](RUNBOOK.md) walks you through it.

### 10. Two daily alarms for the product itself

Two features need a morning knock on the app's door: the daily study reminders, and the parents' Sunday-evening summary email. Each knock is one line. Use the same alarm clock as step 9 (or Railway's built-in Cron page): reminders every morning in your users' timezone, the summary once on Sunday evening. The `$ADMIN_KEY` part is the master password from step 4.

```sh
curl -X POST https://api.dingba.ai/admin/nudge-plans   -H "x-admin-key: $ADMIN_KEY"
curl -X POST https://api.dingba.ai/admin/weekly-digest -H "x-admin-key: $ADMIN_KEY"
```

## Part 2. First day live: prove it really works

Four checks that only make sense once everything above is on.

### Run the teaching report card

The project includes automatic report cards: they ask the live tutor questions and check that it teaches: guiding a child to the answer instead of blurting it out, staying in the chosen language, greeting learners by name. One line runs them all and prints pass or fail for each.

```sh
AI_CHAT_PROVIDER=llamacpp LLAMACPP_URL=http://YOUR-CONTABO-ADDRESS:8080 pnpm evals
```

### Run the stress test

This pretends 30 people are using Dingba at the same time and reports how fast it answered and whether anything failed. The app side is already measured and healthy; this run measures your AI computer too. Expect the brain to be the first thing that groans. That is normal, and when it happens we add a queue in front of it.

```sh
pnpm load -- --base https://api.dingba.ai --vus 30
```

### Try it on real phones

One iPhone and one cheap Android. Hold the talk button and hear your voice played back. Press the care-call button and see the phone's dialler open. Point the camera at homework in "Show Dingba". Add the app to the home screen, turn on airplane mode, and see it still open. Nothing should look squashed.

### Open your Command Centre

Go to dingba.ai/command and sign in with the email you set as the boss key in Part 1, step 3. From the Team tab, add your staff and your investors. Investors are safe to add: the system only ever shows them totals, such as user counts and revenue, and never any child's data.

## Part 3. Getting paid, when you want to

The payment machinery is built and tested. It needs your accounts and one real card.

### Open a payment account and connect it

Paystack is the right choice for Nigerian cards; Stripe for the rest of the world. In their dashboard: create the two subscription prices (Plus and Premium), copy the secret keys they give you into the app's settings card (the checklist names each setting), and give them your "receipt address". A receipt address (techies say "webhook") is just the payment company ringing your app's doorbell to say "this person has paid". Yours is:

```
https://api.dingba.ai/billing/webhook
```

### Pay yourself once, with a real card

Buy a Plus plan with your own card. **You know it worked when:** your account page shows the new plan, and the payment appears in the Command Centre's Money tab. Then cancel it and check that shows up too.

## Part 4. Before real children use it

Not technical at all, and not optional.

### Have a lawyer read the Terms and Privacy pages

They are honest drafts and say so on the page. A lawyer should check three things in particular: the rules about children's data (strict in America, Europe and Nigeria alike), the newer rules in several countries that say you must clearly disclose the tutor is an AI, and the care-call feature, because it stores a trusted adult's phone number.

### Try to break the tutor, by hand

The automatic protections are strong and tested. What no machine replaces: sit down with the live tutor and genuinely try to make it say something a child should never hear. Then have a friend, someone who thinks differently from you, try too. Write down anything that slips through and paste it into our chat. This is never "finished"; it is the habit that keeps companies like ours alive.

## Part 5. Things only you have

Each one unblocks a build the moment you hand it over. No order needed.

- **Your video-call code.** Send the files or the project name, and it gets wired into live classes.
- **WhatsApp business account.** Once approved by WhatsApp, reminders can reach parents where they actually are.
- **Your go-ahead on Nigerian-language voices.** The plan is ready ([docs/LANGUAGES.md](LANGUAGES.md)): free, legally clean voice recordings, about a day of computer time per language.
- **One email to NCAIR.** Their Hausa speech tool has no usage licence attached. A Nigerian company asking a Nigerian government body for permission is a short email with a good chance of a yes.
- **Character art, when you want it.** The current cast is original and fully yours. A professional illustrator's versions drop into one file.
- **Your call on the two marketing lines.** "Knows better than all your human teachers combined" and "100x better than their classmates" were softened because they promise what nobody can prove about a child's education. Say the word and the originals go back.
- **Where to launch first.** Your local-test-first plan stands. The choice decides which languages get voices first and which subjects deepen next. Either way the build stays global.

---

Stuck anywhere? You cannot break anything by trying. [docs/RUNBOOK.md](RUNBOOK.md) lists every common hiccup and exactly what to copy into the build chat so it gets fixed in one go.
