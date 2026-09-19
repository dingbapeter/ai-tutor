import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The store shell's contract. If any of this drifts, an installed app
 * either loses a permission the tutor needs or changes identity in the
 * stores, so it is pinned here and runs in CI with everything else.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = readFileSync(join(root, "capacitor.config.ts"), "utf8");
const manifest = readFileSync(join(root, "android/app/src/main/AndroidManifest.xml"), "utf8");

test("the shell keeps its permanent store identity and loads the live site securely", () => {
  assert.match(config, /appId: "ai\.dingba\.app"/);
  assert.match(config, /appName: "Dingba"/);
  assert.match(config, /url: "https:\/\/dingba\.ai"/);
  assert.match(config, /cleartext: false/);
  assert.match(config, /allowMixedContent: false/);
});

test("Android declares what the tutor needs: internet, microphone, camera", () => {
  for (const p of ["INTERNET", "RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS", "CAMERA"]) {
    assert.match(manifest, new RegExp(`android\\.permission\\.${p}`), `missing ${p}`);
  }
  // Hardware is optional so tablets and phones without a camera can still install.
  assert.match(manifest, /android\.hardware\.microphone" android:required="false"/);
  assert.match(manifest, /android\.hardware\.camera" android:required="false"/);
});

test("the offline shell page exists and names the product", () => {
  const shell = readFileSync(join(root, "shell/index.html"), "utf8");
  assert.match(shell, /<title>Dingba<\/title>/);
  assert.match(shell, /viewport-fit=cover/);
});

test("iOS explains every permission it asks a family for, in plain words", () => {
  const plist = readFileSync(join(root, "ios/App/App/Info.plist"), "utf8");
  // An iOS app that asks for the microphone without a reason string is
  // killed by the system on the spot, and rejected by App Review before
  // that. Each line is what the child's parent actually reads.
  for (const key of ["NSMicrophoneUsageDescription", "NSCameraUsageDescription", "NSPhotoLibraryUsageDescription"]) {
    assert.match(plist, new RegExp(`<key>${key}</key>\\s*<string>[^<]{40,}</string>`), `missing or empty ${key}`);
  }
  assert.match(plist, /<key>CFBundleDisplayName<\/key>\s*<string>Dingba<\/string>/);
  // Declared once here so every upload is not held for an encryption question.
  assert.match(plist, /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
});

test("the iOS project exists and carries the same store identity as Android", () => {
  // The per-platform capacitor.config.json is generated on sync and stays
  // out of the repo, so identity is pinned where Xcode actually reads it.
  const project = readFileSync(join(root, "ios/App/App.xcodeproj/project.pbxproj"), "utf8");
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = ai\.dingba\.app;/);
  // Apple only builds from a Mac, so what the repo owes a Mac day is a
  // project that opens: the app entry point and the CocoaPods file.
  assert.ok(readFileSync(join(root, "ios/App/App/AppDelegate.swift"), "utf8").includes("Capacitor"));
  const podfile = readFileSync(join(root, "ios/App/Podfile"), "utf8");
  assert.match(podfile, /pod 'Capacitor'/);
  assert.match(podfile, /platform :ios, '1[4-9]\.\d+'/);
});
