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
(cd .next/standalone/apps/web && PORT=3100 node server.js)
node tools/device/browser-sweep.mjs            # from the repo root
```

It walks 69 checks per engine and takes a few minutes each, so the whole
sweep is roughly a coffee break. Narrow it while working with
`--engines webkit` (or chromium, or firefox).

Two companions cover the parts that need their own kind of proof:
`tools/device/audio-probe.mjs` for sound, where iPhones are strictest (see
docs/STORES.md), and `tools/device/board-probe.mjs` for the whiteboard,
which is the one surface that depends on pointer input, canvas and image
export all working together. Both run on the same stack as the sweep.

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

## Deliberately not required

No Flash, no Java, no plugins, no extensions, no desktop-only APIs, no
WebGL, no camera (the photo question is a file the learner chooses, which
every phone can do), and no geographic or network restriction of any kind.

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
