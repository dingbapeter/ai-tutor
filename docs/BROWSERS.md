# Where Dingba runs

The promise: any child, any phone, any computer, anywhere in the world. No
country is blocked, no browser is turned away, and nothing about the
platform assumes one shop's hardware.

This file records what that means in practice, what is checked, and the few
places where a browser (not Dingba) sets a limit.

## The three engines, and who they carry

Every browser in the world is built on one of three engines, so testing
three engines tests them all.

| Engine | What it carries |
| --- | --- |
| **WebKit** | Safari on iPhone, iPad and Mac. Apple requires *every* iOS browser to use it, so Chrome, Edge, Firefox and Opera on an iPhone are all WebKit underneath. |
| **Chromium** | Chrome and Edge (Windows, Mac, Android), Samsung Internet, Opera, Brave, and Android's built-in WebView (which is what our Android app uses). |
| **Gecko** | Firefox on Windows, Mac and Android. |

`tools/device/browser-sweep.mjs` drives all three, at four sizes (Windows
laptop, Mac desktop, Android phone, iPhone), through the journeys a family
actually walks: the homepage, choosing a tutor and subject, being greeted,
asking a question and getting the answer streamed back, the family page,
terms, privacy, and the Command Centre door. It fails on a page error, a
broken journey, or a layout that spills sideways.

```
PORT=4100 GUEST_IP_CAP=500 pnpm --filter @tutor/api dev
cd apps/web && NEXT_PUBLIC_API_URL=http://127.0.0.1:4100 pnpm build
cp -r .next/static .next/standalone/apps/web/.next/static
cp -r public .next/standalone/apps/web/public
(cd .next/standalone/apps/web && PORT=3100 node server.js)
node tools/device/browser-sweep.mjs            # from the repo root
```

Both copies matter. The standalone build leaves out the browser files and
the public folder; without the second line the site still loads, but has no
manifest, no service worker (so no offline shell and no reminders), no
icons and no face model. The live site ran like that for months, so the
sweep now checks those pieces are served and the service worker takes
charge, and a test pins the Dockerfile lines that copy them.

It walks 77 checks per engine and takes a few minutes each, so the whole
sweep is roughly a coffee break. Narrow it while working with
`--engines webkit` (or chromium, or firefox).

Two companions cover the parts that need their own kind of proof:
`tools/device/audio-probe.mjs` for sound, where iPhones are strictest (see
docs/STORES.md), and `tools/device/board-probe.mjs` for the whiteboard,
which is the one surface that depends on pointer input, canvas and image
export all working together. `tools/device/avatar-probe.mjs` proves the 3D
tutor's lip sync and its fallback, `tools/device/face-probe.mjs` proves
the face hints below, and `tools/device/voice-probe.mjs` proves voice
familiarity, and `tools/device/data-probe.mjs` has a parent download all
their data and then delete the account on every engine. All run on the
same stack as the sweep.

## What every browser must give us, and does

- **Reading and typing** — plain HTML and CSS. Works everywhere, back to
  browsers far older than we support.
- **Streamed answers** — the tutor's reply arrives word by word over a
  live connection. Checked on all three engines.
- **Remembering the session** — local storage. Checked on all three.
- **The tutor's voice** — Web Audio, under either the modern or the old
  `webkit` name.

## Where a browser, not Dingba, sets the limit

- **Recording the learner's voice** needs `MediaRecorder`. Chrome, Edge,
  Firefox, Samsung Internet and Safari 14.1+ all have it. A few in-app
  browsers (a link opened inside another app) and very old iPhones do not.
  Where it is missing the talk button is not offered at all: typing still
  works and the tutor still speaks back. We never ask a child for their
  microphone and then fail.
- **The offline shell** needs a service worker. Missing in some private
  browsing modes; the app then simply requires a connection.
- **Installing to the home screen** is offered by Chrome, Edge and Samsung
  Internet directly; on iPhone it is Share then "Add to Home Screen";
  Firefox on desktop does not install web apps at all. The website works
  identically either way, and the store apps (docs/STORES.md) cover people
  who would rather install from a shop.

## Reading right to left

Six of the 91 teaching languages are written right to left: Arabic, Farsi,
Hebrew, Kurdish, Urdu and Pashto. A lesson in one of them sets the chat and
the typing box to `rtl`, so sentences start where a child's eye starts and
full stops land on the correct side. Formulas stay left to right inside
those sentences (`3 + 4 = 7` reads the same in any language), which the
stylesheet isolates deliberately. The sweep checks an Arabic lesson on
every engine.

## Writing by hand

The whiteboard takes a finger, a stylus or a mouse through one set of
pointer handlers, so every engine speaks the same language. The canvas sets
`touch-action: none`, without which a drawing gesture scrolls the page away
on a phone and the child draws nothing; the board probe checks exactly that,
along with ink appearing, undo, the eraser, and the tutor answering the
finished work.

## A dead connection

The banner has always told a child their messages "will send when the
connection returns". Now that is true. A send that fails for network reasons
waits in the browser's own store, keeps its place in the queue, and goes out
when the connection comes back; a refusal the server actually made is never
retried, because that would spend a family's daily allowance behind their
back. `tools/device/outbox-probe.mjs` takes a real browser offline in the
middle of a lesson on every engine and checks the whole round trip.

## Seeing the learner's face

A learner can let their tutor see their face, so the tutor can respond the
way someone sitting beside them would. It is off unless the account holder
switches it on from the family page, and it is never offered to guests, to
learners on a school roster, to sessions opened through an API key, or in a
shared class. Even then the learner is asked first, in plain words, and sees
a small mirror of exactly what the camera sees, with a one-tap off.

The face model (MediaPipe Face Landmarker, Apache-2.0) runs inside the page.
Its engine and model are served from our own site, the model is checked
against a pinned fingerprint at build time, and no picture or video leaves
the device. What reaches the tutor is at most one plain word now and then:
smiling, frowning, furrowed, drowsy or away, and only once a look has lasted
(four seconds for a smile, twenty for looking away). It reaches the tutor as
a private note for that one turn and is never saved in the transcript.

These words describe what is visible, not what anyone feels, and the tutor
is told to ask rather than tell a learner how they feel. That line is
deliberate: the EU AI Act (Article 5(1)(f)) bans inferring the emotions of
people in education, while detecting readily apparent expressions such as a
smile or a frown is outside the ban when it is not used to infer emotions.
It is also why school rosters are excluded outright. A lawyer should confirm
this reading before launch in the EU.

`tools/device/face-probe.mjs` drives the real build in Chromium with a fake
camera and checks every one of these promises, including that no request
goes anywhere but Dingba and none carries a picture. The first time, the
learner's browser downloads about 15 MB.

## Knowing a learner's voice

When the account holder allows it, the tutor gets to know how a learner
usually sounds over their first two spoken lessons, and can then notice a
day they sound unlike themselves. Same exclusions as face hints: never for
guests, school rosters, API-key sessions, or while friends sit in a class.

While they talk, the page measures, ten times a second, how loud the voice
is and its pitch, and keeps nothing else. Each spoken turn then carries
four numbers (typical pitch, how much it moved, loudness, seconds of
speech); the server adds pace from the transcript and keeps running
averages per learner. No recording and no voiceprint: nothing that could
tell one voice from another, and it is never used to decide who is
speaking. Learning is even over the first two lessons, then slow, so a
gradual change such as a voice breaking becomes the new normal, while a
sudden difference is noticed. The tutor is told only what is audible
("flatter and slower than usual"), once a lesson, and asked to check in
gently without guessing feelings. Once the tutor knows a learner, this
replaces the one-size "quiet voice" nudge, so a naturally soft-spoken child
is not flagged every lesson.

Browsers level a microphone's volume on their own (automatic gain
control). The probe played a recording at an eighth of the volume and the
browser read it as loud as the normal one. So loudness rarely tells
anything, and pitch, pitch movement and pace carry the comparison. The same
levelling means the older one-size "quiet voice" nudge, which listens only
to loudness, fires less often in real browsers than its rule suggests.

`tools/device/voice-probe.mjs` drives the real build in Chromium with a
fake microphone playing speech-like recordings made in the probe itself,
and the numbers it measures are replayed through the real voice route in
apps/api/test/voice-familiarity.test.ts, where the tutor notices the
flatter, slower day and stays silent on an ordinary one. The legal line is
the same as for face hints, and the same lawyer check applies.

## Deliberately not required

No Flash, no Java, no plugins, no extensions, no desktop-only APIs, and no
geographic or network restriction of any kind. WebGL and the camera are
used when they are there and never required: without WebGL the 3D tutor
becomes the drawn face, the camera is only for face hints, and the photo
question is a file the learner chooses, which every phone can do.

## Screen sizes

The layout is fluid from a 320px phone up to a desktop monitor, and the
sweep fails if anything spills sideways at 390, 412, 1366 or 1440 wide.
Phone notches and home bars are handled with safe-area insets, so nothing
important hides under them.

## When to re-run the sweep

Before any release the family will see, and always after touching the
lesson screen, the audio path, or the layout. Real devices remain the last
word: the founder's two-phone pass (one iPhone, one Android) confirms what
no simulated engine can.
