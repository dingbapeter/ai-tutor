#!/usr/bin/env node
/**
 * The pilot probe: can a school measure what its learners gained, start to
 * finish, in a real browser?
 *
 * Runs against a local site and API (memory store is fine), ideally with
 * the maths checker up so answers are marked by the real thing:
 *
 *   uvicorn main:app --port 8090            # in services/mathcheck
 *   PORT=4100 GUEST_IP_CAP=500 COMMAND_OWNER_EMAILS=founder@probe.example pnpm --filter @tutor/api dev
 *   ... build and serve the web on 3100 (see docs/BROWSERS.md)
 *
 * On every engine:
 *   - a teacher opens the pilot page from the school portal, picks topics,
 *     includes a comparison group and starts a pilot; every learner gets a
 *     link, half in each group;
 *   - a child opens their link with no sign-in, on a phone-sized screen:
 *     the welcome, one question at a time, nothing marked in front of
 *     them; a reload half way loses nothing; they hand in and are thanked;
 *   - the same page reads in Yorùbá for a reviewer;
 *   - a tutored learner's practice list holds none of the test questions;
 *   - the teacher opens the final test, the class sits it, and the report
 *     gives the before, the after, the change with its interval and the
 *     difference from the comparison group, in plain words;
 *   - printing the page prints the report and not the controls;
 *   - the founder reads the same headline in the Command Centre, with no
 *     learner named.
 *
 *   node tools/device/pilot-probe.mjs [--url http://127.0.0.1:3100]
 *     [--api http://127.0.0.1:4100] [--engines webkit,chromium,firefox] [--chromium PATH]
 *     [--owner founder@probe.example] [--shots DIR]
 */
import { readFileSync } from "node:fs";
import { chromium, firefox, webkit } from "@playwright/test";

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((p) => p.length),
);
const WEB = args.url ?? "http://127.0.0.1:3100";
const API = args.api ?? "http://127.0.0.1:4100";
const CHROME = args.chromium ?? process.env.CHROMIUM_PATH ?? undefined;
const OWNER = args.owner ?? "founder@probe.example";
const SHOTS = args.shots ?? null;
const ENGINES = { webkit, chromium, firefox };
const WANTED = (args.engines ?? "webkit,chromium,firefox").split(",").map((s) => s.trim());

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${name}${ok || !detail ? "" : `  (${detail})`}`);
};
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// The right answer to each question, from the bank, so the probe can decide who scores what.
const pack = JSON.parse(readFileSync(new URL("../../curriculum/math-ms/pack.json", import.meta.url), "utf8"));
const answerTo = new Map(pack.problems.filter((p) => p.answer !== undefined).map((p) => [p.prompt, String(p.answer)]));

const post = (path, body, token) =>
  fetch(`${API}${path}`, { method: "POST", headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
const get = (path, token) => fetch(`${API}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }).then((r) => r.json());

/** Sits the open test by API, getting the first `right` questions right. */
async function sit(code, right) {
  const open = await (await post(`/pilot-tests/${code}/open`)).json();
  for (const [k, q] of open.questions.entries()) {
    await post(`/pilot-tests/${code}/answer`, { questionId: q.id, answer: k < right ? answerTo.get(q.prompt) : "999999" });
  }
  await post(`/pilot-tests/${code}/finish`);
}

for (const name of WANTED) {
  const browser = await ENGINES[name].launch(name === "chromium" && CHROME ? { executablePath: CHROME } : {});
  console.log(`\n=== ${name} ${browser.version()} ===`);
  const stamp = `${name}-${Date.now()}`;

  // A school with twenty-four learners.
  const reg = await (await post("/auth/register", { email: `head-${stamp}@probe.example`, password: "password12", role: "parent" })).json();
  const token = reg.token;
  await post("/orgs", { name: "Probe Academy", seats: 40 }, token);
  await post("/orgs/roster", { names: Array.from({ length: 24 }, (_, i) => `Learner ${String(i + 1).padStart(2, "0")}`) }, token);

  const teacher = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await teacher.addInitScript((t) => { try { localStorage.setItem("tutor_token", t); } catch {} }, token);
  const page = await teacher.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("dialog", (d) => d.accept());

  await page.goto(`${WEB}/school`, { waitUntil: "domcontentloaded" });
  await page.getByText("Measure the difference").waitFor({ timeout: 15_000 });
  await page.getByRole("link", { name: "Open the pilot page" }).click();
  await page.getByText("Start a pilot").waitFor({ timeout: 15_000 });
  check("the school portal leads to the pilot page", page.url().includes("/school/pilot"));

  await page.getByPlaceholder("JSS2 mathematics, first term").fill("Probe pilot, term one");
  const topics = page.locator("button.pill");
  for (let i = 0; i < 5; i++) await topics.nth(i).click();
  await page.getByText("Include a comparison group").click();
  await page.getByRole("button", { name: "Start the pilot" }).click();
  await page.getByText("Starting test open").waitFor({ timeout: 15_000 });
  let body = await page.locator("body").innerText();
  check("starting a pilot enrols the roster and opens the starting test", body.includes("10 questions a test") && body.includes("24 learners in two groups"), body.slice(0, 200).replace(/\n/g, " | "));
  const links = await page.locator('a[href^="/pilot/test?code="]').count();
  // The learner list, not the report's own table further down the page.
  const waits = await page.locator("table").first().locator("td", { hasText: /^Waits$/ }).count();
  check("with a link for every learner, half tutored and half waiting", links === 24 && waits === 12, `${links} links, ${waits} waiting`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pilot-teacher-${name}.png`, fullPage: true });

  const pilotId = (await get("/orgs/pilots", token)).pilots[0].id;
  const members = (await get(`/orgs/pilots/${pilotId}`, token)).members;
  const tutored = members.filter((m) => m.group === "tutor");
  const waiting = members.filter((m) => m.group === "comparison");

  // A child, on a phone, with nothing but their link.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const child = await phone.newPage();
  child.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await child.goto(`${WEB}/pilot/test?code=${tutored[0].code}`, { waitUntil: "domcontentloaded" });
  await child.getByRole("button", { name: "Start the test" }).waitFor({ timeout: 15_000 });
  body = await child.locator("body").innerText();
  check("a child opens their link with no sign-in and is greeted by name", body.includes(`Hello, ${tutored[0].displayName}.`) && body.includes("Starting test") && body.includes("does not count against you"));
  check("the welcome fits a phone", await fits(child));
  if (SHOTS) await child.screenshot({ path: `${SHOTS}/pilot-child-welcome-${name}.png` });

  await child.getByRole("button", { name: "Start the test" }).click();
  await child.getByText("Question 1 of 10").waitFor({ timeout: 10_000 });
  const first = (await child.locator(".pilot-question").innerText()).trim();
  check("one question at a time, from the verified bank", answerTo.has(first), first);
  if (SHOTS) await child.screenshot({ path: `${SHOTS}/pilot-child-question-${name}.png` });
  // Three right answers, then leave.
  for (let k = 0; k < 3; k++) {
    const prompt = (await child.locator(".pilot-question").innerText()).trim();
    await child.locator("#pilot-answer").fill(answerTo.get(prompt) ?? "0");
    await child.getByRole("button", { name: "Next" }).click();
    await child.getByText(`Question ${k + 2} of 10`).waitFor({ timeout: 10_000 });
  }
  body = await child.locator("body").innerText();
  check("nothing is marked in front of the child", !/correct|wrong|right answer|well done|✓|✗/i.test(body), body.slice(0, 120));
  check("a question fits a phone", await fits(child));

  // The tab closes half way. The same link carries on.
  await child.reload({ waitUntil: "domcontentloaded" });
  await child.getByRole("button", { name: "Carry on with the test" }).waitFor({ timeout: 15_000 });
  await child.getByRole("button", { name: "Carry on with the test" }).click();
  await child.getByText("Question 4 of 10").waitFor({ timeout: 10_000 });
  check("a reload half way loses nothing and carries on at the next question", true);
  await child.getByRole("button", { name: "Back" }).click();
  await child.getByText("Question 3 of 10").waitFor({ timeout: 10_000 });
  check("and going back shows what they wrote", (await child.locator("#pilot-answer").inputValue()).length > 0);
  for (let k = 3; k <= 10; k++) {
    await child.getByText(`Question ${k} of 10`).waitFor({ timeout: 10_000 });
    await child.getByRole("button", { name: k === 10 ? "Finish" : "Next" }).click();
  }
  await child.getByText("Hand in?").waitFor({ timeout: 10_000 });
  check("before handing in they see how many they answered", (await child.locator("body").innerText()).includes("You have answered 3 of 10 questions."));
  await child.getByRole("button", { name: "Hand in", exact: true }).click();
  await child.getByText("Handed in").waitFor({ timeout: 10_000 });
  check("handing in thanks them by name and shows no score", (await child.locator("body").innerText()).includes(`Thank you, ${tutored[0].displayName}.`) && !/\d+\s?%|\bscore\b/i.test(await child.locator("body").innerText()));
  await child.reload({ waitUntil: "domcontentloaded" });
  await child.getByText("Handed in").waitFor({ timeout: 10_000 });
  check("the link cannot be used to sit the same test twice", true);

  // The same page for a Yorùbá reviewer.
  const yo = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await yo.addInitScript(() => { try { localStorage.setItem("dingba_ui_lang", "yo"); } catch {} });
  const yoPage = await yo.newPage();
  await yoPage.goto(`${WEB}/pilot/test?code=${tutored[1].code}&uiDrafts=1`, { waitUntil: "domcontentloaded" });
  await yoPage.getByRole("button", { name: "Bẹ̀rẹ̀ ìdánwò" }).waitFor({ timeout: 15_000 }).catch(() => {});
  body = await yoPage.locator("body").innerText();
  check("the test reads in Yorùbá for a reviewer", body.includes("Bẹ̀rẹ̀ ìdánwò") && body.includes("Ìdánwò ìbẹ̀rẹ̀") && body.includes(tutored[1].displayName), body.slice(0, 120).replace(/\n/g, " | "));
  check("and fits a phone in Yorùbá", await fits(yoPage));
  if (SHOTS) await yoPage.screenshot({ path: `${SHOTS}/pilot-child-yoruba-${name}.png` });
  await yo.close();

  // A link nobody was given.
  await child.goto(`${WEB}/pilot/test?code=${"0".repeat(32)}`, { waitUntil: "domcontentloaded" });
  await child.getByText("This test link is not recognised").waitFor({ timeout: 10_000 }).catch(() => {});
  check("a link nobody was given says so plainly", (await child.locator("body").innerText()).includes("Ask your teacher for your link"));

  // The rest of the class sits the starting test: 3 to 6 right of ten.
  const BASE = [3, 4, 4, 5, 5, 5, 6, 6, 6, 5, 4, 3];
  for (const [i, m] of tutored.entries()) if (i > 0) await sit(m.code, BASE[i]);
  for (const [i, m] of waiting.entries()) await sit(m.code, BASE[i]);

  // A tutored learner's practice holds none of the test questions; the comparison group waits.
  const lesson = await post("/sessions", { studentId: tutored[0].studentId, personaId: "amara", packId: "math-ms" }, token);
  const sessionId = (await lesson.json()).sessionId;
  const offered = await get(`/packs/math-ms/problems?session=${sessionId}`);
  const everything = await get("/packs/math-ms/problems");
  check("a tutored learner's practice list leaves the test questions out", lesson.status === 200 && everything.length - offered.length >= 20, `${everything.length} vs ${offered.length}`);
  const blocked = await post("/sessions", { studentId: waiting[0].studentId, personaId: "amara", packId: "math-ms" }, token);
  check("a learner in the comparison group cannot start a lesson until the pilot ends", blocked.status === 403);
  for (const m of tutored.slice(0, 6)) for (let k = 0; k < 2; k++) await post("/sessions", { studentId: m.studentId, personaId: "amara", packId: "math-ms" }, token);
  for (const m of tutored.slice(6)) await post("/sessions", { studentId: m.studentId, personaId: "amara", packId: "math-ms" }, token);

  // The teacher sees who has handed in, and opens the final test.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("24 of 24 have handed in the starting test.").waitFor({ timeout: 15_000 }).catch(() => {});
  check("the teacher sees everyone has handed in", (await page.locator("body").innerText()).includes("24 of 24 have handed in the starting test."));
  await page.getByRole("button", { name: "Open the final test" }).click();
  await page.getByText("Final test open").waitFor({ timeout: 15_000 });
  check("opening the final test is one button and a warning", true);

  // The final test: the tutored group does better by 2 to 4 questions, the comparison group about the same.
  const GAIN = [4, 3, 3, 2, 3, 4, 2, 3, 2, 3, 3, 4];
  const DRIFT = [1, 0, 1, 0, -1, 1, 0, 1, 0, 0, 1, -1];
  const firstOpen = await (await post(`/pilot-tests/${tutored[0].code}/open`)).json();
  check("the final test asks different questions from the starting test", firstOpen.phase === "endline" && !firstOpen.questions.some((q) => q.prompt === first));
  for (const [i, m] of tutored.entries()) await sit(m.code, BASE[i] + GAIN[i]);
  for (const [i, m] of waiting.entries()) await sit(m.code, BASE[i] + DRIFT[i]);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("What this shows").waitFor({ timeout: 15_000 });
  await page.getByText("More than comparison").waitFor({ timeout: 15_000 }).catch(() => {});
  const report = await page.locator(".pilot-report").innerText();
  const api = await get(`/orgs/pilots/${pilotId}/report`, token);
  check("the report gives before, after and change for the tutored group", /Before/i.test(report) && /After/i.test(report) && api.tutor?.n === 12 && report.includes(`${(Math.round(api.tutor.preMean * 10) / 10).toString()}%`), report.slice(0, 160).replace(/\n/g, " | "));
  check("the answers were marked by the maths checker, not by plain matching", api.integrity.exactMatchMarks === 0 && api.integrity.unmarkedAnswers === 0, `exact ${api.integrity.exactMatchMarks}, unmarked ${api.integrity.unmarkedAnswers}`);
  check("and the tutored learner who answered three scored thirty", Math.round(api.learners.find((l) => l.studentId === tutored[0].studentId).baseline) === 30);
  check("it says in words what the difference from the comparison group means", report.includes("chosen by chance from the same class") && report.includes("evidence that the tutoring caused the extra gain") && report.includes("early signal"));
  check("and how it was measured", report.includes("Half the learners sat one first and half the other (12 and 12)") && report.includes("decided by chance"));
  check("the difference is the one the scores imply", Math.abs(api.difference.difference - (10 * (GAIN.reduce((a, b) => a + b, 0) - DRIFT.reduce((a, b) => a + b, 0))) / 12) < 0.01, String(api.difference.difference));
  const took = await page.locator(".pilot-report table").first().innerText();
  check("and who took part, group by group", /Tutored\s+12\s+12\s+12\s+12/.test(took) && /Comparison \(waited\)\s+12\s+12\s+12\s+12/.test(took), took.replace(/\s+/g, " "));
  if (SHOTS) {
    await page.mouse.move(0, 0);
    await page.locator(".pilot-report").screenshot({ path: `${SHOTS}/pilot-report-${name}.png` });
  }

  // Printing prints the report, not the controls.
  await page.emulateMedia({ media: "print" });
  check("printing shows the report and hides the controls", (await page.locator(".pilot-report").isVisible()) && !(await page.getByRole("button", { name: "Close the pilot" }).isVisible()) && !(await page.locator(".appbar").isVisible()) && !(await page.getByRole("heading", { name: "Each learner" }).isVisible()));
  await page.emulateMedia({ media: "screen" });

  // On a phone the teacher's page still fits.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  check("the teacher's page fits a phone", await fits(page));
  await page.setViewportSize({ width: 1100, height: 900 });

  // Closing lets the comparison group in.
  await page.getByRole("button", { name: "Close the pilot" }).click();
  await page.getByText("Closed", { exact: true }).first().waitFor({ timeout: 15_000 });
  const allowed = await post("/sessions", { studentId: waiting[0].studentId, personaId: "amara", packId: "math-ms" }, token);
  check("closing the pilot lets the comparison group start lessons", allowed.status === 200);
  check("no page errors on the school or the child's side", errors.length === 0, errors.slice(0, 2).join(" | "));

  // The founder reads the headline.
  await post("/auth/register", { email: OWNER, password: "password12", role: "parent" });
  const founder = await (await post("/auth/login", { email: OWNER, password: "password12" })).json();
  const command = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await command.addInitScript((t) => { try { localStorage.setItem("tutor_token", t); } catch {} }, founder.token);
  const cc = await command.newPage();
  await cc.goto(`${WEB}/command`, { waitUntil: "domcontentloaded" });
  const tab = cc.getByRole("button", { name: "Evidence" });
  if (await tab.waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)) {
    await tab.click();
    await cc.getByText("Probe Academy").first().waitFor({ timeout: 15_000 }).catch(() => {});
    body = await cc.locator("body").innerText();
    check("the founder reads each pilot's headline in the Command Centre", body.includes("Probe Academy") && body.includes("Probe pilot, term one") && body.includes("Randomised"), body.slice(0, 160).replace(/\n/g, " | "));
    check("with no learner named there", !body.includes("Learner 01"));
    if (SHOTS) await cc.screenshot({ path: `${SHOTS}/pilot-evidence-${name}.png` });
  } else {
    check(`the founder reads each pilot's headline in the Command Centre (start the API with COMMAND_OWNER_EMAILS=${OWNER})`, false);
  }
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\na school can measure what its learners gained, and read it plainly");
process.exit(failures ? 1 : 0);
