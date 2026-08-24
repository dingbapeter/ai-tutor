# Languages: what is possible, what it costs, what is legal

Researched and licence-verified 2026-08-24 by querying the model and dataset
registries directly, not from memory. Every claim below has a licence attached
because our rulebook (`docs/RESEARCH.md`) forbids non-commercial weights, and
this is the area of AI where the best-known models are exactly that.

## The headline

Dingba currently declares **91 languages**. Split three ways:

| Capability | Coverage | Engine |
|---|---|---|
| Understands typed input | all 91 | multilingual chat model |
| Understands speech | ~99 languages | Whisper (Apache-2.0) |
| Teaches in text | all 91 | multilingual chat model |
| **Speaks aloud** | **52 today** | Kokoro-82M (Apache-2.0) + Piper (MIT) |
| Speaks aloud | 39 pending | needs a voice trained or commissioned |

`config/languages.json` is the source of truth. Adding a language is one entry.

## The licence trap, stated plainly

The best-known open models for African and low-resource languages are
**CC-BY-NC-4.0**, which means non-commercial. Verified directly:

| Model | What it does | Licence | Verdict |
|---|---|---|---|
| `facebook/mms-tts-yor` | Yoruba TTS | cc-by-nc-4.0 | ❌ cannot ship |
| `facebook/mms-tts-hau` | Hausa TTS | cc-by-nc-4.0 | ❌ cannot ship |
| `facebook/nllb-200-*` | translation, 200 languages | cc-by-nc-4.0 | ❌ cannot ship |
| `lelapa/InkubaLM-0.4B` | African-language LLM | cc-by-nc-4.0 | ❌ cannot ship |
| NaijaVoices (main release) | 1M+ rows Igbo/Yoruba/Hausa speech | cc-by-nc-sa-4.0 | ❌ cannot ship |
| AfriSpeech-200 | 200h African-accented speech | cc-by-nc-sa-4.0 | ❌ cannot ship |

A commercial product that ships MMS voices for Yoruba is infringing, quietly,
until someone notices. Plenty of startups do it. We will not.

Most Nigerian-language models on the registries carry **no licence at all**
(`unspecified`), which defaults to all-rights-reserved. Also unusable without
written permission from the author, which is sometimes worth asking for.

## What IS usable, verified

| Asset | Covers | Licence | Use |
|---|---|---|---|
| **Piper voices** | 56 language variants incl. Swahili, Arabic, Hindi, Vietnamese, Ukrainian, Urdu, Telugu, Malayalam, Nepali, Kazakh, Georgian | **MIT** | ✅ shipping now |
| **Kokoro-82M** | English (US/UK), Spanish, French, Hindi, Italian, Portuguese, Mandarin, Japanese | **Apache-2.0** | ✅ shipping now |
| **Whisper** | ~99 languages, speech in | **Apache-2.0** | ✅ shipping now |
| **NaijaVoices (compressed release)** | **Igbo, Yoruba, Hausa** speech, 1M–10M rows | **CC-BY-SA-4.0** | ✅ train our own voices |
| **Masakhane** models + datasets | dozens of African languages | **AFL-3.0** | ✅ permissive, commercial OK |
| **Common Voice** | ~130 languages incl. Yoruba, Igbo, Hausa, Kinyarwanda, Luganda, Swahili | **CC0** | ✅ public domain |
| **FLEURS** (Google) | 102 languages, read speech | **CC-BY-4.0** | ✅ attribution only |
| **OpenSLR** African sets | Yoruba and others, crowdsourced | CC-BY-SA-4.0 | ✅ attribution + share-alike |
| **Piper training pipeline** | trains new VITS voices from data | **MIT** | ✅ how we get Yorùbá |

The two NaijaVoices releases carry **different licences**. The compressed one
is CC-BY-SA-4.0 and is the one to build on. Check before every download.

## The Nigerian-language plan

There is no shippable open TTS voice for Yorùbá, Igbo or Hausa today. There is
enough openly-licensed **data** to make one, which is a different and better
position to be in: we would own the result outright.

1. **Data**: NaijaVoices compressed (CC-BY-SA-4.0, all three languages) plus
   Common Voice (CC0) plus OpenSLR Yoruba (CC-BY-SA-4.0).
2. **Architecture**: Piper's own VITS training pipeline (MIT), which exists to
   do exactly this and runs on one GPU.
3. **Result**: `.onnx` voices we host ourselves, slot straight into the voice
   map as `yo_NG-dingba-medium`, and route automatically through the engine
   router already shipped.
4. **Share-alike duty**: CC-BY-SA obliges us to release the trained voices
   under the same terms. That is a feature, not a cost: Dingba becomes the
   company that gave Yorùbá, Igbo and Hausa their open voices. Nobody can take
   that story from us, and every Nigerian edtech that uses them credits us.
5. **Effort**: single-speaker VITS voices train in roughly a day per language
   on the GPU box we already plan for full-duplex voice. Studio recordings of
   one good speaker per language (a few hours of scripted audio) would raise
   quality further and carry no licence baggage at all.

Also worth pursuing, in parallel and cheaply:

- **NCAIR** (Nigeria's National Centre for AI and Robotics) publishes a Hausa
  ASR model with no licence attached. A short email could turn that into a
  licence grant. Government bodies usually say yes to a Nigerian company.
- **Spitch** and similar Nigerian speech startups sell commercial APIs for
  Yorùbá, Igbo, Hausa and Nigerian-accented English. Not open, but a legal
  bridge for launch while our own voices train, and the gateway already makes
  adding a paid provider a config change.
- **Nigerian-accented English** deserves its own voice regardless of the
  native-language work: it is what most Nigerian learners actually want to
  hear, and Common Voice plus NaijaVoices cover it.

## African languages we teach today, voice pending

Yorùbá, Igbo, Hausa, Amharic, Zulu, Xhosa, Afrikaans, Kinyarwanda, Luganda,
Shona, Chichewa, Somali, Wolof, Tigrinya, Oromo, Fulfulde, Twi, Ewe, Bambara.
Swahili already **speaks** through Piper.

Each teaches, reads, and listens now. The picker says so per language rather
than pretending. That honesty is the product decision: a learner in Ibadan
finding out mid-session that "speaks all languages" was marketing would cost
us more than the feature gains.

## Adding a language

1. Add the entry to `config/languages.json` with its native name.
2. If a Piper or Kokoro voice exists, map the five persona profiles
   (`warm-female`, `firm-male`, `bright-female`, `clear-female`,
   `steady-male`) to voice ids. Otherwise set `voices: null` and it teaches in
   text while its voice is trained.
3. Install the voice on the TTS box. Piper voices route automatically by id
   shape, no code change.
4. Credit the source in `config/credits.json` if the licence asks for it.
