# Blind Spots — the honest "what we're not seeing" register (updated 2026-08-24)

Keep this file current: strike items when fixed, add items when discovered.
The README honesty table says what IS built; this file says what isn't — or
what's built but still needs something only deploy/devices/lawyers provide.

## Resolved in the blind-spot sprint ✅

1. **Notifications** — BUILT: web push (VAPID), service worker, subscribe
   flow, enable button on account page, `/admin/nudge` for a deploy cron.
   Needs VAPID keys generated at deploy (`npx web-push generate-vapid-keys`).
2. **PWA** — BUILT: manifest, icons, offline-shell service worker;
   installable to home screen.
3. **Timezone-fair limits** — FIXED: allowances use a rolling 24h window.
4. **Backups** — BUILT: `deploy/backup.sh` (pg_dump, 14-day rotation,
   offsite hook); needs its cron entry at deploy.
5. **ToS/Privacy/consent** — DRAFTED: `/terms` + `/privacy` pages, consent
   line at registration. Marked DRAFT — needs counsel before launch.
6. **Data deletion** — BUILT: `DELETE /me` erases everything; account-page
   button with typed confirmation.
7. **Token lifecycle** — FIXED: 30-day expiry; `/auth/logout` revokes all.
8. **Password reset** — BUILT: forgot → emailed link → `/reset` page →
   old sessions revoked (email delivery goes live with SMTP at deploy).
9. **Onboarding diagnostic** — BUILT: first sessions run a short placement
   check before teaching.
10. **Transcript viewer** — BUILT: guardian-only transcript on the dashboard.
11. **Copy button** — BUILT on tutor messages.
12. **Streaks** — BUILT: consecutive-day streak on the dashboard.
13. **Curriculum** — EXPANDED: 100 SymPy-verified problems across 10 skills.
14. **Guest rotation abuse** — MITIGATED: per-IP daily guest-session cap.
15. **Error visibility** — BUILT: 5xx → `ERROR_WEBHOOK_URL` (any webhook).
16. **iOS voice hardening** — mimeType fallback chain (webm→mp4→aac) in code.
17. **Flaky networks** — offline banner + one-retry on sends.

## Still open — needs things this codebase can't provide alone

A. **Real-device testing** (esp. iPhone voice + mobile layouts at 360px) —
   needs physical devices at deploy time.
B. **Load testing** — needs the deployed stack; expect to add a request
   queue in front of llama.cpp.
C. **Single-instance session state** — one server only until sticky sessions
   / Redis-backed state (fine for MVP scale; document in Railway config).
D. **Observability deploy** — PostHog + GlitchTip on Contabo (chosen, not
   installed); the webhook hook covers errors until then.
E. **Legal review** — the drafted ToS/Privacy need a lawyer before launch.
F. ~~**Email verification** at signup~~ BUILT 2026-08-24: token email →
   `/verify` page, resend button, dashboard banner; soft-gate (unverified
   accounts still work — recaps/alerts just aren't trusted until confirmed).
   Live SMTP send happens at deploy.
G. **i18n** — English-only UI; scaffolding not started.
H. **Share-a-recap; richer motivation loop** (goals, rewards) — product
   backlog, not risks.
H2. **App-shell rebuild** — founder verdict on first live deploy (2026-08-24):
   "too simplistic"; upgraded to "feel like an app, not a website".
   DONE same day for every existing page: design system (indigo tokens,
   dark mode, Plus Jakarta Sans, motion), app bar + wordmark, immersive
   session, home/session/account/credits/terms/privacy/reset/verify all
   restyled; light/dark/mobile/desktop screenshot-verified locally.
   Remaining: bottom tab nav (worth it once Progress/Library sections
   exist), real-device pass at deploy (register item A).
I. **Pedagogy eval harness** — needed before/after every deploy-model swap;
   design in HANDOFF next-work list.
J. **Ongoing red-teaming** of safety — periodic, human-led, never "done".
K. **Siyavula/Illustrative Mathematics ingestion** — the content-scale
   pipeline (licensing rules in docs/RESEARCH.md).
