#!/usr/bin/env node
/**
 * The load driver: finds out where the stack folds before a launch spike
 * does. Zero dependencies, plain fetch, honest numbers.
 *
 * Usage:
 *   node tools/load/run.mjs [--base http://127.0.0.1:4000] [--seconds 30] [--vus 20]
 *
 * Each virtual user loops a realistic journey: create a session, exchange
 * chat turns, answer practice problems, read the dashboard surfaces. Every
 * request's latency lands in a histogram; the report prints throughput,
 * p50/p95/p99 per step, and every failure by status.
 *
 * Run it against a stack with mock AI to measure the PLATFORM (routing,
 * store, safety gate, SSE). Against real models the model dominates and you
 * are measuring the GPU box instead; both are worth knowing, separately.
 */

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((p) => p.length),
);
const BASE = args.base ?? "http://127.0.0.1:4000";
const SECONDS = Number(args.seconds ?? 30);
const VUS = Number(args.vus ?? 20);

const steps = new Map(); // step -> { latencies: number[], failures: Map<status, count> }
function recordStep(step, ms, ok, status) {
  let s = steps.get(step);
  if (!s) steps.set(step, (s = { latencies: [], failures: new Map() }));
  if (ok) s.latencies.push(ms);
  else s.failures.set(status, (s.failures.get(status) ?? 0) + 1);
}

async function timed(step, fn) {
  const start = performance.now();
  try {
    const res = await fn();
    const ms = performance.now() - start;
    recordStep(step, ms, res.ok, res.status);
    return res;
  } catch (err) {
    recordStep(step, performance.now() - start, false, `net:${err?.cause?.code ?? err?.name ?? "error"}`);
    return null;
  }
}

async function drainSse(res) {
  // The chat endpoint streams; time-to-last-byte is the honest latency.
  if (!res?.body) return;
  const reader = res.body.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

let running = true;

async function virtualUser(id) {
  let journeys = 0;
  while (running) {
    journeys += 1;
    const name = `Load${id}x${journeys}`;
    const created = await timed("create session", () =>
      fetch(`${BASE}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ studentName: name, personaId: "amara", packId: "math-ms" }),
      }).then(async (r) => ({ ok: r.ok, status: r.status, json: r.ok ? await r.json() : null })),
    );
    const sessionId = created?.json?.sessionId;
    if (!sessionId) continue;

    for (const text of ["can you explain one step equations", "so I move the number across?", "give me a hint"]) {
      if (!running) break;
      const start = performance.now();
      try {
        const res = await fetch(`${BASE}/sessions/${sessionId}/message`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        });
        await drainSse(res);
        recordStep("chat turn (SSE, full stream)", performance.now() - start, res.ok, res.status);
      } catch (err) {
        recordStep("chat turn (SSE, full stream)", performance.now() - start, false, `net:${err?.cause?.code ?? "error"}`);
      }
    }

    await timed("practice answer (SymPy verdict)", () =>
      fetch(`${BASE}/sessions/${sessionId}/practice`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ problemIndex: 0, answer: "4" }),
      }).then((r) => ({ ok: r.ok, status: r.status })),
    );
    await timed("read packs", () => fetch(`${BASE}/packs`).then((r) => ({ ok: r.ok, status: r.status })));
    await timed("read personas", () => fetch(`${BASE}/personas`).then((r) => ({ ok: r.ok, status: r.status })));
    await timed("health", () => fetch(`${BASE}/health`).then((r) => ({ ok: r.ok, status: r.status })));
  }
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)];
}

const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => null);
if (!health) {
  console.error(`Nothing answering at ${BASE}. Boot the api first.`);
  process.exit(1);
}
console.log(`Target ${BASE} (store=${health.store}, chat=${health.providers.chat}), ${VUS} virtual users, ${SECONDS}s\n`);

const startedAt = performance.now();
const users = Array.from({ length: VUS }, (_, i) => virtualUser(i));
await new Promise((resolve) => setTimeout(resolve, SECONDS * 1000));
running = false;
await Promise.all(users);
const elapsed = (performance.now() - startedAt) / 1000;

let totalOk = 0;
let totalFail = 0;
const rows = [];
for (const [step, s] of steps) {
  const sorted = [...s.latencies].sort((a, b) => a - b);
  totalOk += sorted.length;
  const failures = [...s.failures.entries()].map(([k, v]) => `${v}x${k}`).join(", ");
  totalFail += [...s.failures.values()].reduce((n, v) => n + v, 0);
  rows.push({
    step,
    requests: sorted.length,
    "rps": (sorted.length / elapsed).toFixed(1),
    "p50 ms": Math.round(quantile(sorted, 0.5)),
    "p95 ms": Math.round(quantile(sorted, 0.95)),
    "p99 ms": Math.round(quantile(sorted, 0.99)),
    "max ms": Math.round(sorted[sorted.length - 1] ?? 0),
    failures: failures || "none",
  });
}
console.table(rows);
console.log(`\nTotal: ${totalOk} ok, ${totalFail} failed, ${(totalOk / elapsed).toFixed(1)} req/s over ${elapsed.toFixed(1)}s`);
process.exit(totalFail > totalOk * 0.01 ? 1 : 0); // more than 1% failures is a failed run
