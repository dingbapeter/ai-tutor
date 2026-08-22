# Idea Parking Lot

Founder ideas parked for the right moment. Review this file at every sprint
planning. When an idea graduates, move it to the README roadmap with a target
sprint; don't delete history — mark it graduated.

Format: date · idea · why it's parked · when to bring it back.

---

## PARKED

### 001 — Generated learning formats per age group (cartoons & beyond)
- **Logged:** 2026-08-17
- **Idea (founder):** The personal AI tutor buddy should be able to create
  cartoons or other formats of learning for different age groups, for whatever
  their learning needs are.
- **Shape of it:** The tutor doesn't just converse — it *produces artifacts*
  matched to the learner's age and need: comic strips / cartoon panels
  explaining a concept for younger kids, illustrated story problems, songs or
  rhymes for memorization, meme-style summaries for teens, clean diagrams and
  one-pagers for adults. Formats become another dimension of the learner model
  (which format actually makes THIS student learn?).
- **Zero-spend note:** Text formats (stories, songs, scripts, quizzes) are free
  via the existing chat provider today. Static cartoon/comic panels need a
  self-hosted image model (SDXL/Flux-class) — GPU box required, same box as the
  voice pipeline. Animated cartoons are expensive; start with panels + the
  existing TTS voice reading the dialogue (a "radio cartoon").
- **Architecture hook:** Add a fifth gateway capability `imagine`
  (text→image) beside chat/stt/tts/vision so image engines stay swappable like
  everything else.
- **Bring back when:** Phase 2 (GPU box exists for voice — image gen rides on
  it), or earlier in text-only form: "explain as a bedtime story / comic
  script" can ship in Sprint 3 with zero new infrastructure.

---

### 002 — Bedtime stories, read aloud, for children AND adults
- **Logged:** 2026-08-22
- **Idea (founder):** Part of what the platform does should be reading bedtime
  stories to both children and adults.
- **Why it's strong:** It converts the tutor from a "homework tool" into a
  daily companion — bedtime is a ritual, and rituals drive retention like
  nothing else. It reuses the exact stack we already have (story generation
  via chat provider + Kokoro TTS + the persona's own voice + TTS cache), so
  the marginal build cost is small. For adults: wind-down stories, audiobook-
  style readings, even language-learning stories read slowly in the target
  language (double value with the language vertical). For kids: the SAME
  tutor character who taught them fractions reads them to sleep — that is
  relationship depth no competitor has.
- **Free content shortcut:** African Storybook / StoryWeaver / Global Digital
  Library (all CC BY, multilingual) give thousands of ready children's
  stories legally embeddable with attribution; Project Gutenberg &
  LibriVox-adjacent public domain texts cover adults. Personalized generated
  stories ("a story where Amina the astronaut uses fractions") layer on top.
- **Product shape v1:** "Story time" mode — pick length (3/5/10 min), pick a
  story (library or 'make one for me'), tutor reads it with the existing TTS,
  gentle pacing, optional soft page-turn sounds (Freesound CC0). Parents can
  schedule it (pairs with the WhatsApp/scheduling sprint). Safety layer
  already covers generated story content.
- **Bring back when:** Sprint 6/7 — after deploy. v1 needs zero new
  infrastructure; a "sleep timer + slower TTS speed" tweak and a story-pack
  format (stories as a new pack `vertical: "story-time"`) are the only
  engineering. Cartoon-illustrated stories join when the GPU phase lands
  (ties into #001).

### 003 — Speak all languages
- **Logged:** 2026-08-22
- **Idea (founder):** The tutor should be able to speak all languages.
- **Feasibility:** The brain and ears are nearly there already — Qwen-class
  models are strongly multilingual, and Whisper transcribes ~100 languages
  out of the box. The bottleneck is the MOUTH: Kokoro covers a handful of
  languages well; **Piper (MIT)** has free voices for dozens of languages and
  is the legal path to breadth; premium voices per flagship market can come
  later. Voice-per-language slots fit the existing gateway config cleanly.
- **Product angle:** ties directly to the vision doc's code-switching tutor
  (explains in English, drops into Yoruba/Hindi/Spanish when stuck) and to
  bedtime stories in the family's home language (#002).
- **Bring back when:** first language-vertical sprint; start with the top 5
  languages of our launch markets, not "all" — breadth follows demand.

### 004 — Remembers birthdays, sings birthday songs
- **Logged:** 2026-08-22
- **Idea (founder):** Tutor remembers birthdays from profile info and sings
  for the student.
- **Feasibility:** Birthday memory is trivial (profile field + scheduled
  trigger — pairs with the Sprint 6 scheduling/nudge work). Singing is the
  fun part: TTS engines don't sing. Path A (ship now): warm spoken birthday
  message from their tutor + "Happy Birthday" melody underneath (the song is
  public domain since 2016; Freesound CC0 for instrumentation) + a birthday
  card email to the family via mailcow. Path B (later, GPU): open
  singing-synthesis (DiffSinger-class) for actual persona singing voices.
- **Why it matters:** it's the single cheapest "the tutor KNOWS me" moment on
  the platform — pure retention magic, and parents will screen-record it and
  share it. Marketing that builds itself.
- **Bring back when:** Sprint 6 (scheduling exists) for Path A.

### 005 — Custom faces: pick from a gallery or upload a photo; hyper-real personas
- **Logged:** 2026-08-22
- **Idea (founder):** Users pick from faces or upload a picture they prefer —
  real human AI personas, "too real to be believed to be AI."
- **Feasibility:** Gallery of generated faces/styles: easy (DiceBear variants
  now; richer rigged sets with the avatar-v1 sprint). Photo upload →
  stylized avatar of yourself as tutor-character: GPU phase (img2img,
  self-hosted SDXL/Flux). Photoreal talking-head: expensive per-stream and
  uncanny-valley risky; stylized-real is the sweet spot.
- **⚠️ DESIGN BOUNDARY (non-negotiable):** maximum warmth and realism, but
  the platform ALWAYS discloses it's AI. (1) Ethics: our own vision doc
  commits to healthy-attachment guardrails for children. (2) Law: AI
  companion/chatbot disclosure requirements are live or arriving in several
  markets (California-style companion rules, EU AI Act transparency) —
  "believed to be human" as a product goal would be a regulatory time bomb.
  (3) Uploaded photos need consent rails: your OWN face as an avatar is
  delightful; arbitrary real people (classmates, exes, deceased relatives)
  is an impersonation/abuse surface we refuse. Frame the promise as
  "a character so warm you forget it's software — while never being lied to."
- **Bring back when:** gallery in avatar-v1 sprint; photo-upload in GPU phase.

## GRADUATED

### 006 — Bring-a-friend live classes (shipped v1, same day as parked)
- **Idea (founder, 2026-08-24):** a paid subscriber invites friends into a
  LIVE class; guests get limited time unless they're also paid — in which
  case the class draws from each member's own allowance.
- **Shipped:** invite codes (paid plans only, seats per plan), guest class
  pass (8 messages then a 402 upsell naming the host), member friends
  metered against their own plan, speaker-attributed group chat so the tutor
  addresses each student by name, class-full handling.
- **Remaining (parked):** full-duplex VOICE group classes ride on LiveKit in
  Phase 2; guest-pass → signup conversion funnel UI in the web app.

### 001 (text slice) — story / comic-script / song formats → shipped in Sprint 3
- Message endpoint accepts `format: story|comic|song`; UI has format chips.
- Remaining (image/cartoon panels, format-preference learning) stays parked
  under 001 for the GPU phase.
