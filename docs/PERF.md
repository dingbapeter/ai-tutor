# Performance: measured, not guessed

Numbers from `pnpm load` against the built api with mock AI and the
in-memory store, run 2026-08-29 inside a development container. Read them
as the PLATFORM's cost (routing, store, safety gate, SSE streaming,
verdicts): with real models the model dominates and you are measuring the
GPU box instead. Both are worth knowing, separately.

Two floors are built into the mock numbers and are not platform cost:
the mock chat provider paces its stream at 30 ms per token to behave like a
real model (about 500 ms per reply), and every chat turn still runs the
full moderation gate.

## The runs

One api process, one container. Each virtual user loops a real journey:
create a session, three chat turns (full SSE stream drained), one practice
answer, three light reads.

| Concurrent users | Total req/s | Chat p50 | Chat p95 | Light reads p95 | Failures |
| ---------------- | ----------- | -------- | -------- | --------------- | -------- |
| 5                | 15          | 581 ms   | 637 ms   | 4 ms            | 0        |
| 20               | 58          | 578 ms   | 610 ms   | 4 ms            | 0        |
| 60               | 172         | 578 ms   | 611 ms   | 6 ms            | 0        |
| 150              | 414         | 619 ms   | 701 ms   | 7 ms            | 0        |
| 400              | 590         | 1241 ms  | 2151 ms  | ~80 ms          | 0        |

## What the numbers say

- Flat from 5 to 150 concurrent users: latency barely moves while
  throughput scales linearly. The platform itself is not the bottleneck at
  launch-scale traffic.
- At 400 concurrent users one process starts queueing: chat p50 doubles,
  light reads grow from single digits to ~80 ms at p95, and event-loop
  pressure is visible on the Ops tab. Nothing fails; it degrades, honestly.
- Sessions now resume from the store (migration 0014), so the answer to
  more than ~300 concurrent users is a second api instance behind the same
  database, not a bigger box.

## Reproduce it

```bash
pnpm build
pnpm load:boot        # terminal 1: the target, mock AI, wide-open limits
pnpm load -- --vus 60 --seconds 30   # terminal 2
```

`--base` points the driver at any deployed stack instead. Against
production, run it with care and never against real families' data.

The driver exits non-zero when more than 1% of requests fail, so a load
check can sit in a pipeline.
