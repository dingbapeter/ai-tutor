# Blind Spots — the honest "what we're not seeing" register (2026-08)

Things no current test catches and no sprint has addressed. Ordered by how
badly each bites when real users arrive. Keep this file current: remove items
when fixed, add items when discovered. The honesty table says what IS built;
this file says what ISN'T even watched.

## Will bite in week one

1. **No notifications.** No web push (VAPID), no study nudges, no "your tutor
   is waiting" — the entire retention loop outside the session is missing.
   Web Push is free; needs a service worker + permission flow + scheduling.
2. **iOS Safari voice is untested.** MediaRecorder on iPhones produces
   audio/mp4, not webm, and has quirks. Push-to-talk may silently fail for
   every iPhone user. Needs real-device testing + mimeType fallbacks.
3. **Not a PWA.** No manifest.json, no service worker → can't "Add to Home
   Screen" properly, no offline shell, no push. For app-store-free
   distribution in our markets this is table stakes.
4. **Mobile layout unverified.** Built desktop-first; the session screen,
   practice panel, and exam panel have never been checked at 360px width.
5. **Low-bandwidth behavior.** Target markets have flaky networks; SSE
   streams and voice uploads have no retry/queue/resume. A dropped
   connection mid-reply loses the turn.

## Will bite at deploy/scale

6. **Single-instance state.** Live sessions (and invite codes, exam state)
   are in one process's memory. Two Railway instances = broken sessions.
   Needs sticky sessions at minimum; Redis-backed session state eventually.
7. **Never load-tested.** Unknown: how many concurrent SSE streams + one
   llama.cpp queue behave. Expect request pile-ups without a queue/backoff.
8. **Timezone naivety.** "Daily" allowances reset at server midnight, not
   the student's midnight. Lagos user on a US server resets at odd hours.
9. **No automated backups.** pg_dump cron + offsite copy: designed, not
   implemented.
10. **Observability not deployed.** PostHog/GlitchTip are chosen but not
    installed; at launch we'd be blind to errors and retention.

## Legal/trust (must exist before real children)

11. **No ToS, privacy policy, or parental-consent flow documents.**
12. **No data deletion.** Parents can't erase a child's data (GDPR/COPPA
    "right to erasure"); no retention policy on transcripts/incidents.
13. **Auth tokens never expire** and there's no "log out everywhere".
14. **No password reset / email verification** (known, Sprint 6b).

## Product experience gaps

15. **No onboarding/diagnostic.** First session starts cold; no placement
    quiz seeds the knowledge graph.
16. **No session history viewer.** Past transcripts are stored but
    unreachable in the UI; memory is the only continuity a user can see.
17. **No copy button / share-a-recap** on messages (native select works).
18. **No streaks/motivation loop.** Practice between sessions has no pull.
19. **Curriculum is thin.** 58 generated problems, 3 packs — a seed, not a
    syllabus. The Siyavula/IM ingestion pipeline is designed, not built.
20. **English-only UI**; no i18n scaffolding.
21. **Empty states & error copy** unpolished (first-run, no-students,
    server-down screens).

## Standing risks (not fixable by code alone)

22. **Pedagogy quality depends on the deploy model** — 7B minimum; 0.5B was
    a protocol test only. Needs a pedagogy eval harness to catch regressions.
23. **Model-safety drift.** The rules layer is deterministic, but the
    LLM-side classifier and tutor behavior need periodic red-teaming.
24. **Guest-usage metering keys on studentId** — a determined free user can
    rotate names for fresh allowances until accounts are required.
