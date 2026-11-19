# The 3D tutors

A beginner's walkthrough for the artists, from a bare computer to a
finished tutor, is docs/CHARACTERS-STEP-BY-STEP.md. This file is the
engineering reference behind it.

How a rigged character becomes a living Dingba tutor, what the artist must
deliver, how it is checked, and what happens where it cannot run.

## The one-line contract

A tutor is a glTF 2.0 binary (`.glb`) with the 52 ARKit face sliders, eye
and head nodes, textures embedded, under 15 MB. The full brief the artist
works from is in the handoff pack the founder holds; the machine-checkable
part of it is `apps/web/app/studio/check.ts`, which the Studio page runs
in the artist's browser and `tools/avatar/validate-glb.ts` runs from the
command line. Same code, same verdict.

When a model passes, it is dropped into the web app's public folder and
named on its persona in `config/personas.json`:

```json
{ "id": "amara", "name": "Amara", "model": "/tutors/amara.glb", ... }
```

That is the whole integration. The API serves the `model` field with the
persona, and the lesson page loads the 3D engine on demand for any tutor
that has one. Tutors without a model keep the drawn face. Nothing else in
the product changes.

## The Studio: the artist checks their own work

`/studio` on any running web app (the live site too). Drop a .glb on the
page and three things happen in the browser, with nothing uploaded:

- the file is checked against the contract and every line is written in
  the artist's own terms ("sliders that move nothing: mouthPucker",
  "textures referenced as separate files: skin.png (embed them)"), with a
  verdict and a count of things to fix. A "work in progress" switch turns
  the budgets (size, triangles, skeleton) into warnings so a half-built
  character can still be looked at; the rig checks always count;
- the same engine the lesson uses brings it to life: a sample line with
  lip sync from a stand-in voice (the words decide the mouth shapes, the
  sound decides the timing; `app/studio/voice.ts`), each mood, each
  attention state;
- a walk through every slider, one at a time, up and back down, with its
  name on screen and the head held still, so a slider that pulls the wrong
  part of the face is caught by eye before anyone else sees it.

`/studio?model=/tutors/amara.glb` opens a character already installed.
"Copy report" puts the whole check on the clipboard for whoever is asked
to help. The page is public and harmless: it reads only the file it is
given, and the lesson page is unchanged by it.

## From a raw export to a tutor file

What Unreal (a MetaHuman) or any DCC exports is close to the contract and
never exactly it: several levels of detail, a whole body, bones named the
tool's way, 8K textures, centimetres, and face sliders with a prefix. One
Blender command takes that and writes the contract file:

```
blender -b -P tools/avatar/prepare-character.py -- --in face.fbx --out amara.glb
```

It imports FBX, glTF or OBJ; drops every level of detail but the highest;
brings centimetres to metres; cuts the body to a bust below a chest bone
(`--cut-at spine_03` by default, `--no-cut` to keep it all), never touching
the face; renames bones from MetaHuman, Mixamo and Blender names to Hips,
Spine, Neck, Head, LeftEye and RightEye, and steps a mesh aside if it
would share a bone's name; renames sliders to the exact ARKit names
whatever prefix or casing the tool used (`CTRL_expressions_JawOpen` becomes
`jawOpen`); zeroes every slider and clears the pose; brings a heavy file
under the triangle budget by joining and reducing the meshes that carry
no sliders (hair, clothes, a scanned head) until the file sits near
50,000 triangles, never touching a mesh with sliders, since reducing its
vertices would throw the sliders away; shrinks textures over 2048 px and
packs them in (`--jpeg` for a smaller file); and exports one .glb, +Y up,
with morph targets, skin and materials. A 1.9-million-triangle head from
an image-to-3D tool comes out at 50,000 and 3 MB with the likeness kept
(still a statue: the next section gives a scan its bones and controls). Blender 4.0 or newer,
nothing else to install.

It is proven through real headless Blender: `tools/avatar/make-fake-export.py`
builds a stand-in Unreal export from the test head (lower levels of
detail, a body to the floor, MetaHuman bone names, Unreal slider names, a
4096 px texture, centimetres; with `--heavy`, a 65,000-triangle hair
piece made of loose triangles the way a scan delivers it), and
`apps/web/test/prepare-character.test.ts` runs the pipeline on it and
checks every step's log line and the result's rig checks, including that
the heavy piece lands inside the budget while the face keeps its sliders. The test runs wherever Blender is installed and says so where
it is not; CI has no Blender.

Then, when the Studio says "Ready":

```
node tools/avatar/install-character.ts amara path/to/amara.glb
```

It checks the file again (it refuses one that fails), copies it to
`apps/web/public/tutors/amara.glb`, names it on Amara in
`config/personas.json`, and says what to commit. Deploy web and API, and
every lesson with Amara loads the 3D engine from then on.

## From a scan to a tutor file

A scan is a statue. What an image-to-3D tool or a scanner delivers is one
textured surface: no bones, no face controls, often millions of loose
triangles, and whatever expression the person had when it was made. It
looks finished and cannot move. One command gives it everything the
engine needs:

```
node tools/avatar/rig/rig-scan.ts scan.glb adaugo.glb
```

No artist, no template head, no trained model beyond the small face
finder the app already ships, no GPU, no server. It needs Blender 4.0 or
newer and this repository with its packages installed, and nothing else.
On a 4-core machine with no graphics card, a 55 MB scan of 1.9 million
triangles becomes a 4.4 MB character of 52,650 triangles that passes the
contract with no warnings, in under four minutes.

What it does, in order:

1. Renders the scan from the front and finds the face in the picture,
   with the same on-device face model the lesson uses for the learner's
   camera, run in a headless browser. That gives 478 points on the face
   and a score for every expression the face is already making.
2. Lifts those points onto the surface by casting each one back along
   the camera's line, and sets up the face's own ruler: the origin
   between the eyes, the distance between the eyes as the unit. Every
   later measurement is in that ruler, so a child's head and an adult's
   are treated alike.
3. Joins the loose triangles at their seams and reduces the surface to
   the budget in two passes, spending 45% of the triangles on the face
   and the rest on everything else, so the mouth and eyes keep the
   detail they need to bend.
4. Cuts the lips apart along the line where they meet (a scan's mouth
   is painted shut), and builds a small dark pocket behind them with two
   rows of teeth and a tongue, so an open mouth shows a mouth.
5. Adds the six bones the contract names, resting upright with no turn
   of their own, and weights the skin to them. The painted eyes turn
   with the eye bones.
6. Builds the 52 controls as movements of the scan's own surface,
   worked out from where the landmarks are: the jaw swings on a hinge
   under the ears, a blink brings each lid to the other along the eye's
   own curve, a smile draws the mouth's corner out and up and lifts the
   cheek. Left is the person's left.
7. If the scan was smiling, takes most of that smile out of the resting
   face, by as much as the face model scored it, so the tutor can rest
   neutral and smile when it means to.
8. Checks the result against the contract, with the same checker as the
   Studio page.
9. Judges its own work: renders the face with every control fully on,
   has the face model score each picture, and writes one sheet of all
   of them (`adaugo-controls.png`) for a person to look over. The
   command fails unless the face model itself sees the jaw open, both
   smiles, both blinks and the brows rise.

The likeness is the scan's own: no vertex is replaced by a template, and
the texture is untouched.

What it cannot do, said plainly. The teeth and tongue are plain shapes,
not that person's teeth. A scan has no eyeball behind the lid, so a
blink and a turn of the eye work, and a wide-eyed look can only stretch
the paint. A third of the controls are small on any face (a cheek
puffed, the jaw pushed forward), and the face model hardly ever scores
them even on a living person, so the judge lists them as unseen and the
sheet is there for the eye. Hair, glasses and a beard are part of the
one surface and move as skin. The face must look at the camera in the
scan, mouth closed or nearly so. A character sculpted by an artist with
separate eyes and teeth will always be finer; this is the route when
there is a scan and no artist.

It is proven two ways. `apps/web/test/rig-scan.test.ts` runs the rigger
through real headless Blender on a stand-in head made by
`tools/avatar/rig/make-test-scan.py` (an egg on shoulders with a face's
proportions and its landmarks supplied, so no face model is needed),
and checks the contract, the resting bones, the cut lips, and that each
control moves the right part of the face the right way. It runs wherever
Blender is installed and says so where it is not; CI has no Blender. And
the command's own judge runs on every real scan.

Two changes came out of the first real scan and are in the engine and
the checker for every character. A character in several parts (skin,
teeth, tongue) carries every control on every part, and most move only
the skin: the checker now calls a control dead only if it moves nothing
anywhere. And a head that is a bone has no size of its own to frame the
camera by: the engine now measures the skin that follows it.

## Check a delivery from the command line

```
node tools/avatar/validate-glb.ts path/to/amara.glb
```

The Studio's check, from a terminal (Node 22.18 or newer runs it as it
is). It reads the file directly, with no 3D software, and says in the
artist's own terms what is wrong. It is stricter than a name check: a slider with
the right name that moves no vertices is a failure, because a slider that
does nothing is a mouth that does not move. It checks the container, the
size, the triangle budget, the skeleton and eye nodes and their hierarchy,
every ARKit name, the essential sliders the engine leans on, real
deformation per target, viseme sliders if present, left/right pairs,
embedded textures and their pixel size, materials, and that the export is
at human scale in metres. `--lenient` turns the budgets into warnings for
looking at a work in progress; the rig checks always count.

## What the engine does with it

`apps/web/app/learn/avatar/` is the runtime. Three.js (MIT) loads the
model; everything that decides how the face moves is plain arithmetic in
three tested modules:

- **visemes.ts**: the words themselves become mouth shapes. We know the
  sentence before the voice plays, so the fifteen Oculus visemes are laid
  out across the audio's real length (vowels longer than consonants,
  breaths at punctuation), and the live loudness decides how hard each one
  is hit. A pause in the voice closes the mouth even if the plan says
  vowel. English-first letter rules; other Latin-script languages get
  sensible mouths; a script we cannot read still gets a natural talking
  rhythm rather than silence.
- **blendshapes.ts**: mouth shapes, mood, blink and gaze become slider
  weights. If the model carries viseme sliders they are used; otherwise
  each viseme is blended from ARKit shapes. Sliders are found by meaning,
  so `Jaw_Open`, `blendShape1.jawOpen` and `CC_Base.MouthSmile_R` all
  resolve. Layers add and never overwrite each other.
- **life.ts**: the small signs of life. Blinks on a human clock (two to six
  seconds, one in seven a double), breath at fifteen a minute, a head that
  sways on two unrelated rhythms so it never visibly loops, a nod on a
  stressed word, eyes that look up when thinking and at you when
  listening, with the odd glance aside while speaking.

`Avatar3D.tsx` only feeds those modules time and applies their numbers to
the mesh, the head node and the eye nodes. It exposes a plain readout on
its element (`data-state`) ten times a second, which is what the probe and
anyone with the inspector open reads.

## Where it cannot run

A browser without WebGL, or a model that fails to load or has no face
sliders, says so and the drawn face steps in. A lesson never opens on a
blank square. The probe checks this path on every engine.

## Prove it

```
node tools/device/avatar-probe.mjs
node tools/device/studio-probe.mjs
```

The Studio probe opens `/studio` in a real browser, drops the test head
on it, reads the strict and lenient verdicts and the lines, sees the
character drawn, says the line and watches the jaw move on the words,
walks sliders by name with the head held still, drops a file that is not
a character and one with a slider that moves nothing and reads both
explanations, and proves no request carried the file anywhere. Chromium
and WebKit draw; Firefox headless has no WebGL and the probe checks the
honest message there instead.

Loads the real build with a persona carrying the licence-free test head
(`apps/web/test/fixtures/test-head.glb`, made by
`tools/avatar/make-test-head.mjs`, served only to the probe), starts a
lesson so the tutor speaks, and reads the engine while it does: the jaw
must open on the words, the mouth must move through shapes rather than
hang open, the smile must come with the mood, the eyes must blink, the
head must never freeze, and it must all settle when the voice stops. Then
it takes WebGL away and checks the fallback. Chromium and WebKit render
WebGL in software here; Firefox's headless build does not, and the probe
reports that honestly and checks the fallback there instead.

## What the artist's first model will tell us

The test head is a sphere with real sliders; it proves the pipeline, not
the art. The first real character will show three things the pipeline
cannot: whether the face reads as human at video-call scale on a phone,
whether the artist's slider deformations look right in combination
(smile plus jaw open, blink plus smile), and the frame rate on a cheap
Android. Those are judged by eye, on a real device, and the acceptance
list in the handoff pack is the checklist.

Five things to ask the artist for that the brief did not state, because
each one is a round trip if it is wrong: units in metres with a bust
roughly 0.6 m tall; the face looking down +Z with +Y up; the neutral pose
exported with every slider at zero; eye bones whose local +Y rotation
turns the eye to the character's left; and no more than four bone
influences per vertex.
