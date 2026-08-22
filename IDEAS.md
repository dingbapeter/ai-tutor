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

## GRADUATED

### 001 (text slice) — story / comic-script / song formats → shipped in Sprint 3
- Message endpoint accepts `format: story|comic|song`; UI has format chips.
- Remaining (image/cartoon panels, format-preference learning) stays parked
  under 001 for the GPU phase.
