#!/usr/bin/env node
/**
 * The character validator, from the command line.
 *
 * The same check the Studio page runs in the artist's browser
 * (apps/web/app/studio/check.ts), so a file that passes here passes there.
 * Needs only Node 22.18 or newer, which runs TypeScript directly; nothing
 * to install.
 *
 *   node tools/avatar/validate-glb.ts path/to/amara.glb [--lenient]
 *
 * --lenient reports instead of failing on the budgets (size, triangles,
 * skeleton), for looking at a work in progress. The rig checks always count.
 */
import { readFileSync } from "node:fs";
import { checkGlb, formatReport } from "../../apps/web/app/studio/check.ts";

const file = process.argv[2];
const lenient = process.argv.includes("--lenient");
if (!file) {
  console.error("usage: node tools/avatar/validate-glb.ts character.glb [--lenient]");
  process.exit(2);
}

const bytes = new Uint8Array(readFileSync(file));
const report = checkGlb(bytes, { lenient });
console.log(`\n${file}  (${report.facts.sizeMb.toFixed(2)} MB)\n`);
console.log(formatReport(report));
process.exit(report.pass ? 0 : 1);
