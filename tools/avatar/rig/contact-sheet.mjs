#!/usr/bin/env node
/**
 * One picture of many: lays the judge's renders out in a labelled grid, so
 * a person can look over every control at a glance.
 *
 *   node tools/avatar/rig/contact-sheet.mjs <dir of pngs> <out.png> [columns] [first] [count]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const [dir, out, cols = "7", first = "0", count = "1000"] = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort((a, b) => (a === "rest.png" ? -1 : b === "rest.png" ? 1 : a.localeCompare(b))).slice(Number(first), Number(first) + Number(count));
const cells = files.map((f) => `<figure><img src="data:image/png;base64,${readFileSync(join(dir, f)).toString("base64")}"><figcaption>${f.replace(".png", "")}</figcaption></figure>`).join("");
const html = `<body style="margin:0;background:#fff;font:13px sans-serif"><div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:4px;padding:4px">${cells}</div><style>figure{margin:0}img{width:100%;display:block}figcaption{text-align:center;padding:2px 0 4px}</style></body>`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 220 * Number(cols), height: 800 } });
await page.setContent(html);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(`${files.length} pictures on ${out}`);
