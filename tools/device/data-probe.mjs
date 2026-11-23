#!/usr/bin/env node
/**
 * The data-rights probe: can a family take a copy of everything, and then
 * erase it, from the account page, in every engine?
 *
 * For each engine it builds a family that has really used Dingba (a lesson
 * with words in it, voice familiarity, a care contact), then, as that
 * parent in a real browser:
 *
 *   - taps "Download all our data" and receives a dated file,
 *   - opens it and finds their child, the lesson word for word, and the
 *     settings, and finds no password and no sign-in key,
 *   - taps "Delete my account and all data", types DELETE, and is signed out,
 *   - and checks the server now refuses that sign-in and holds nothing.
 *
 *   node tools/device/data-probe.mjs [--url http://127.0.0.1:3100]
 *     [--api http://127.0.0.1:4100] [--engines webkit,chromium,firefox]
 *     [--admin-key KEY] [--chromium PATH]
 */
import { chromium, firefox, webkit } from "@playwright/test";
import { readFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((p) => p.length),
);
const WEB = args.url ?? "http://127.0.0.1:3100";
const API = args.api ?? "http://127.0.0.1:4100";
const ADMIN = args["admin-key"] ?? "probe-admin";
const CHROME = args.chromium ?? process.env.CHROMIUM_PATH ?? undefined;
const ENGINES = { webkit, chromium, firefox };
const WANTED = (args.engines ?? "webkit,chromium,firefox").split(",").map((s) => s.trim());
const PASSWORD = "correct horse battery";

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${name}${ok || !detail ? "" : `  (${detail})`}`);
};

async function api(path, { method = "GET", token, body, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function busyFamily(tag) {
  const email = `data-${tag}-${Date.now()}@example.com`;
  const token = (await api("/auth/register", { method: "POST", body: { email, password: PASSWORD, role: "parent" } })).json.token;
  await api("/admin/plan", { method: "POST", headers: { "x-admin-key": ADMIN }, body: { email, plan: "premium" } });
  const child = (await api("/students", { method: "POST", token, body: { displayName: "Ada" } })).json;
  await api(`/students/${child.id}/voice-familiarity`, { method: "PUT", token, body: { enabled: true } });
  await api(`/students/${child.id}/care-contact`, { method: "PUT", token, body: { name: "Aunt Bisi", phone: "+234 800 000 0000" } });
  const s = (await api("/sessions", { method: "POST", token, body: { studentId: child.id, personaId: "amara", packId: "math-ms" } })).json;
  await api(`/sessions/${s.sessionId}/message`, { method: "POST", body: { text: "Ada worked out that seven eights are fifty six" } });
  return { email, token, childId: child.id };
}

for (const name of WANTED) {
  const browser = await ENGINES[name].launch(name === "chromium" && CHROME ? { executablePath: CHROME } : {});
  console.log(`\n=== ${name} ${browser.version()} ===`);
  const fam = await busyFamily(name);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await context.addInitScript((t) => { try { if (!sessionStorage.getItem("_probe")) { localStorage.setItem("tutor_token", t); sessionStorage.setItem("_probe", "1"); } } catch {} }, fam.token);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(`${WEB}/account`, { waitUntil: "domcontentloaded" });

  const download = page.getByRole("button", { name: "Download all our data" });
  await download.waitFor({ timeout: 15_000 });
  check("the account page offers the family a copy of their data", await download.isVisible());

  const [file] = await Promise.all([page.waitForEvent("download", { timeout: 20_000 }), download.click()]);
  check("it arrives as a dated file", /^dingba-data-\d{4}-\d{2}-\d{2}\.json$/.test(file.suggestedFilename()), file.suggestedFilename());
  const text = readFileSync(await file.path(), "utf8");
  let data = null;
  try { data = JSON.parse(text); } catch { /* checked below */ }
  check("the file opens as readable data", data?.format === "dingba-export/1");
  const ada = data?.learners?.[0];
  const words = (ada?.sessions ?? []).flatMap((x) => x.messages.map((m) => m.content)).join("\n");
  check("it holds their child and the lesson word for word", ada?.learner?.displayName === "Ada" && words.includes("seven eights are fifty six"));
  check("and the child's settings and care contact", ada?.learner?.voiceFamiliarity === true && ada?.careContact?.name === "Aunt Bisi");
  check("and no password or sign-in key", !text.includes(PASSWORD) && !text.includes(fam.token) && !/\$2[aby]\$\d{2}\$/.test(text) && !text.includes("passwordHash"));

  // Erase it all, the way a parent would.
  page.once("dialog", (d) => d.accept("DELETE"));
  await page.getByRole("button", { name: "Delete my account and all data" }).click();
  await page.waitForFunction(() => !localStorage.getItem("tutor_token"), null, { timeout: 15_000 }).catch(() => {});
  check("deleting signs the family out", await page.evaluate(() => !localStorage.getItem("tutor_token")));
  const after = await api("/me/export", { token: fam.token });
  check("and the server no longer knows that sign-in", after.status === 401, `${after.status}`);
  const login = await api("/auth/login", { method: "POST", body: { email: fam.email, password: PASSWORD } });
  check("nor the account", login.status === 401 || login.status === 400, `${login.status}`);
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\na family can take everything, and then erase everything, on every engine");
process.exit(failures ? 1 : 0);
