#!/usr/bin/env node
/**
 * The face-hints probe: is the promise to a family kept?
 *
 * Drives the real build with a fake camera that shows a real face, and
 * checks the things a parent would ask:
 *
 *   - Off unless allowed: a guest, and a learner whose account holder has
 *     not switched it on, are never offered the camera.
 *   - Asked, not assumed: allowed learners see a plain explanation first,
 *     and "Not now" leaves the camera off.
 *   - Seen, and shown: once on, the learner sees the mirror of what the
 *     camera sees, and the face reader, running in the page, reads the face.
 *   - Nothing leaves but a word: the model loads from our own site, no
 *     request goes to anyone else, no request carries a picture, and the
 *     message to the tutor carries one plain word.
 *   - Off means off: turning it off stops the camera itself.
 *
 * Chromium only, because only its fake camera can play a chosen video.
 *   node tools/device/face-probe.mjs --face face.y4m --empty empty.y4m
 *     [--url http://127.0.0.1:3100] [--api http://127.0.0.1:4100]
 *     [--chromium /path/to/chromium]
 * The face and empty-room videos are 320x240 YUV4MPEG2 files; any smiling
 * face works.
 */
import { chromium } from "@playwright/test";

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((p) => p.length),
);
const WEB = args.url ?? "http://127.0.0.1:3100";
const API = args.api ?? "http://127.0.0.1:4100";
const CHROME = args.chromium ?? process.env.CHROMIUM_PATH ?? undefined;
if (!args.face || !args.empty) {
  console.error("usage: node tools/device/face-probe.mjs --face face.y4m --empty empty.y4m");
  process.exit(2);
}

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${name}${ok || !detail ? "" : `  (${detail})`}`);
};

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** A family with one learner, optionally allowed face hints. */
async function family(allowed) {
  const email = `probe-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const token = (await api("/auth/register", { method: "POST", body: { email, password: "password12", role: "parent" } })).json.token;
  const student = (await api("/students", { method: "POST", token, body: { displayName: "Ada" } })).json;
  if (allowed) await api(`/students/${student.id}/face-hints`, { method: "PUT", token, body: { enabled: true } });
  return { token, studentId: student.id };
}

async function open(video, who) {
  const browser = await chromium.launch({
    ...(CHROME ? { executablePath: CHROME } : {}),
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-video-capture=${video}`,
    ],
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["camera"] });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  // Every request the page makes, to prove what does and does not leave.
  const requests = [];
  page.on("request", (r) => requests.push({ url: r.url(), method: r.method(), type: r.headers()["content-type"] ?? "", body: r.postData() ?? "" }));

  if (who) {
    await page.addInitScript((t) => { try { localStorage.setItem("tutor_token", t); } catch {} }, who.token);
    await page.goto(`${WEB}/learn?student=${who.studentId}`, { waitUntil: "domcontentloaded" });
  } else {
    await page.goto(`${WEB}/learn`, { waitUntil: "domcontentloaded" });
  }
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: /Amara/ }).click();
  await page.getByRole("button", { name: /Middle School Math/ }).click();
  await page.getByRole("button", { name: /^Start session$/ }).click();
  await page.locator(".msg.tutor").first().waitFor({ timeout: 20_000 });
  return { browser, page, errors, requests };
}

const offerButton = (page) => page.getByRole("button", { name: /see me/ });

// ---------------------------------------------------------------- off unless allowed
console.log("\n- off unless allowed");
{
  const guest = await open(args.face, null);
  check("a guest is never offered the camera", (await offerButton(guest.page).count()) === 0);
  await guest.browser.close();

  const notAllowed = await open(args.face, await family(false));
  check("a learner whose parent has not allowed it is never offered the camera", (await offerButton(notAllowed.page).count()) === 0);
  await notAllowed.browser.close();
}

// ---------------------------------------------------------------- the real thing
console.log("\n- allowed, with a smiling face in front of the camera");
{
  const { browser, page, errors, requests } = await open(args.face, await family(true));
  check("the allowed learner is offered it, and it starts off", (await offerButton(page).count()) === 1 && (await page.locator(".face-mirror").isHidden()));

  await offerButton(page).click();
  const sheet = page.getByRole("dialog");
  check("a plain explanation comes first", (await sheet.innerText()).includes("No picture or video is recorded, saved or sent"));
  await page.getByRole("button", { name: "Not now" }).click();
  check("'Not now' leaves the camera off", (await page.locator(".face-mirror").isHidden()) && (await page.evaluate(() => {
    const v = document.querySelector(".face-mirror");
    return !(v && v.srcObject);
  })));

  await offerButton(page).click();
  await page.getByRole("button", { name: "Turn on camera" }).click();
  await page.locator(".face-sense[data-face^='on']").waitFor({ timeout: 60_000 }).catch(() => {});
  check("once on, the learner sees the mirror of what the camera sees", await page.locator(".face-mirror").isVisible());

  // Let the reader watch the face long enough for a smile to count.
  let state = "";
  for (let i = 0; i < 40; i++) {
    state = (await page.locator(".face-sense").getAttribute("data-face")) ?? "";
    if (state.includes("steady=smiling")) break;
    await page.waitForTimeout(500);
  }
  check("the face reader, running in the page, reads a steady smile", state.includes("steady=smiling"), state);

  // Send a message: it must carry one plain word, and nothing else about the face.
  const before = requests.length;
  await page.locator(".composer input.inp").fill("I think it is 42");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);
  const sent = requests.slice(before).filter((r) => r.url.includes("/message"));
  const body = sent[0]?.body ?? "";
  check("the message carries the plain word 'smiling'", body.includes('"faceHint":"smiling"'), body.slice(0, 120));
  check("and nothing else about the face", body.length < 300 && !/data:image|base64|landmark|blendshape/i.test(body), `${body.length} bytes`);

  const origins = new Set(requests.map((r) => new URL(r.url).origin));
  check("the face model and engine came from our own site", requests.some((r) => r.url === `${WEB}/face/face_landmarker.task`) && requests.some((r) => r.url.startsWith(`${WEB}/face/wasm/`)));
  check("no request went to anyone but Dingba", [...origins].every((o) => o === WEB || o === API), [...origins].join(", "));
  check("no request carried a picture or a video", requests.every((r) => !/^(image|video)\//.test(r.type) && !/data:image|data:video/.test(r.body)));

  // Off means off: the camera itself stops.
  await page.getByRole("button", { name: "Turn off" }).click();
  await page.waitForTimeout(300);
  const off = await page.evaluate(() => {
    const v = document.querySelector(".face-mirror");
    return { hidden: getComputedStyle(v).display === "none", stream: Boolean(v.srcObject), state: document.querySelector(".face-sense").dataset.face };
  });
  check("turning it off stops the camera and hides the mirror", off.hidden && !off.stream && off.state === "off", JSON.stringify(off));

  // With the camera off, the next message carries no word at all.
  const before2 = requests.length;
  await page.locator(".composer input.inp").fill("next please");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2000);
  const body2 = requests.slice(before2).find((r) => r.url.includes("/message"))?.body ?? "";
  check("with the camera off, messages carry no face word", body2.length > 0 && !body2.includes("faceHint"), body2.slice(0, 80));

  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
}

// ---------------------------------------------------------------- nobody there
console.log("\n- allowed, with nobody in front of the camera");
{
  const { browser, page, errors } = await open(args.empty, await family(true));
  await offerButton(page).click();
  const agreedBefore = await page.getByRole("dialog").count();
  if (agreedBefore) await page.getByRole("button", { name: "Turn on camera" }).click();
  let state = "";
  for (let i = 0; i < 60; i++) {
    state = (await page.locator(".face-sense").getAttribute("data-face")) ?? "";
    if (state.includes("steady=away")) break;
    await page.waitForTimeout(500);
  }
  check("an empty chair reads as 'away', and only after it has lasted", state.includes("steady=away"), state);
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nface hints keep every promise made to the family");
process.exit(failures ? 1 : 0);
