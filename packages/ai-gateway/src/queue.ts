import type { ChatMessage, ChatOptions, ChatProvider, VisionProvider } from "./types.js";

/**
 * A bounded queue in front of the self-hosted model server.
 *
 * llama.cpp degrades badly when oversubscribed: every extra concurrent
 * generation slows every other one down, and under real load the box would
 * take on more work than it can finish. This queue admits a fixed number of
 * generations at a time (matched to the server's parallel slots), holds a
 * bounded line behind them, and refuses honestly once the line is full or a
 * wait grows too long — a fast "busy, try again shortly" beats a two-minute
 * hang for everyone.
 *
 * One queue instance is shared by every provider that talks to the same
 * GPU (chat, planner, premium chat, vision), because the resource being
 * protected is the box, not the code path.
 */

export class TutorBusyError extends Error {
  readonly retryAfterSec: number;
  constructor(retryAfterSec: number) {
    super("The tutor is helping a lot of learners right now. Give it a few seconds and try again.");
    this.name = "TutorBusyError";
    this.retryAfterSec = retryAfterSec;
  }
}

export interface QueueStats {
  running: number;
  queued: number;
  maxConcurrent: number;
  maxQueue: number;
  served: number;
  rejected: number;
  timedOut: number;
  peakQueued: number;
  avgWaitMs: number;
  longestWaitMs: number;
}

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (err: unknown) => void;
  enqueuedAt: number;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  onAbort?: () => void;
  settled: boolean;
}

export class AiRequestQueue {
  private readonly maxConcurrent: number;
  private readonly maxQueue: number;
  private readonly queueTimeoutMs: number;
  private running = 0;
  private waiters: Waiter[] = [];
  private served = 0;
  private rejected = 0;
  private timedOut = 0;
  private peakQueued = 0;
  private totalWaitMs = 0;
  private waited = 0;
  private longestWaitMs = 0;

  constructor(opts: { maxConcurrent?: number; maxQueue?: number; queueTimeoutMs?: number } = {}) {
    this.maxConcurrent = Math.max(1, opts.maxConcurrent ?? 4);
    this.maxQueue = Math.max(0, opts.maxQueue ?? 32);
    this.queueTimeoutMs = Math.max(100, opts.queueTimeoutMs ?? 30_000);
  }

  /** A slot, or a rejection. The returned release is idempotent. */
  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new Error("aborted before queueing"));
    if (this.running < this.maxConcurrent) {
      this.running += 1;
      this.served += 1;
      return Promise.resolve(this.makeRelease());
    }
    if (this.waiters.length >= this.maxQueue) {
      this.rejected += 1;
      return Promise.reject(new TutorBusyError(this.retryAfterSec()));
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        enqueuedAt: Date.now(),
        settled: false,
        signal,
        timer: setTimeout(() => {
          this.drop(waiter);
          this.timedOut += 1;
          reject(new TutorBusyError(this.retryAfterSec()));
        }, this.queueTimeoutMs),
      };
      if (signal) {
        waiter.onAbort = () => {
          this.drop(waiter);
          reject(new Error("aborted while queued"));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
      this.peakQueued = Math.max(this.peakQueued, this.waiters.length);
    });
  }

  stats(): QueueStats {
    return {
      running: this.running,
      queued: this.waiters.length,
      maxConcurrent: this.maxConcurrent,
      maxQueue: this.maxQueue,
      served: this.served,
      rejected: this.rejected,
      timedOut: this.timedOut,
      peakQueued: this.peakQueued,
      avgWaitMs: this.waited ? Math.round(this.totalWaitMs / this.waited) : 0,
      longestWaitMs: this.longestWaitMs,
    };
  }

  private retryAfterSec(): number {
    // A coarse, honest hint: the deeper the line, the longer the wait.
    return Math.min(60, 5 + this.waiters.length * 2);
  }

  private makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.running -= 1;
      this.next();
    };
  }

  private drop(waiter: Waiter): void {
    waiter.settled = true;
    clearTimeout(waiter.timer);
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
    const i = this.waiters.indexOf(waiter);
    if (i >= 0) this.waiters.splice(i, 1);
  }

  private next(): void {
    while (this.running < this.maxConcurrent) {
      const waiter = this.waiters.shift();
      if (!waiter) return;
      if (waiter.settled) continue;
      waiter.settled = true;
      clearTimeout(waiter.timer);
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
      const waitMs = Date.now() - waiter.enqueuedAt;
      this.totalWaitMs += waitMs;
      this.waited += 1;
      this.longestWaitMs = Math.max(this.longestWaitMs, waitMs);
      this.running += 1;
      this.served += 1;
      waiter.resolve(this.makeRelease());
    }
  }
}

/** Wrap a chat provider: a slot is held for the WHOLE stream, and always freed. */
export function queuedChat(inner: ChatProvider, queue: AiRequestQueue): ChatProvider {
  return {
    name: `${inner.name}+queue`,
    async *chat(messages: ChatMessage[], opts?: ChatOptions): AsyncIterable<string> {
      const release = await queue.acquire(opts?.signal);
      try {
        yield* inner.chat(messages, opts);
      } finally {
        release();
      }
    },
  };
}

/** Vision rides the same GPU, so it waits in the same line. */
export function queuedVision(inner: VisionProvider, queue: AiRequestQueue): VisionProvider {
  return {
    name: `${inner.name}+queue`,
    async see(image: Uint8Array, mimeType: string, instruction: string): Promise<string> {
      const release = await queue.acquire();
      try {
        return await inner.see(image, mimeType, instruction);
      } finally {
        release();
      }
    },
  };
}
