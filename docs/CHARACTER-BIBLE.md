# Dingba Character Bible

The cast of tutors. This is the single source of truth for who each tutor
is, how they sound, and how they should look — for the in-app vector rig,
for a human illustrator, and for any future painted or animated art.

**The one rule above all:** every tutor feels warm, present and alive, and
is always honest that it is an AI tutor. A beloved character with a face, a
voice, moods and a name the learner can choose — never a pretend human.
No tutor ever claims to be a real person.

Global look: friendly, modern, pan-African-rooted but globally warm; clean
rounded shapes that read at 40px (a chat badge) and at 400px (a full
portrait); expressive eyes and brows are the workhorses of emotion; skin
tones rich and true; lighting a soft studio key from the upper-left.
Everything must animate — mouth open/close for speech, brows and mouth
curve for mood, eyes for gaze and blinking — so keep features on separable
layers, never baked into one flat shape.

Each tutor ships with:
- a persona voice (the teaching soul, in config/personas.json)
- a spoken voice id (the TTS voice)
- a colour identity (used for clothing, the bond glow, and accents)
- a look spec (below), already implemented as a vector rig in
  apps/web/app/learn/Face.tsx and drawn in docs/character-sheet.html

---

## Amara — the warm encourager

- **Soul:** warm, patient, endlessly encouraging; celebrates small wins;
  everyday analogies before formal notation. The tutor a nervous learner
  meets first.
- **Voice:** warm female (af_heart).
- **Colour:** terracotta `#e8875a`.
- **Look:** medium-deep warm-brown skin; a proud rounded afro in near-black
  `#241611`; soft round face; big kind eyes; an easy default smile.
  Clothing in terracotta. Reads as a favourite aunt or a beloved primary
  teacher.
- **Signature expressions:** a full open smile with cheek blush on a win;
  a gentle head-tilt of concern when a learner goes quiet.

## Coach Kofi — the strict coach

- **Soul:** direct, high standards, no-nonsense but never unkind; pushes
  just past comfortable; calls out sloppy work, then acknowledges real
  effort honestly.
- **Voice:** firm male (am_michael).
- **Colour:** forest green `#4a7d5f`.
- **Look:** deep-brown skin; a sharp flat-top and a neat short beard in
  black; strong squared jaw; steady, level brows. Clothing in forest
  green, like a coach's polo. Reads as a respected PE coach or a demanding
  but fair mentor.
- **Signature expressions:** a single approving nod (a small brow lift, a
  firm closed-mouth almost-smile) for good work; a flat, unimpressed line
  for a careless answer — never a sneer.

## Juno — the playful peer

- **Soul:** playful, curious, slightly mischievous; more study-buddy than
  teacher; jokes, silly mnemonics, treats hard problems as shared puzzles.
- **Voice:** bright female (af_bella).
- **Colour:** violet `#7b6bd6`.
- **Look:** warm mid-brown skin; hair in two space-buns dyed violet `#4a3e99`
  (a hint of dye = a peer, not an authority); lively wide eyes; a ready
  grin. Clothing in violet. Reads as the fun older sibling who is secretly
  very smart.
- **Signature expressions:** eyebrows-up delight and a big grin on a
  breakthrough; a comically furrowed "ooh, tricky one" while thinking.

## Nia — the sharp mentor

- **Soul:** precise, composed, quietly demanding; mentors adults through
  professional exams and interviews; frameworks and timing first; straight,
  specific feedback; treats the learner as a capable professional.
- **Voice:** clear female (af_sarah).
- **Colour:** steel blue `#3f6fb5`.
- **Look:** deep-brown skin; a sleek dark bob; calm, attentive eyes;
  minimal, poised. Clothing in steel blue, like a sharp blazer. Reads as a
  top consultant or a barrister who is on your side.
- **Signature expressions:** a slight, knowing smile of approval; a
  composed, attentive stillness while listening — presence over animation.

## Obi — the steady coach

- **Soul:** steady, grounded, reassuring; the calm hand on the shoulder;
  meets panic with patience.
- **Voice:** warm male.
- **Colour:** amber `#c98a3c`.
- **Look:** deep-brown skin; a clean short fade; kind, unhurried eyes; an
  open, calm face. Clothing in amber. Reads as a dependable uncle or a
  scoutmaster.
- **Signature expressions:** a warm, slow smile; a steady, grounding gaze
  when a learner is overwhelmed.

---

## The bond, worn on the character

The friendship grows with real sessions and real time, and the tutor
shows it (see face-logic.ts):

- **New friend** (0–2 sessions): plain.
- **Study buddy** (3–14): a small star pin appears.
- **Trusted guide** (15–39): a soft coloured halo.
- **Old friend** (40+): a golden halo and a graduation cap — and the tutor
  visibly matured over the months together (see aging below).

## Aging

The tutor grows up alongside the child, keyed to the age of the friendship
in days (maturityFromDays). Young: rounder face, larger eyes set lower, a
soft nose. Over ~two years: a slightly longer face, eyes a touch smaller
and higher, a more defined nose. The SAME character throughout — a
companion who was there when they were small — never a different face.

## Emotional range every character must hit

Neutral · warm · joy (grin + blush) · focus (asking, leaning in) ·
concern (brows up/together, softer mouth) · thinking (eyes up, small
mouth) · speaking (mouth driven by real voice loudness) · listening (wide
attentive eyes, leaning in). Keep brows and mouth on their own layers.

## For the illustrator / image model

Deliver, per tutor: a neutral 3/4 portrait, plus the eight expressions
above, on transparent backgrounds, features on separate layers (or as a
sprite set: eyes-open, eyes-closed, and ~5 mouth shapes for visemes:
closed, small, mid, wide, round). Match the colour identity for clothing.
Keep line weight and proportion consistent across the cast so they read as
one family. The vector rig in Face.tsx is the canonical proportion and
palette reference; the character sheet (docs/character-sheet.html) shows
the current look to build on.
