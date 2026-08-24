# DINGBA.AI — Product Vision & Design Direction (founder upload, 2026-08-24)

**Domain: `dingba.ai` — PURCHASED by the founder (confirmed 2026-08-24).**
**Narrative/tagline: "dingba.ai — Your Personal A.I Tutor".**
Use the tagline verbatim in the rebrand: page titles, hero subline, email
sender name, PWA manifest, README. Deploy targets to move to the domain when
DNS is pointed: `WEB_ORIGIN=https://dingba.ai`, api on `api.dingba.ai`,
mailcow sender `tutor@dingba.ai` (or similar mailbox the founder creates).

Digest of the two founder documents shared at the end of the 2026-08-24
session (feature spec + homepage design template). This file is the driving
spec for upcoming sprints. Source images: to be added under `docs/design/`
next session (they arrived via chat; re-upload to commit the originals).

## 🎉 THE NAME IS SETTLED: **DINGBA.AI**

The founder's document opens: "now that DINGBA.AI is settled, I would design
the product around one very strong idea." Per house rule 7 this triggers the
**single rebrand commit** — planned for next session: "AI Tutor" placeholder →
Dingba across web UI, email senders, PWA manifest, README, personas config
(tutor characters keep their own names; Dingba is the platform/brain).

## Founder directives (2026-08-24, session 2 — "the identity build")

Three standing directives, given as we resumed building:

1. **All of life's learning, not just school.** Dingba serves the schoolchild
   AND: the man rehearsing his U.S. visa interview, the woman preparing for
   CFA or ACCA, the new hire fighting imposter syndrome who needs a
   companion-coach, the retiree learning a language. Every field of learning
   is in scope. The engine was always subject-agnostic (curriculum packs);
   the product surface (personas, subjects, copy) must now say so too.
   Homepage section 8 ("Your entire learning life") was already pointing
   here — it is now the headline positioning, not a footnote.
2. **Safety boundary, restated for adults.** "All fields of learning" has one
   carve-out: no instruction in causing harm — weapons, explosives,
   dangerous synthesis, and the like. The moderation gate is not a
   kids-only feature; it runs for every learner at every age tier, with
   age-appropriate policies (child policy = strictest; adult policy still
   refuses harmful-capability tutoring). Never weaken; extend (house rule 5).
3. **An app, not a website.** The product must feel like a native app:
   installed PWA, app shell with persistent navigation, instant transitions,
   gestures/motion, offline grace, mobile-first layouts. The web is the
   distribution channel; the experience standard is the app store.
   (Register item H2 graduates from "design pass" to "app-shell rebuild".)

4. **The characters are LIVE, not a chatbox (2026-08-24).** Dingba is not a
   text tutor with personas painted on. People must feel they are talking
   to an actual person: the tutor speaks first when you arrive, greets you
   by name, remembers you out loud, talks in their own voice by default,
   and is visibly present (avatar idle/speaking states, human status
   lines). This is the separation from Claude/GPT/study modes: they are
   chat surfaces; Dingba is a person you meet. Every session-surface
   decision gets judged by "would a live tutor do this?". Full-duplex
   interruptible voice (Dingba Live) completes this in the GPU/LiveKit
   phase; presence does not wait for it.
   **Founder asset (2026-08-24): a video-conferencing interface with core
   academic tools already exists, built by the founder outside this repo.**
   Plan: bring it into the monorepo (or attach its repo), wire it to the
   existing live-class layer (invite codes, participants, metering) with
   LiveKit as the self-hosted media backbone. Waiting on the founder to
   share the code (archive upload or repo name).
5. **No AI tells in the product.** Nothing user-facing should read as
   machine-written. Concretely: no em dashes in UI copy, marketing copy,
   emails, or canned messages; no assistant-isms ("Certainly!", "I'd be
   happy to", "As an AI"); no boilerplate hedging; contractions welcome;
   short human sentences. The tutor characters speak like people. This is
   a copy standard for every user-facing surface (internal docs and code
   comments are exempt). Also steer the chat system prompts so model
   output follows the same voice.

Founder's bar for the whole effort: "the best thing I will ever build — it
carries my name." Premium, sovereign-level quality is the acceptance
criterion for every sprint from here.

## The one strong idea

> **Dingba should not be an AI chatbot that happens to tutor.
> It should be an AI tutor that happens to have a chatbot interface.**

Personalised tutoring, guided problem-solving, multimodal interaction,
adaptive content, assessment and progress tracking — not answer dumping.
(Founder cites Google Learn Your Way and Khanmigo's Socratic emphasis as the
direction the field is moving; Dingba goes considerably further.)

## The eight pillars (feature spec, left document)

### 1. The Dingba Brain — persistent Learning Profile (the heart)
Every learner has a profile Dingba builds over time. Fields the founder
enumerated: name, age, grade/year, school/university, curriculum, subjects,
current level, learning goals, strengths, weaknesses, knowledge gaps,
preferred learning style, reading level, preferred explanation complexity,
languages, interests, exam dates, target grades, learning history, previous
mistakes, topics mastered, topics requiring reinforcement, pace of learning,
typical session length, confidence levels, areas where the learner
repeatedly gets confused.
**The critical difference: Dingba remembers the learner.** Struggled with
fractions three weeks ago → today's conversation is not a blank slate.
*Existing foundation: memories table + mastery/FSRS fields + cross-session
memory (live-verified). Needs: structured profile schema far beyond the
current compressed memory lines.*

### 2. Personal AI Tutor — the central experience
"Teach me photosynthesis" must NOT just produce an article. Dingba first
determines: Who am I teaching? → What do they already know? → What are they
trying to achieve? → What's the best teaching strategy? Then runs an actual
tutoring session.
**Teaching modes**: Explain · Teach me · Simplify · Deep dive · Socratic ·
Show me · Give me an example · Try me · Why? · Compare · Teach it back.
"Teach it back" is emphasized: Dingba should detect whether the learner
actually understands — can they recognise/produce an explanation?
*Existing: Socratic contract in the system prompt, format chips. Needs:
explicit mode system, teach-back assessment.*

### 3. Ask Dingba Anything — the universal entry point
One massive input box: "What do you want to learn?" accepting text, voice,
image, PDF, screenshot, camera, document, web link, handwritten work,
equation, code. Examples: upload maths homework → Dingba understands it;
photograph a textbook page → Dingba teaches it; upload lecture notes →
Dingba creates a course; upload an exam paper → Dingba analyses it; paste an
essay → Dingba tutors the student through improving it.
*Existing: text + push-to-talk voice; vision gateway slot (Qwen-VL at
deploy). Needs: file/PDF/link ingestion pipeline, camera capture UI.*

### 4. Vision Tutor — major feature
Learner takes a picture: "I don't understand this." Dingba recognises maths
problems, diagrams, chemistry equations, physics questions, graphs, maps,
biology diagrams, handwriting, textbook pages, charts, tables, geometry,
code on screen — and then asks: **"Would you like me to explain the
question, give you a hint, or teach you the concept behind it?"** — much
better than simply solving the photograph.
*Existing: gateway `see` capability + homework-camera parked for Phase 2.
This promotes it to a headline feature.*

### 5. Voice Tutor — potential killer feature
Natural conversation: interruptions, follow-up questions, different voices,
speaking speed, pronunciation correction, language practice, reading aloud,
conversation practice. Eventually **Dingba Live** — real-time voice
tutoring session (matches the LiveKit Phase 2 plan).
*Existing: push-to-talk turn loop (tested). Needs: the full-duplex leap.*

### 6. Personalised Lesson Generator
"Teach me Algebra" → builds a lesson based on the learner. Structure per
lesson: learning objective → warm-up (3 questions based on prior knowledge)
→ teach (5-minute explanation) → example (worked problem) → your turn
(3 problems) → check (adaptive assessment) → challenge.
*Existing: curriculum packs + SymPy-verified problems + practice loop.
Needs: dynamic lesson assembly per learner.*

### 7. Adaptive Learning Engine — "the serious moat begins"
Dingba continuously estimates "What does this learner know?" Per-skill
ladder: Not introduced → Introduced → Developing → Practising → Proficient →
Mastered → Needs reinforcement.
*Existing: mastery table with FSRS-style fields (level, dueAt,
stabilityDays) — rename/map levels onto this ladder; spaced-repetition
warm-ups (in-progress work, reverted pending this spec) slot right in.*

### 8. Diagnostic Assessment
Before teaching a subject: "Let's find out what you already know" → Dingba
generates a diagnostic test → produces a per-skill profile, e.g. Algebra:
Variables 92%, Expressions 76%, Linear equations 48%, Factorisation 21%,
Quadratics not assessed → "Dingba recommends starting with…".
*Existing: placement-check onboarding (short). Needs: full per-skill
diagnostic with a visible profile output.*

## Homepage design template (right document)

Overall: modern, clean, engaging. Light page with **indigo/purple accent**
(#6C5CE7-ish family), generous whitespace, rounded cards, soft shadows.
A warm, friendly **3D avatar character** (young Black student in a Dingba
hoodie) fronts the brand.

Sections, top to bottom:
1. **Nav**: DINGBA.AI · Learn · Subjects · How it works · For Parents ·
   For Schools · Log in · [Start learning →] (indigo pill button).
2. **Hero**: "Meet your personal **AI** tutor." (AI in indigo) — "Ask
   anything. Upload anything. Learn anything." Universal input box ("What do
   you want to learn today?") with mic/attach/camera icons + send. Try-chips:
   "Explain quantum physics simply", "Help me solve this equation",
   "Prepare me for WAEC Biology". CTA: [Start with Dingba →]. Avatar right.
3. **"Not just answers. Understanding."** — side-by-side chat example:
   student asks why d/dx x² = 2x; Dingba: "Let's work it out together.
   Before I explain, what happens when you increase x from 2 to 3?" next to
   a handwritten-style worked slope panel. Carousel dots.
4. **"One tutor. Every subject."** — icon grid: Mathematics, Science,
   Languages, Coding, History, Business, Writing, Exam Prep.
5. **"Dingba gets to know you."** — learning-profile card (e.g. Peter's
   Learning Profile: Mathematics 78%, Physics 64%, English 91%, Chemistry
   71% as progress bars) + copy: "Your tutor remembers what you've learned.
   It knows what you're good at, where you're struggling, what you've
   already studied and what you need to work on next."
6. **"Learn your way."** — four cards: Talk to Dingba (voice conversation) ·
   Show Dingba (upload an image/document) · Watch Dingba (visual
   explanations) · Challenge Dingba (practice and assessment).
7. **"From 'I don't understand' to 'I get it.'"** — journey strip:
   Question → Explanation → Guided Practice → Feedback → Mastery.
8. **"Your entire learning life."** — School · University · Exams ·
   Languages · Coding · Career · Curiosity. "Dingba grows with you."
9. **Footer CTA** (dark indigo): "Ready to learn? Your tutor is waiting."
   [Start learning with Dingba →] + social icons.

## Mapping: what the current build already gives us

| Vision piece | Status in repo |
|---|---|
| Remembers the learner | ✅ memories + mastery + recaps (thin vs. Brain spec) |
| Socratic tutoring contract | ✅ system prompt; modes/teach-back missing |
| Voice (turn-based) | ✅ push-to-talk; full-duplex = Phase 2 |
| Vision slot | ✅ gateway `see`; no UI/pipeline yet |
| Verified practice + misconceptions | ✅ SymPy loop, 100-problem bank |
| Adaptive scheduling fields | ✅ FSRS-style columns, warm-ups not wired |
| Placement check | ✅ short version; full diagnostic missing |
| Safety, family, billing, metering, orgs, API keys | ✅ (the business chassis the vision sits on) |
| Universal multimodal input, lesson generator, profile schema, new homepage | ❌ new build |

## Proposed sequencing (to confirm next session)

1. **Rebrand commit** (rule 7): Dingba name + indigo design tokens.
2. **New homepage** per the template (static sections + universal input box
   routing to the existing session flow) — also answers the "too simplistic"
   register item H2.
3. **Dingba Brain v1**: structured learner-profile schema (the founder's
   field list), fed by sessions, shown as the profile card.
4. **Adaptive engine v1**: mastery ladder naming + spaced-repetition
   warm-ups (work already scoped) + diagnostic assessment.
5. **Ask/Show Dingba v1**: image + PDF upload through the vision slot with
   the explain/hint/concept ask.
6. Teaching modes + teach-back; lesson generator; voice upgrades ride the
   Contabo GPU/LiveKit phase.

## Open questions for the founder

- Rebrand scope: web UI + emails + PWA now; do the tutor personas
  (Amara/Kofi/Juno) stay as Dingba's "faces", per the current architecture?
- The 3D avatar asset: source/licensing for the hoodie character (needs a
  ✅-licensed asset or commissioned art; register item, rule 2).
- ~~Domain(s): dingba.ai availability/ownership~~ ANSWERED: founder owns
  `dingba.ai` (2026-08-24). Remaining: which mailbox name for the sender,
  and when to point DNS (Railway custom domains + mailcow SPF/DKIM for
  deliverability — do this before real parent emails go out).
