#!/usr/bin/env node
/**
 * The voice-familiarity probe: does the tutor really get to know a voice,
 * and is the promise to a family kept?
 *
 * Drives the real build in Chromium with a fake microphone playing
 * speech-like recordings made here (a voiced, intonated syllable stream, so
 * no real person's voice is involved), and checks:
 *
 *   - Off unless allowed: a learner whose account holder has not switched
 *     it on sends nothing about how they sound.
 *   - Measured on the device: once allowed, each spoken turn carries four
 *     numbers (pitch, how much it moved, loudness, seconds of speech), and
 *     they match what was actually played.
 *   - Nothing but numbers: the header is short, and no request goes anywhere
 *     but Dingba.
 *   - Learned over two lessons: the family page says "getting to know" after
 *     the first and "knows" after the second.
 *   - A different day is measurably different: the quiet, slow, flat
 *     recording reads lower, flatter and quieter on the device.
 *   - Open conversation too: a turn spoken in conversation mode carries the
 *     same numbers.
 *   - Off means forgotten: switching off on the family page wipes it.
 *
 * Whether the tutor then says something is decided by the server rules,
 * proven in apps/api/test/voice-familiarity.test.ts, including on the very
 * numbers this probe measures (they are printed at the end).
 *
 *   node tools/device/voice-probe.mjs [--url http://127.0.0.1:3100]
 *     [--api http://127.0.0.1:4100] [--admin-key KEY] [--chromium PATH]
 * The API must run with ADMIN_KEY set to the same key (default probe-admin),
 * so the probe family can have enough voice turns in a day.
 */
import { chromium } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((p) => p.length),
);
const WEB = args.url ?? "http://127.0.0.1:3100";
const API = args.api ?? "http://127.0.0.1:4100";
const ADMIN = args["admin-key"] ?? "probe-admin";
const CHROME = args.chromium ?? process.env.CHROMIUM_PATH ?? undefined;

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${name}${ok || !detail ? "" : `  (${detail})`}`);
};

// ---------------------------------------------------------------- the recordings
/** A speech-like stream: voiced syllables with rising and falling pitch. */
function speech({ f0, amp, on, off, swing, seconds, seed }) {
  const RATE = 48_000;
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const parts = [];
  for (let t = 0; t < seconds; t += on + off) {
    const n = Math.round(on * RATE);
    const from = rand() * swing;
    const to = rand() * swing;
    const syl = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const st = from + ((to - from) * i) / n;
      phase += (2 * Math.PI * f0 * 2 ** (st / 12)) / RATE;
      let v = 0;
      for (let h = 1; h <= 8; h++) v += Math.sin(h * phase) / h;
      syl[i] = (amp * v * Math.sin((Math.PI * i) / n) ** 0.6) / 2.7;
    }
    parts.push(syl, new Float32Array(Math.round(off * RATE)));
  }
  parts.push(new Float32Array(Math.round(1.2 * RATE))); // a pause, so an utterance ends
  const total = parts.reduce((a, p) => a + p.length, 0);
  const buf = Buffer.alloc(44 + total * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + total * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(total * 2, 40);
  let o = 44;
  for (const p of parts) for (const v of p) { buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), o); o += 2; }
  return buf;
}
const dir = mkdtempSync(join(tmpdir(), "voice-probe-"));
const USUAL = join(dir, "usual.wav");
const QUIET = join(dir, "quiet.wav");
// Their ordinary voice: 220 Hz, lively, brisk syllables.
writeFileSync(USUAL, speech({ f0: 220, amp: 0.45, on: 0.22, off: 0.08, swing: 2, seconds: 5, seed: 1 }));
// The same child on a different day: lower, much quieter, slow, flat.
writeFileSync(QUIET, speech({ f0: 196, amp: 0.06, on: 0.4, off: 0.3, swing: 0.4, seconds: 5, seed: 2 }));

// ---------------------------------------------------------------- helpers
async function api(path, { method = "GET", token, body, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function family(allowed) {
  const email = `voice-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const token = (await api("/auth/register", { method: "POST", body: { email, password: "password12", role: "parent" } })).json.token;
  const student = (await api("/students", { method: "POST", token, body: { displayName: "Ada" } })).json;
  const up = await api("/admin/plan", { method: "POST", headers: { "x-admin-key": ADMIN }, body: { email, plan: "premium" } });
  if (up.status !== 200) throw new Error(`could not lift the probe family's plan (${up.status}); run the API with ADMIN_KEY=${ADMIN}`);
  if (allowed) await api(`/students/${student.id}/voice-familiarity`, { method: "PUT", token, body: { enabled: true } });
  return { token, studentId: student.id };
}

const parse = (h) => Object.fromEntries((h ?? "").split(";").filter(Boolean).map((kv) => { const [k, v] = kv.split("="); return [k, Number(v)]; }));
const st = (a, b) => 12 * Math.log2(a / b);

async function open(recording, who) {
  const browser = await chromium.launch({
    ...(CHROME ? { executablePath: CHROME } : {}),
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${recording}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["microphone"] });
  await context.addInitScript((t) => { try { localStorage.setItem("tutor_token", t); } catch {} }, who.token);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  const requests = [];
  page.on("request", (r) => requests.push({ url: r.url(), headers: r.headers() }));
  return { browser, page, errors, requests };
}

async function lesson(page, who) {
  await page.goto(`${WEB}/learn?student=${who.studentId}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: /Amara/ }).click();
  await page.getByRole("button", { name: /Middle School Math/ }).click();
  await page.getByRole("button", { name: /^Start session$/ }).click();
  await page.locator(".msg.tutor").first().waitFor({ timeout: 20_000 });
}

/** Hold the talk button for a while, like a child would, and wait for the reply. */
async function talk(page, requests, holdMs) {
  const button = page.locator('[title="Hold to talk"]');
  await button.waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => !document.querySelector('[title="Hold to talk"]')?.disabled, null, { timeout: 30_000 });
  const before = requests.length;
  const box = await button.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
  for (let i = 0; i < 60; i++) {
    const sent = requests.slice(before).find((r) => r.url.endsWith("/voice"));
    if (sent) {
      await page.waitForFunction(() => !document.querySelector('[title="Hold to talk"]')?.disabled, null, { timeout: 30_000 }).catch(() => {});
      return sent;
    }
    await page.waitForTimeout(250);
  }
  return null;
}

const status = async (who) => (await api(`/students/${who.studentId}/voice-familiarity`, { token: who.token })).json?.status;

// ---------------------------------------------------------------- off unless allowed
console.log("\n- off unless allowed");
{
  const who = await family(false);
  const { browser, page, requests, errors } = await open(USUAL, who);
  await lesson(page, who);
  const sent = await talk(page, requests, 2500);
  check("a spoken turn still goes to the tutor", Boolean(sent));
  check("but carries nothing about how they sound", sent && !("x-voice-features" in sent.headers), sent?.headers["x-voice-features"]);
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
}

// ---------------------------------------------------------------- two lessons
const who = await family(true);
const usual = [];
console.log("\n- allowed: two ordinary lessons");
{
  const { browser, page, requests, errors } = await open(USUAL, who);
  for (let l = 1; l <= 2; l++) {
    await lesson(page, who);
    for (let t = 0; t < 3; t++) {
      const sent = await talk(page, requests, 3000);
      const h = sent?.headers["x-voice-features"];
      if (h) usual.push(h);
      if (l === 1 && t === 0) {
        check("each spoken turn carries how they sounded", Boolean(h), JSON.stringify(sent?.headers ?? {}).slice(0, 160));
        check("and it is a few short numbers, nothing more", Boolean(h) && h.length < 80 && /^(pitch=[\d.]+;range=[\d.]+;)?level=[\d.]+;voiced=[\d.]+$/.test(h), h);
      }
    }
    const s = await status(who);
    if (l === 1) check("after one lesson the family page says it is getting to know them", s?.stage === "listening" && s?.sessionsHeard === 1, JSON.stringify(s));
    else check("after two lessons it knows how they usually sound", s?.stage === "knows", JSON.stringify(s));
  }
  const m = usual.map(parse);
  const pitch = m.map((x) => x.pitch).filter(Boolean);
  check("all six turns were measured", m.length === 6, `${m.length}`);
  check("the pitch read is the pitch played (220 Hz, within a semitone)", pitch.length === 6 && pitch.every((p) => Math.abs(st(p, 220)) < 1), pitch.join(", "));
  check("the speech time is what was held, less the pauses", m.every((x) => x.voiced > 1 && x.voiced <= 3.2), m.map((x) => x.voiced).join(", "));
  const origins = new Set(requests.map((r) => new URL(r.url).origin));
  check("no request went to anyone but Dingba", [...origins].every((o) => o === WEB || o === API), [...origins].join(", "));
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
}

// ---------------------------------------------------------------- a different day
let quiet = null;
console.log("\n- a day they sound unlike themselves");
{
  const { browser, page, requests, errors } = await open(QUIET, who);
  await lesson(page, who);
  const sent = await talk(page, requests, 5000);
  quiet = sent?.headers["x-voice-features"] ?? null;
  const q = parse(quiet);
  const u = usual.map(parse);
  const avg = (k) => u.reduce((a, x) => a + x[k], 0) / u.length;
  check("the turn was measured", Boolean(quiet), quiet);
  check("their voice reads lower (196 Hz played)", q.pitch && Math.abs(st(q.pitch, 196)) < 1 && q.pitch < avg("pitch"), `${q.pitch} vs ${avg("pitch").toFixed(1)}`);
  check("and flatter", q.range !== undefined && q.range < avg("range") / 2, `${q.range} vs ${avg("range").toFixed(2)}`);
  // Played at an eighth of the volume. Browsers level a microphone's volume
  // on their own, so this is reported rather than required; the tutor
  // leans on pitch, its movement and pace for exactly this reason.
  console.log(`    note: loudness read ${q.level} against ${avg("level").toFixed(3)} usually; the browser's volume levelling ${q.level < avg("level") / 2 ? "let the difference through" : "evened it out"}`);
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

  // Open conversation: the same numbers travel with an utterance.
  const before = requests.length;
  await page.getByTitle(/Open conversation/).click();
  let convo = null;
  for (let i = 0; i < 80 && !convo; i++) {
    convo = requests.slice(before).find((r) => r.url.endsWith("/voice")) ?? null;
    if (!convo) await page.waitForTimeout(250);
  }
  check("a turn in open conversation carries them too", Boolean(convo?.headers["x-voice-features"]), JSON.stringify(convo?.headers ?? {}).slice(0, 120));
  await page.getByTitle(/End the open conversation/).click().catch(() => {});
  await browser.close();
}

// ---------------------------------------------------------------- switching off forgets
console.log("\n- the family page, and switching off");
{
  const { browser, page, errors } = await open(USUAL, who);
  await page.goto(`${WEB}/account`, { waitUntil: "domcontentloaded" });
  // The whole block: the heading's row, and the words under it.
  const block = page.locator("b", { hasText: "Knowing their voice" }).locator("xpath=../..");
  await block.waitFor({ timeout: 15_000 });
  check("the family page says the tutor knows how they sound", (await block.innerText()).includes("knows how Ada usually sounds"), (await block.innerText()).slice(0, 120));
  await block.getByRole("button", { name: "Switch off and forget" }).click();
  await page.waitForTimeout(800);
  const text = await block.innerText();
  check("switched off, it says so in plain words", text.startsWith("Knowing their voice") && text.includes("Off."), text.slice(0, 120));
  const after = await api(`/students/${who.studentId}/voice-familiarity`, { token: who.token });
  check("and everything learned is gone", after.json?.voiceFamiliarity === false && after.json?.status?.sessionsHeard === 0 && after.json?.status?.stage === "listening", JSON.stringify(after.json));
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
}

console.log("\nmeasured in the browser (for apps/api/test/voice-familiarity.test.ts):");
console.log(`  usual: ${usual.join(" | ")}`);
console.log(`  quiet: ${quiet}`);
console.log(failures ? `\n${failures} check(s) FAILED` : "\nthe tutor gets to know a voice, and keeps every promise made to the family");
process.exit(failures ? 1 : 0);
