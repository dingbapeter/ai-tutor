#!/usr/bin/env node
/**
 * Put a finished character live for one tutor, in one step.
 *
 *   node tools/avatar/install-character.ts amara path/to/amara.glb [--lenient]
 *     [--repo /path/to/checkout]   (defaults to this one; for tests)
 *
 * Checks the file against the contract (it refuses one that fails), copies
 * it to apps/web/public/tutors/<id>.glb, and names it on the persona in
 * config/personas.json. After that, commit both and deploy the web and API
 * services; the lesson page loads the 3D engine for that tutor from then on.
 *
 * Needs only Node 22.18 or newer.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkGlb, formatReport } from "../../apps/web/app/studio/check.ts";

const argv = process.argv.slice(2);
const repoFlag = argv.indexOf("--repo");
const repo = repoFlag >= 0 ? argv[repoFlag + 1] : join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const positional = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--repo");
const [id, file] = positional;
const lenient = argv.includes("--lenient");
if (!id || !file) {
  console.error("usage: node tools/avatar/install-character.ts <personaId> <character.glb> [--lenient]");
  process.exit(2);
}

const personasPath = join(repo, "config", "personas.json");
const config = JSON.parse(readFileSync(personasPath, "utf8")) as { personas: Array<{ id: string; name: string; model?: string }> };
const persona = config.personas.find((p) => p.id === id);
if (!persona) {
  console.error(`no persona "${id}"; known: ${config.personas.map((p) => p.id).join(", ")}`);
  process.exit(2);
}

const bytes = new Uint8Array(readFileSync(file));
const report = checkGlb(bytes, { lenient });
console.log(`\n${file}  (${report.facts.sizeMb.toFixed(2)} MB)\n`);
console.log(formatReport(report));
if (!report.pass) {
  console.error(`\nnot installed: fix the lines marked FAIL first${lenient ? "" : " (or pass --lenient for a work in progress)"}`);
  process.exit(1);
}

const dir = join(repo, "apps", "web", "public", "tutors");
mkdirSync(dir, { recursive: true });
const dest = join(dir, `${id}.glb`);
const replacing = existsSync(dest);
copyFileSync(file, dest);
persona.model = `/tutors/${id}.glb`;
writeFileSync(personasPath, `${JSON.stringify(config, null, 2)}\n`);

console.log(`\n${replacing ? "replaced" : "installed"} apps/web/public/tutors/${id}.glb`);
console.log(`${persona.name} now carries model "${persona.model}" in config/personas.json`);
console.log(`\nnext: git add apps/web/public/tutors/${id}.glb config/personas.json && git commit, then deploy web and api`);
console.log(`see it first: /studio?model=/tutors/${id}.glb on a running web app`);
