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
