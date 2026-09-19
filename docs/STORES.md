# Dingba in the app stores

Dingba is a browser app AND a store app from one codebase. The native
shell (`apps/mobile`, built with Capacitor, MIT-licensed) loads the live
website inside a real app, so:

- **one codebase**: nothing is written twice; the web app is the app;
- **instant updates**: a website deploy updates every installed app the
  next time it opens, with no store review wait;
- **native permissions**: microphone (hold-to-talk, conversation mode),
  camera (homework photos), home-screen presence, an offline shell.

The permanent identity in both stores is the app id **`ai.dingba.app`**.
Never change it after the first release.

**Who holds what:** the founder owns the Google Play and Apple developer
accounts and every signing key. No AI, this build chat included, ever holds
them (docs/RUNBOOK.md). The repo carries the code; the keys stay with you.

---

## Before either store: the three prerequisites

1. **The live site must be real.** `https://api.dingba.ai/health` shows the
   real providers (not `mock`), because the store app IS the website.
2. **Children's-app compliance.** Both stores treat an education app used
   by under-13s as a children's app. Required on both: a privacy policy URL
   (`https://dingba.ai/privacy`), no third-party ads (we have none), a
   completed data-safety form (Play) / privacy nutrition label (Apple), and
   a parental gate before anything that leaves the child's world (account
   settings, payments, external links). Have the lawyer review pass
   (FOUNDER-CHECKLIST) done first; the store forms ask the same questions.
3. **Store assets** (your artist, or the vector cast in
   docs/character-sheet.html): 512px and 1024px icons, a splash screen,
   screenshots for phone and tablet, a Play feature graphic, and short and
   long descriptions.

---

## Google Play (Android)

Two routes. Both use the same app id; pick one.

### Route A: the Capacitor shell (recommended, matches iOS)

On any computer with Android Studio installed:

```sh
pnpm install
cd apps/mobile
pnpm cap:sync            # copies config into the generated android/ project
pnpm cap:open:android    # opens Android Studio
```

In Android Studio: Build > Generate Signed Bundle. Create your **upload
key** the first time (Android Studio guides you; keep the .jks file and its
password somewhere safe and private, never in the repo). Build an `.aab`.

Then in Play Console: create the app (`ai.dingba.app`), set the category to
Education, complete the Content rating and Data safety questionnaires, add
the Families policy declarations, upload the `.aab` to Internal testing
first, then Production.

### Route B: Trusted Web Activity (no native code at all)

Google's own path for installable web apps. Use PWABuilder
(`https://www.pwabuilder.com`) or Bubblewrap with the manifest at
`https://dingba.ai/manifest.json`. It produces a signed `.aab` the same way.

### The one file that ties the app to the site (both routes)

Play needs proof that dingba.ai belongs to the app, or the app opens with a
browser bar. The proof lives at
`https://dingba.ai/.well-known/assetlinks.json` (already served from
`apps/web/public/.well-known/`). Replace the placeholder with your key's
fingerprint:

- Play Console > your app > Setup > App signing > **App signing key
  certificate** > copy the **SHA-256 certificate fingerprint**.
- Paste it into `sha256_cert_fingerprints` in that file, deploy the web
  app. If you also use your own upload key to test locally, add its
  fingerprint as a second entry.

Done when `https://dingba.ai/.well-known/assetlinks.json` shows the real
fingerprint and the installed app opens full-screen with no browser bar.

---

## Apple App Store (iPhone and iPad)

Apple only builds iOS apps from Xcode on a Mac, but the project is already
in the repo (`apps/mobile/ios`), with the permission sentences and the
store identity (`ai.dingba.app`) already in it and pinned by tests. On a
Mac with Xcode and CocoaPods installed:

```sh
pnpm install             # the Podfile points into this install
cd apps/mobile
pnpm cap:sync            # regenerates the per-platform config and pods
pnpm cap:open:ios        # opens Xcode
```

`pnpm cap:add:ios` is only for starting the project over; it already
exists. The three sentences Apple shows a parent before granting a
permission are in `ios/App/App/Info.plist`:

- **Microphone** — "Dingba uses the microphone only while you hold the
  talk button or open a hands-free conversation, so your tutor can hear
  your question."
- **Camera** — "Dingba uses the camera only when you choose to show your
  tutor a photo of your work or your timetable."
- **Photos** — "Dingba opens your photos only when you pick one to show
  your tutor."

`ITSAppUsesNonExemptEncryption` is declared false there too, so uploads
are not held up on the encryption question every time.

Then Signing & Capabilities: choose your Apple Developer team (the account
you own). Product > Archive > Distribute App > App Store Connect.

In App Store Connect: create the app (`ai.dingba.app`), category Education,
age rating 4+, fill the privacy nutrition label from the same answers as
Play's data-safety form, add screenshots, submit for review. Use
TestFlight first for your two-phone pass.

### Why Apple accepts it (guideline 4.2, "minimum functionality")

Apple rejects apps that are "just a website in a box". Dingba passes
because the shell genuinely uses the device: microphone for voice
conversation, camera for homework, an offline shell with its own icon and
splash, and a home-screen identity; and because the experience is an
interactive tutor, not a brochure. If a reviewer pushes back, the reply is
exactly that list.

---

## After launch

- **Updating the app:** deploy the website. Installed apps pick it up on
  next open. Only a change to the shell itself (permissions, icon, app id
  dependencies) needs a new store build.
- **Both stores at once:** same id, same site, same assets; ship Android
  first if you only have one computer, iOS when you have a Mac day.
- **Never** commit `.jks`, `.keystore`, `.p12` or provisioning profiles;
  the repo's ignore rules block them, keep it that way.

---

## The phone-audio check, before any build ships

iPhones are strict about sound: Safari keeps the audio engine asleep until
the child taps something, and anything routed through a sleeping engine is
heard by nobody. That once made the tutor completely silent on iPhone while
looking perfect on a laptop, so there is a probe for it:

```
pnpm --filter @tutor/api dev                       # the API, on 4100
cd apps/web && NEXT_PUBLIC_API_URL=http://127.0.0.1:4100 pnpm build
# the web app builds standalone, so the browser files are copied in and it
# is served by its own server, not `next start`:
cp -r .next/static .next/standalone/apps/web/.next/static
(cd .next/standalone/apps/web && PORT=3100 node server.js)
node tools/device/audio-probe.mjs                  # from the repo root
```

It opens the real build at phone size, taps through as a child would, and
checks that the tutor is heard on an iPhone whose engine never wakes, that
lip-sync still runs when it does wake, that the hands-free button shows on
browsers with only the old `webkitAudioContext` name, and that nothing
scrolls sideways. Run it before cutting a store build, and still do one
pass on a real iPhone and a real Android: a simulated engine is a good
alarm, not a substitute for the device.
