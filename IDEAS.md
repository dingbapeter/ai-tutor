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

## GRADUATED

### 001 (text slice) — story / comic-script / song formats → shipped in Sprint 3
- Message endpoint accepts `format: story|comic|song`; UI has format chips.
- Remaining (image/cartoon panels, format-preference learning) stays parked
  under 001 for the GPU phase.
